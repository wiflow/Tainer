"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { DockerHubActionState } from "@/lib/action-states";
import { requireSession, requireSitePermission } from "@/lib/auth";
import { fetchImageEnvVars, syncDockerImage } from "@/lib/docker-hub";
import { saveImageEnv } from "@/lib/image-env-cache";
import { assertSafeRemoteHost } from "@/lib/import-url";
import {
  buildDockerOciReference,
  buildOciTemplateFileName,
  buildOciTemplateFileNameAliases,
} from "@/lib/oci-template";
import { pullOciRegistryTemplate, withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

function envVarsToText(envVars: string[]): string {
  return envVars.join("\n");
}

async function cacheDockerHubImageEnv(input: {
  aliases: string[];
  namespace: string;
  reference: string;
  repository: string;
  tag: string;
}) {
  try {
    const envVars = await fetchImageEnvVars({
      namespace: input.namespace,
      repository: input.repository,
      tag: input.tag,
    });

    if (envVars.length === 0) {
      return;
    }

    const envText = envVarsToText(envVars);

    if (!envText.trim()) {
      return;
    }

    await saveImageEnv(input.reference, envText, {
      aliases: input.aliases,
    });
  } catch (error) {
    console.error(`Failed to fetch/cache image env for ${input.reference}:`, error);
  }
}

function buildProxmoxTemplateAliases(storage: string, fileNames: string[]) {
  return [...new Set(
    fileNames.flatMap((fileName) => [fileName, `${storage}:vztmpl/${fileName}`]),
  )];
}

function getRegistryHostFromReference(reference: string) {
  const [firstSegment = ""] = reference.split("/");

  if (!firstSegment) {
    throw new Error("Container registry reference must include an image path.");
  }

  if (
    firstSegment === "localhost" ||
    firstSegment.includes(".") ||
    firstSegment.includes(":")
  ) {
    return firstSegment;
  }

  return "docker.io";
}

function parseDockerHubReference(reference: string) {
  const segments = reference.replace(/^https?:\/\//, "").split("/");

  if (segments.length < 2) {
    return null;
  }

  let pathSegments = segments;

  if (segments[0]?.includes(".") || segments[0]?.includes(":") || segments[0] === "localhost") {
    const explicitHost = segments[0].toLowerCase();

    if (
      explicitHost !== "docker.io" &&
      explicitHost !== "index.docker.io" &&
      explicitHost !== "registry-1.docker.io"
    ) {
      return null;
    }

    pathSegments = segments.slice(1);
  }

  const lastSegment = pathSegments.at(-1) ?? "";
  const tagSeparatorIndex = lastSegment.lastIndexOf(":");
  const repository = tagSeparatorIndex >= 0
    ? lastSegment.slice(0, tagSeparatorIndex)
    : lastSegment;
  const tag = tagSeparatorIndex >= 0
    ? lastSegment.slice(tagSeparatorIndex + 1)
    : "latest";
  const namespace = pathSegments.slice(0, -1).join("/");

  if (!namespace || !repository || !tag) {
    return null;
  }

  return { namespace, repository, tag };
}

export async function syncDockerImageAction(
  _previousState: DockerHubActionState,
  formData: FormData,
): Promise<DockerHubActionState> {
  try {
    const session = await requireSession();

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", task: null };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-templates");
    return await withSiteConfig(siteConfig, async () => {

    const namespace = String(formData.get("namespace") ?? "").trim();
    const repository = String(formData.get("repository") ?? "").trim();
    const tag = String(formData.get("tag") ?? "").trim();
    const platform = String(formData.get("platform") ?? "").trim();

    if (!namespace || !repository || !tag || !platform) {
      return {
        message: "Namespace, repository, tag, and platform are required.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const result = await syncDockerImage({
      namespace,
      platform,
      repository,
      tag,
    });

    if (result.envVars.length > 0) {
      const fileNames = buildOciTemplateFileNameAliases(namespace, repository, tag);
      const envText = envVarsToText(result.envVars);

      if (envText.trim()) {
        await saveImageEnv(`docker.io/${namespace}/${repository}:${tag}`, envText, {
          aliases: fileNames,
        }).catch((error) => {
          console.error(`Failed to cache image env for ${namespace}/${repository}:${tag}:`, error);
        });
      }
    }

    revalidatePath(`/sites/${siteSlug}/images`);
    revalidatePath(`/sites/${siteSlug}/images/${namespace}/${repository}`);

    return {
      message: `Synced ${result.reference} for ${result.platform} into ${result.artifactPath}.`,
      requestId: randomUUID(),
      status: "success",
      task: null,
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to sync Docker image.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function pullOciTemplateAction(
  _previousState: DockerHubActionState,
  formData: FormData,
): Promise<DockerHubActionState> {
  try {
    const session = await requireSession();

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", task: null };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-templates");
    return await withSiteConfig(siteConfig, async () => {

    const namespace = String(formData.get("namespace") ?? "").trim();
    const repository = String(formData.get("repository") ?? "").trim();
    const tag = String(formData.get("tag") ?? "").trim();
    const target = String(formData.get("target") ?? "").trim();

    if (!namespace || !repository || !tag || !target) {
      return {
        message: "Namespace, repository, tag, and target storage are required.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const [node, storage] = target.split("::");

    if (!node || !storage) {
      return {
        message: "Invalid Proxmox storage target.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const reference = buildDockerOciReference(namespace, repository, tag);
    const fileName = buildOciTemplateFileName(namespace, repository, tag);
    const fileNames = buildOciTemplateFileNameAliases(namespace, repository, tag);
    const cacheEnvPromise = cacheDockerHubImageEnv({
      aliases: buildProxmoxTemplateAliases(storage, fileNames),
      namespace,
      reference,
      repository,
      tag,
    });

    try {
      const upid = await pullOciRegistryTemplate(node, storage, reference);
      await cacheEnvPromise;

      revalidatePath(`/sites/${siteSlug}/templates`);
      revalidatePath(`/sites/${siteSlug}/images/${namespace}/${repository}`);

      return {
        message: `Submitted native OCI CT template pull for ${reference} into ${storage} as ${fileName}.`,
        requestId: randomUUID(),
        status: "success",
        task: {
          node,
          siteSlug,
          submittedMessage: `Queued ${fileName} for Proxmox import.`,
          successMessage: `Pulled ${fileName} into ${storage}.`,
          title: `Pulling ${fileName}`,
          upid,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to pull OCI template.";

      if (message.includes("refusing to override existing file")) {
        await cacheEnvPromise;
        revalidatePath(`/sites/${siteSlug}/templates`);
        revalidatePath(`/sites/${siteSlug}/images/${namespace}/${repository}`);

        return {
          message: `${fileName} already exists in ${storage}. Open Templates to deploy it.`,
          requestId: randomUUID(),
          status: "success",
          task: null,
        };
      }

      throw error;
    }

    });
  } catch (error) {
    console.error("[pullOciTemplateAction] Failed:", error);
    return {
      message: error instanceof Error ? error.message : "Failed to pull OCI CT template.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

function normalizeOciReference(raw: string): string {
  const trimmed = raw.trim();

  // skopeo treats the first path segment as a Docker Hub namespace unless it
  // contains a '.' or ':' — remember the protocol so we can add the default
  // port later to force host recognition for bare hostnames.
  const hadHttps = /^https:\/\//i.test(trimmed);
  const hadHttp = /^http:\/\//i.test(trimmed);

  let ref = trimmed.replace(/^https?:\/\//, "").replace(/\/+$/, "");

  const gitlabMatch = ref.match(
    /^([^/]+(?:\/[^/]+)*)\/-\/packages\/container\/([^/]+)(?:\/([^/]+))?$/,
  );
  if (gitlabMatch) {
    const [, prefix, image, tag] = gitlabMatch;
    ref = `${prefix}/${image}:${tag ?? "latest"}`;
  }

  if (!gitlabMatch) {
    const ghcrMatch = ref.match(
      /^([^/]+)\/orgs\/([^/]+)\/packages\/container\/package\/([^/]+)(?:\/([^/]+))?$/,
    );
    if (ghcrMatch) {
      const [, host, org, image, tag] = ghcrMatch;
      ref = `${host}/${org}/${image}:${tag ?? "latest"}`;
    }
  }

  // A colon in the first segment is a port, not a tag separator
  const firstSlash = ref.indexOf("/");
  if (firstSlash !== -1 && !ref.slice(firstSlash).includes(":")) {
    ref = `${ref}:latest`;
  }

  // OCI Distribution Spec requires lowercase path segments; preserve host casing and tag.
  const colonIdx = ref.lastIndexOf(":");
  const slashIdx = ref.indexOf("/");
  if (slashIdx !== -1 && colonIdx > slashIdx) {
    const host = ref.slice(0, slashIdx);
    const path = ref.slice(slashIdx, colonIdx).toLowerCase();
    const tag = ref.slice(colonIdx);
    ref = `${host}${path}${tag}`;
  } else if (slashIdx !== -1) {
    const host = ref.slice(0, slashIdx);
    const path = ref.slice(slashIdx).toLowerCase();
    ref = `${host}${path}`;
  }

  // Bare hostnames (no '.' or ':') look like Docker Hub namespaces to skopeo;
  // appending the default port forces it to treat the segment as a registry host.
  const hostPart = ref.slice(0, ref.indexOf("/") === -1 ? ref.length : ref.indexOf("/"));
  if ((hadHttps || hadHttp) && !hostPart.includes(".") && !hostPart.includes(":")) {
    const defaultPort = hadHttps ? "443" : "80";
    ref = `${hostPart}:${defaultPort}${ref.slice(hostPart.length)}`;
  }

  return ref;
}

export async function pullCustomRegistryAction(
  _previousState: DockerHubActionState,
  formData: FormData,
): Promise<DockerHubActionState> {
  try {
    const session = await requireSession();

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", task: null };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-templates");
    return await withSiteConfig(siteConfig, async () => {

    const rawReference = String(formData.get("reference") ?? "").trim();
    const target = String(formData.get("target") ?? "").trim();

    if (!rawReference || !target) {
      return {
        message: "Image reference and target storage are required.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const reference = normalizeOciReference(rawReference);
    await assertSafeRemoteHost(getRegistryHostFromReference(reference), "Registry host");

    const [node, storage] = target.split("::");

    if (!node || !storage) {
      return {
        message: "Invalid Proxmox storage target.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const refParts = reference.replace(/^https?:\/\//, "").split(/[/:]/);
    const imageName = refParts.at(-2) ?? "image";
    const tag = refParts.at(-1) ?? "latest";
    const fileName = `${imageName}_${tag}.tar`;

    const dockerHubReference = parseDockerHubReference(reference);
    const dockerHubFileNames = dockerHubReference
      ? buildOciTemplateFileNameAliases(
          dockerHubReference.namespace,
          dockerHubReference.repository,
          dockerHubReference.tag,
        )
      : [fileName];
    const cacheEnvPromise = dockerHubReference
      ? cacheDockerHubImageEnv({
          aliases: buildProxmoxTemplateAliases(storage, [...dockerHubFileNames, fileName]),
          namespace: dockerHubReference.namespace,
          reference,
          repository: dockerHubReference.repository,
          tag: dockerHubReference.tag,
        })
      : Promise.resolve();

    try {
      const upid = await pullOciRegistryTemplate(node, storage, reference);
      await cacheEnvPromise;

      revalidatePath(`/sites/${siteSlug}/templates`);
      revalidatePath(`/sites/${siteSlug}/images`);

      return {
        message: `Submitted OCI pull for ${reference} into ${storage}.`,
        requestId: randomUUID(),
        status: "success",
        task: {
          node,
          siteSlug,
          submittedMessage: `Queued ${fileName} for Proxmox import.`,
          successMessage: `Pulled ${fileName} into ${storage}.`,
          title: `Pulling ${fileName}`,
          upid,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to pull image.";

      if (message.includes("refusing to override existing file")) {
        await cacheEnvPromise;
        revalidatePath(`/sites/${siteSlug}/templates`);

        return {
          message: `${fileName} already exists in ${storage}. Open Templates to deploy it.`,
          requestId: randomUUID(),
          status: "success",
          task: null,
        };
      }

      throw error;
    }

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to pull from registry.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}
