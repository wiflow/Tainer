import "server-only";

import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { getAppSettings } from "@/lib/app-settings";
import { formatBytes } from "@/lib/utils";

const DOCKER_HUB_API_URL = "https://hub.docker.com";
const DOCKER_REGISTRY_URL = "https://registry-1.docker.io";
const DOCKER_AUTH_URL = "https://auth.docker.io/token";
const DEFAULT_PAGE_SIZE = 12;
const DEFAULT_TAG_PAGE_SIZE = 20;
const LIBRARY_INVENTORY_TTL_MS = 15_000;
const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

type DockerHubListResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

type DockerHubRepositoryResponse = {
  description?: string;
  is_private?: boolean;
  last_updated?: string;
  name: string;
  namespace: string;
  pull_count?: number;
  star_count?: number;
  storage_size?: number | null;
};

type DockerHubSearchRepositoryResponse = {
  is_automated?: boolean;
  is_official?: boolean;
  pull_count?: number;
  repo_name: string;
  repo_owner?: string;
  short_description?: string;
  star_count?: number;
};

type DockerHubTagImageResponse = {
  architecture?: string;
  digest?: string;
  os?: string;
  size?: number;
  variant?: string | null;
};

type DockerHubTagResponse = {
  digest?: string;
  full_size?: number;
  images?: DockerHubTagImageResponse[];
  last_updated?: string;
  media_type?: string;
  name: string;
};

type RegistryTokenResponse = {
  access_token?: string;
  token?: string;
};

type RegistryPlatform = {
  architecture?: string;
  os?: string;
  variant?: string;
};

type RegistryIndexManifest = {
  digest: string;
  mediaType: string;
  platform?: RegistryPlatform;
  size: number;
};

type RegistryIndexResponse = {
  manifests?: RegistryIndexManifest[];
  mediaType?: string;
  schemaVersion?: number;
};

type RegistryLayerDescriptor = {
  digest: string;
  mediaType: string;
  size: number;
};

type RegistryImageManifest = {
  config: RegistryLayerDescriptor;
  layers: RegistryLayerDescriptor[];
  mediaType?: string;
  schemaVersion?: number;
};

type RegistryManifestPayload = RegistryImageManifest | RegistryIndexResponse;

type RegistryManifestResult = {
  digest: string;
  mediaType: string;
  payload: RegistryManifestPayload;
  size: number;
  buffer: Buffer;
};

type OciImageConfig = {
  config?: {
    Env?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type SyncResult = {
  artifactPath: string;
  digest: string;
  envVars: string[];
  platform: string;
  reference: string;
  sizeBytes: number;
};

export type DockerHubIssue = {
  endpoint: string;
  message: string;
  requiredPrivileges: string[];
  scope?: string;
};

export type DockerHubRepository = {
  description: string;
  fullName: string;
  isOfficial: boolean;
  isPrivate: boolean;
  lastUpdated: string | null;
  name: string;
  namespace: string;
  path: string;
  pullCount: number;
  starCount: number;
  storageSize: string;
};

export type DockerHubTag = {
  digest: string;
  fullSize: string;
  lastUpdated: string | null;
  mediaType: string;
  name: string;
  platforms: string[];
};

export type DockerLibraryArtifact = {
  digest: string;
  downloadedAt: string | null;
  id: string;
  namespace: string;
  path: string;
  platform: string;
  reference: string;
  repository: string;
  sizeBytes: number;
  sizeLabel: string;
  tag: string;
};

export type DockerLibraryInventory = {
  artifacts: DockerLibraryArtifact[];
  configured: boolean;
  issues: DockerHubIssue[];
  path: string;
  totalSizeBytes: number;
  totalSizeLabel: string;
};

export type DockerHubOverview = {
  issues: DockerHubIssue[];
  inventory: DockerLibraryInventory;
  nameFilter: string;
  namespace: string;
  page: number;
  repositories: DockerHubRepository[];
  searchMode: "global" | "namespace";
  totalRepositories: number | null;
};

export type DockerHubRepositoryDetail = {
  defaultPlatform: string;
  inventory: DockerLibraryInventory;
  issues: DockerHubIssue[];
  repository: DockerHubRepository | null;
  tags: DockerHubTag[];
};

type ParsedPlatform = {
  architecture: string;
  os: string;
  variant: string;
};

type DockerHubConfig = {
  defaultNamespace: string;
  defaultPlatform: string;
  libraryPath: string;
  token: string;
  username: string;
};

type StoredArtifactMeta = {
  digest: string;
  downloadedAt: string;
  namespace: string;
  platform: string;
  reference: string;
  repository: string;
  sizeBytes: number;
  tag: string;
};

let libraryInventoryCache:
  | {
      expiresAt: number;
      path: string;
      value: DockerLibraryInventory;
    }
  | null = null;
let libraryInventoryInflight: Promise<DockerLibraryInventory> | null = null;
let libraryInventoryInflightPath = "";

async function getConfig(): Promise<DockerHubConfig> {
  let settingsPath = "";
  try {
    settingsPath = (await getAppSettings()).dockerLibraryPath;
  } catch {
    settingsPath = "";
  }
  return {
    defaultNamespace: process.env.DOCKER_HUB_DEFAULT_NAMESPACE?.trim() || "library",
    defaultPlatform: process.env.DOCKER_HUB_DEFAULT_PLATFORM?.trim() || "linux/amd64",
    libraryPath: settingsPath || process.env.DOCKER_LIBRARY_PATH?.trim() || "",
    token: process.env.DOCKER_HUB_TOKEN?.trim() || "",
    username: process.env.DOCKER_HUB_USERNAME?.trim() || "",
  };
}

function normalizeIssue(endpoint: string, error: unknown): DockerHubIssue {
  return {
    endpoint,
    message: error instanceof Error ? error.message : "Unknown Docker request failure",
    requiredPrivileges: [],
  };
}

function dedupeIssues(issues: DockerHubIssue[]) {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    const key = `${issue.endpoint}:${issue.message}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function sanitizeQueryValue(value: string) {
  return value.trim();
}

function validateDockerName(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || !/^[a-z0-9][a-z0-9._/-]{0,255}$/.test(trimmed)) {
    throw new Error(`Invalid ${label}: "${trimmed.slice(0, 50)}".`);
  }
  return trimmed;
}

function sanitizeErrorBody(body: string): string {
  return body
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/Basic\s+\S+/gi, "Basic [REDACTED]")
    .replace(/token=[^\s&"]+/gi, "token=[REDACTED]")
    .replace(/password=[^\s&"]+/gi, "password=[REDACTED]")
    .replace(/access_token=[^\s&"]+/gi, "access_token=[REDACTED]")
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, "[REDACTED-UUID]")
    .slice(0, 200)
    .trim();
}

function safeSegment(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_");
}

async function isRealDirectory(fullPath: string): Promise<boolean> {
  try {
    const stats = await lstat(fullPath);
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

function platformToString(platform: Partial<RegistryPlatform>) {
  const os = platform.os || "linux";
  const architecture = platform.architecture || "amd64";
  const variant = platform.variant ? `/${platform.variant}` : "";

  return `${os}/${architecture}${variant}`;
}

function platformToSlug(platform: ParsedPlatform) {
  return `${safeSegment(platform.os)}-${safeSegment(platform.architecture)}${
    platform.variant ? `-${safeSegment(platform.variant)}` : ""
  }`;
}

function parsePlatform(value: string): ParsedPlatform {
  const [os = "linux", architecture = "amd64", variant = ""] = value
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!os || !architecture) {
    throw new Error(
      `Invalid platform "${value}". Use the format os/architecture, for example linux/amd64.`,
    );
  }

  return {
    architecture,
    os,
    variant,
  };
}

function digestToPath(rootPath: string, digest: string) {
  const match = digest.match(/^(sha256|sha384|sha512):([a-f0-9]{64,128})$/);
  if (!match) {
    throw new Error(`Invalid or unsupported digest format: "${digest.slice(0, 80)}".`);
  }
  const [, algorithm, encoded] = match;
  return path.join(rootPath, "blobs", algorithm, encoded);
}

function mapRepository(
  repository: DockerHubRepositoryResponse,
): DockerHubRepository {
  return {
    description: repository.description?.trim() || "No description provided.",
    fullName: `${repository.namespace}/${repository.name}`,
    isOfficial: repository.namespace === "library",
    isPrivate: Boolean(repository.is_private),
    lastUpdated: repository.last_updated ?? null,
    name: repository.name,
    namespace: repository.namespace,
    path: `/images/${encodeURIComponent(repository.namespace)}/${encodeURIComponent(
      repository.name,
    )}`,
    pullCount: repository.pull_count ?? 0,
    starCount: repository.star_count ?? 0,
    storageSize: formatBytes(repository.storage_size ?? 0),
  };
}

function parseSearchRepositoryIdentity(repository: DockerHubSearchRepositoryResponse) {
  const repoName = sanitizeQueryValue(repository.repo_name);

  if (!repoName) {
    throw new Error("Docker Hub search result did not include a repository name.");
  }

  const segments = repoName.split("/").filter(Boolean);

  if (segments.length >= 2) {
    const [namespace, ...nameSegments] = segments;

    return {
      name: nameSegments.join("/"),
      namespace,
    };
  }

  return {
    name: repoName,
    namespace:
      repository.is_official
        ? "library"
        : sanitizeQueryValue(repository.repo_owner || "") || "library",
  };
}

function mapSearchRepository(
  repository: DockerHubSearchRepositoryResponse,
): DockerHubRepository {
  const identity = parseSearchRepositoryIdentity(repository);

  return {
    description: repository.short_description?.trim() || "No description provided.",
    fullName: `${identity.namespace}/${identity.name}`,
    isOfficial: Boolean(repository.is_official) || identity.namespace === "library",
    isPrivate: false,
    lastUpdated: null,
    name: identity.name,
    namespace: identity.namespace,
    path: `/images/${encodeURIComponent(identity.namespace)}/${encodeURIComponent(
      identity.name,
    )}`,
    pullCount: repository.pull_count ?? 0,
    starCount: repository.star_count ?? 0,
    storageSize: "Unavailable",
  };
}

function mapTag(tag: DockerHubTagResponse): DockerHubTag {
  const platforms = (tag.images ?? [])
    .filter((image) => image.os && image.architecture && image.os !== "unknown")
    .map((image) =>
      platformToString({
        architecture: image.architecture,
        os: image.os,
        variant: image.variant ?? undefined,
      }),
    )
    .filter((value, index, values) => values.indexOf(value) === index);

  return {
    digest: tag.digest ?? "Unavailable",
    fullSize: formatBytes(tag.full_size ?? 0),
    lastUpdated: tag.last_updated ?? null,
    mediaType: tag.media_type ?? "Unavailable",
    name: tag.name,
    platforms,
  };
}

async function dockerHubRequest<T>(endpoint: string): Promise<T> {
  const response = await fetch(new URL(endpoint, DOCKER_HUB_API_URL), {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Docker Hub request failed (${response.status}). ${sanitizeErrorBody(body)}`,
    );
  }

  return (await response.json()) as T;
}

async function getRegistryToken(repositoryPath: string) {
  const config = await getConfig();
  const url = new URL(DOCKER_AUTH_URL);

  url.searchParams.set("service", "registry.docker.io");
  url.searchParams.set("scope", `repository:${repositoryPath}:pull`);

  const headers = new Headers();

  if (config.username && config.token) {
    headers.set(
      "Authorization",
      `Basic ${Buffer.from(`${config.username}:${config.token}`).toString("base64")}`,
    );
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Docker registry token request failed (${response.status}). ${sanitizeErrorBody(body)}`,
    );
  }

  const payload = (await response.json()) as RegistryTokenResponse;
  const token = payload.token ?? payload.access_token;

  if (!token) {
    throw new Error("Docker registry token response did not include a bearer token.");
  }

  return token;
}

async function fetchRegistryManifest(
  repositoryPath: string,
  reference: string,
  token: string,
): Promise<RegistryManifestResult> {
  const response = await fetch(
    `${DOCKER_REGISTRY_URL}/v2/${repositoryPath}/manifests/${reference}`,
    {
      cache: "no-store",
      headers: {
        Accept: MANIFEST_ACCEPT,
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Docker registry manifest request failed (${response.status}). ${sanitizeErrorBody(body)}`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const digest =
    response.headers.get("docker-content-digest") ||
    `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
  const contentType =
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "application/vnd.oci.image.manifest.v1+json";
  const payload = JSON.parse(buffer.toString("utf8")) as RegistryManifestPayload;

  return {
    buffer,
    digest,
    mediaType: contentType,
    payload,
    size: buffer.byteLength,
  };
}

async function ensureDirectory(directoryPath: string) {
  await mkdir(directoryPath, { recursive: true });
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeBufferIfMissing(filePath: string, buffer: Buffer) {
  if (await fileExists(filePath)) {
    return;
  }

  await ensureDirectory(path.dirname(filePath));
  await writeFile(filePath, buffer);
}

async function downloadBlob(
  repositoryPath: string,
  digest: string,
  token: string,
  rootPath: string,
) {
  const MAX_BLOB_SIZE_BYTES = 10 * 1024 * 1024 * 1024;

  const outputPath = digestToPath(rootPath, digest);

  if (await fileExists(outputPath)) {
    const blobStat = await stat(outputPath);
    return blobStat.size;
  }

  await ensureDirectory(path.dirname(outputPath));

  const response = await fetch(
    `${DOCKER_REGISTRY_URL}/v2/${repositoryPath}/blobs/${digest}`,
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      redirect: "follow",
    },
  );

  if (!response.ok || !response.body) {
    const body = await response.text();
    throw new Error(
      `Docker registry blob download failed (${response.status}). ${sanitizeErrorBody(body)}`,
    );
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BLOB_SIZE_BYTES) {
    throw new Error(`Blob size exceeds maximum allowed (${MAX_BLOB_SIZE_BYTES} bytes).`);
  }

  const reader = response.body.getReader();
  const output = createWriteStream(outputPath);
  let totalBytesWritten = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      totalBytesWritten += value.byteLength;
      if (totalBytesWritten > MAX_BLOB_SIZE_BYTES) {
        output.destroy();
        throw new Error("Blob download exceeded maximum allowed size.");
      }

      if (!output.write(value)) {
        await once(output, "drain");
      }
    }
  } finally {
    output.end();
  }

  await once(output, "finish");

  const blobStat = await stat(outputPath);

  return blobStat.size;
}

function selectPlatformManifest(
  manifest: RegistryManifestResult,
  desiredPlatform: ParsedPlatform,
) {
  const payload = manifest.payload as RegistryIndexResponse;
  const manifests = payload.manifests ?? [];
  const selected = manifests.find((entry) => {
    const platform = entry.platform ?? {};

    if (platform.os !== desiredPlatform.os) {
      return false;
    }

    if (platform.architecture !== desiredPlatform.architecture) {
      return false;
    }

    if (desiredPlatform.variant) {
      return platform.variant === desiredPlatform.variant;
    }

    return true;
  });

  if (!selected) {
    const availablePlatforms = manifests
      .filter((entry) => entry.platform?.os && entry.platform?.architecture)
      .map((entry) => platformToString(entry.platform ?? {}))
      .join(", ");

    throw new Error(
      availablePlatforms
        ? `No manifest found for platform ${platformToString(
            desiredPlatform,
          )}. Available platforms: ${availablePlatforms}.`
        : `No manifest found for platform ${platformToString(desiredPlatform)}.`,
    );
  }

  return selected;
}

function isManifestIndex(mediaType: string) {
  return (
    mediaType === "application/vnd.oci.image.index.v1+json" ||
    mediaType === "application/vnd.docker.distribution.manifest.list.v2+json"
  );
}

async function writeOciLayout(
  destinationPath: string,
  manifest: RegistryManifestResult,
  tag: string,
) {
  await writeFile(
    path.join(destinationPath, "oci-layout"),
    JSON.stringify({ imageLayoutVersion: "1.0.0" }, null, 2),
  );

  const indexPayload = {
    manifests: [
      {
        annotations: {
          "org.opencontainers.image.ref.name": tag,
        },
        digest: manifest.digest,
        mediaType: manifest.mediaType,
        size: manifest.size,
      },
    ],
    schemaVersion: 2,
  };

  await writeFile(
    path.join(destinationPath, "index.json"),
    JSON.stringify(indexPayload, null, 2),
  );
}

async function readArtifactMeta(filePath: string) {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as StoredArtifactMeta;
  } catch {
    return null;
  }
}

export function invalidateDockerLibraryInventory() {
  libraryInventoryCache = null;
}

async function scanInstalledArtifacts(): Promise<DockerLibraryInventory> {
  const config = await getConfig();
  const issues: DockerHubIssue[] = [];

  if (!config.libraryPath) {
    return {
      artifacts: [],
      configured: false,
      issues: [
        {
          endpoint: "Docker library path",
          message:
            "The Docker image library path is not configured yet. Set it in Settings → Docker image library (e.g. /app/data/docker-library, which works with no redeploy), or via the DOCKER_LIBRARY_PATH env var.",
          requiredPrivileges: [],
        },
      ],
      path: "",
      totalSizeBytes: 0,
      totalSizeLabel: formatBytes(0),
    };
  }

  try {
    const namespaces = await readdir(config.libraryPath, { withFileTypes: true });
    const namespaceDirs = (
      await Promise.all(
        namespaces.map(async (entry) => {
          const fullPath = path.join(config.libraryPath, entry.name);
          return (await isRealDirectory(fullPath)) ? entry : null;
        }),
      )
    ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const artifactGroups = await Promise.all(
      namespaceDirs.map(async (namespaceEntry) => {
          const namespacePath = path.join(config.libraryPath, namespaceEntry.name);
          const repositories = await readdir(namespacePath, { withFileTypes: true });
          const repoDirs = (
            await Promise.all(
              repositories.map(async (entry) => {
                const fullPath = path.join(namespacePath, entry.name);
                return (await isRealDirectory(fullPath)) ? entry : null;
              }),
            )
          ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

          const repositoryGroups = await Promise.all(
            repoDirs.map(async (repositoryEntry) => {
                const repositoryPath = path.join(namespacePath, repositoryEntry.name);
                const tags = await readdir(repositoryPath, { withFileTypes: true });
                const tagDirs = (
                  await Promise.all(
                    tags.map(async (entry) => {
                      const fullPath = path.join(repositoryPath, entry.name);
                      return (await isRealDirectory(fullPath)) ? entry : null;
                    }),
                  )
                ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

                const tagGroups = await Promise.all(
                  tagDirs.map(async (tagEntry) => {
                      const tagPath = path.join(repositoryPath, tagEntry.name);
                      const platforms = await readdir(tagPath, { withFileTypes: true });
                      const platformDirs = (
                        await Promise.all(
                          platforms.map(async (entry) => {
                            const fullPath = path.join(tagPath, entry.name);
                            return (await isRealDirectory(fullPath)) ? entry : null;
                          }),
                        )
                      ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

                      const artifactEntries = await Promise.all(
                        platformDirs.map(async (platformEntry) => {
                            const artifactPath = path.join(tagPath, platformEntry.name);
                            const meta = await readArtifactMeta(path.join(artifactPath, "meta.json"));

                            if (!meta) {
                              return null;
                            }

                            return {
                              digest: meta.digest,
                              downloadedAt: meta.downloadedAt ?? null,
                              id: `${meta.reference}:${meta.platform}`,
                              namespace: meta.namespace,
                              path: artifactPath,
                              platform: meta.platform,
                              reference: meta.reference,
                              repository: meta.repository,
                              sizeBytes: meta.sizeBytes,
                              sizeLabel: formatBytes(meta.sizeBytes),
                              tag: meta.tag,
                            } as DockerLibraryArtifact;
                          }),
                      );

                      return artifactEntries.filter(
                        (entry): entry is DockerLibraryArtifact => Boolean(entry),
                      );
                    }),
                );

                return tagGroups.flat();
              }),
          );

          return repositoryGroups.flat();
        }),
    );

    const artifacts = artifactGroups.flat();
    const totalSizeBytes = artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0);

    artifacts.sort((left, right) => {
      const leftDate = left.downloadedAt ? new Date(left.downloadedAt).getTime() : 0;
      const rightDate = right.downloadedAt ? new Date(right.downloadedAt).getTime() : 0;

      return rightDate - leftDate;
    });

    return {
      artifacts,
      configured: true,
      issues,
      path: config.libraryPath,
      totalSizeBytes,
      totalSizeLabel: formatBytes(totalSizeBytes),
    };
  } catch (error) {
    issues.push(normalizeIssue("Docker library path", error));

    return {
      artifacts: [],
      configured: true,
      issues,
      path: config.libraryPath,
      totalSizeBytes: 0,
      totalSizeLabel: formatBytes(0),
    };
  }
}

async function listInstalledArtifacts(): Promise<DockerLibraryInventory> {
  const { libraryPath } = await getConfig();
  const pathKey = libraryPath || "__unconfigured__";

  if (
    libraryInventoryCache &&
    libraryInventoryCache.path === pathKey &&
    libraryInventoryCache.expiresAt > Date.now()
  ) {
    return libraryInventoryCache.value;
  }

  if (libraryInventoryInflight && libraryInventoryInflightPath === pathKey) {
    return libraryInventoryInflight;
  }

  libraryInventoryInflightPath = pathKey;
  libraryInventoryInflight = scanInstalledArtifacts()
    .then((value) => {
      libraryInventoryCache = {
        expiresAt: Date.now() + LIBRARY_INVENTORY_TTL_MS,
        path: pathKey,
        value,
      };
      return value;
    })
    .finally(() => {
      libraryInventoryInflight = null;
      libraryInventoryInflightPath = "";
    });

  return libraryInventoryInflight;
}

async function listNamespaceRepositories(
  namespace: string,
  nameFilter: string,
  page: number,
) {
  const searchParams = new URLSearchParams({
    page: String(page),
    page_size: String(DEFAULT_PAGE_SIZE),
  });

  if (nameFilter) {
    searchParams.set("name", nameFilter);
  }

  return dockerHubRequest<DockerHubListResponse<DockerHubRepositoryResponse>>(
    `/v2/namespaces/${encodeURIComponent(namespace)}/repositories?${searchParams.toString()}`,
  );
}

async function searchRepositories(query: string, page: number) {
  const searchParams = new URLSearchParams({
    page: String(page),
    page_size: String(DEFAULT_PAGE_SIZE),
    query,
  });

  return dockerHubRequest<DockerHubListResponse<DockerHubSearchRepositoryResponse>>(
    `/v2/search/repositories/?${searchParams.toString()}`,
  );
}

async function getRepository(namespace: string, repository: string) {
  return dockerHubRequest<DockerHubRepositoryResponse>(
    `/v2/namespaces/${encodeURIComponent(namespace)}/repositories/${encodeURIComponent(
      repository,
    )}`,
  );
}

async function listRepositoryTags(namespace: string, repository: string) {
  const searchParams = new URLSearchParams({
    page_size: String(DEFAULT_TAG_PAGE_SIZE),
  });

  return dockerHubRequest<DockerHubListResponse<DockerHubTagResponse>>(
    `/v2/namespaces/${encodeURIComponent(
      namespace,
    )}/repositories/${encodeURIComponent(repository)}/tags?${searchParams.toString()}`,
  );
}

export async function getDockerHubOverview(input?: {
  name?: string;
  namespace?: string;
  page?: string;
}): Promise<DockerHubOverview> {
  const config = await getConfig();
  const issues: DockerHubIssue[] = [];
  const namespace = sanitizeQueryValue(input?.namespace || config.defaultNamespace);
  const nameFilter = sanitizeQueryValue(input?.name || "");
  const parsedPage = Number.parseInt(input?.page ?? "1", 10);
  const page = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
  const inventory = await listInstalledArtifacts();

  issues.push(...inventory.issues);

  try {
    if (nameFilter) {
      const response = await searchRepositories(nameFilter, page);

      return {
        issues: dedupeIssues(issues),
        inventory,
        nameFilter,
        namespace,
        page,
        repositories: response.results.map(mapSearchRepository),
        searchMode: "global",
        totalRepositories: response.count,
      };
    }

    const response = await listNamespaceRepositories(namespace, "", page);

    return {
      issues: dedupeIssues(issues),
      inventory,
      nameFilter,
      namespace,
      page,
      repositories: response.results.map(mapRepository),
      searchMode: "namespace",
      totalRepositories: response.count,
    };
  } catch (error) {
    issues.push(normalizeIssue("Docker Hub repositories", error));

    return {
      issues: dedupeIssues(issues),
      inventory,
      nameFilter,
      namespace,
      page,
      repositories: [],
      searchMode: nameFilter ? "global" : "namespace",
      totalRepositories: null,
    };
  }
}

export async function getDockerHubRepositoryDetail(
  namespace: string,
  repository: string,
): Promise<DockerHubRepositoryDetail> {
  namespace = validateDockerName(namespace, "namespace");
  repository = validateDockerName(repository, "repository");
  const config = await getConfig();
  const issues: DockerHubIssue[] = [];
  const inventory = await listInstalledArtifacts();

  issues.push(...inventory.issues);

  try {
    const [repositoryResponse, tagResponse] = await Promise.all([
      getRepository(namespace, repository),
      listRepositoryTags(namespace, repository),
    ]);

    return {
      defaultPlatform: config.defaultPlatform,
      inventory: {
        ...inventory,
        artifacts: inventory.artifacts.filter(
          (artifact) =>
            artifact.namespace === namespace && artifact.repository === repository,
        ),
      },
      issues: dedupeIssues(issues),
      repository: mapRepository(repositoryResponse),
      tags: tagResponse.results.map(mapTag),
    };
  } catch (error) {
    issues.push(normalizeIssue("Docker Hub repository", error));

    return {
      defaultPlatform: config.defaultPlatform,
      inventory: {
        ...inventory,
        artifacts: inventory.artifacts.filter(
          (artifact) =>
            artifact.namespace === namespace && artifact.repository === repository,
        ),
      },
      issues: dedupeIssues(issues),
      repository: null,
      tags: [],
    };
  }
}

export async function fetchImageEnvVars(input: {
  namespace: string;
  platform?: string;
  repository: string;
  tag: string;
}): Promise<string[]> {
  const config = await getConfig();
  const namespace = validateDockerName(input.namespace, "namespace");
  const repository = validateDockerName(input.repository, "repository");
  const tag = sanitizeQueryValue(input.tag);
  const desiredPlatform = parsePlatform(input.platform || config.defaultPlatform);
  const repositoryPath = `${namespace}/${repository}`;

  const token = await getRegistryToken(repositoryPath);
  const initialManifest = await fetchRegistryManifest(repositoryPath, tag, token);
  const selectedManifest = isManifestIndex(initialManifest.mediaType)
    ? await fetchRegistryManifest(
        repositoryPath,
        selectPlatformManifest(initialManifest, desiredPlatform).digest,
        token,
      )
    : initialManifest;
  const imageManifest = selectedManifest.payload as RegistryImageManifest;

  const response = await fetch(
    `${DOCKER_REGISTRY_URL}/v2/${repositoryPath}/blobs/${imageManifest.config.digest}`,
    {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
      redirect: "follow",
    },
  );

  if (!response.ok) return [];

  const imageConfig = (await response.json()) as OciImageConfig;
  return imageConfig.config?.Env ?? [];
}

export async function syncDockerImage(input: {
  namespace: string;
  platform: string;
  repository: string;
  tag: string;
}): Promise<SyncResult> {
  const config = await getConfig();

  if (!config.libraryPath) {
    throw new Error(
      "DOCKER_LIBRARY_PATH is not configured. Point it at the mounted Samba share path before syncing images.",
    );
  }

  const namespace = validateDockerName(input.namespace, "namespace");
  const repository = validateDockerName(input.repository, "repository");
  const tag = sanitizeQueryValue(input.tag);

  if (!namespace || !repository || !tag) {
    throw new Error("Namespace, repository, and tag are required.");
  }

  const desiredPlatform = parsePlatform(input.platform || config.defaultPlatform);
  const repositoryPath = `${namespace}/${repository}`;
  const token = await getRegistryToken(repositoryPath);
  const initialManifest = await fetchRegistryManifest(repositoryPath, tag, token);
  const selectedManifest = isManifestIndex(initialManifest.mediaType)
    ? await fetchRegistryManifest(
        repositoryPath,
        selectPlatformManifest(initialManifest, desiredPlatform).digest,
        token,
      )
    : initialManifest;
  const imageManifest = selectedManifest.payload as RegistryImageManifest;
  const destinationPath = path.join(
    config.libraryPath,
    safeSegment(namespace),
    safeSegment(repository),
    safeSegment(tag),
    platformToSlug(desiredPlatform),
  );
  const manifestBlobPath = digestToPath(destinationPath, selectedManifest.digest);

  await ensureDirectory(destinationPath);
  await writeBufferIfMissing(manifestBlobPath, selectedManifest.buffer);

  let sizeBytes = selectedManifest.size;

  sizeBytes += await downloadBlob(
    repositoryPath,
    imageManifest.config.digest,
    token,
    destinationPath,
  );

  for (const layer of imageManifest.layers) {
    sizeBytes += await downloadBlob(repositoryPath, layer.digest, token, destinationPath);
  }

  await writeOciLayout(destinationPath, selectedManifest, tag);

  let envVars: string[] = [];
  try {
    const configBlobPath = digestToPath(destinationPath, imageManifest.config.digest);
    const configBlob = await readFile(configBlobPath, "utf8");
    const imageConfig = JSON.parse(configBlob) as OciImageConfig;
    envVars = imageConfig.config?.Env ?? [];
  } catch {
  }

  const meta: StoredArtifactMeta = {
    digest: selectedManifest.digest,
    downloadedAt: new Date().toISOString(),
    namespace,
    platform: platformToString(desiredPlatform),
    reference: `${namespace}/${repository}:${tag}`,
    repository,
    sizeBytes,
    tag,
  };

  await writeFile(
    path.join(destinationPath, "meta.json"),
    JSON.stringify(meta, null, 2),
  );

  invalidateDockerLibraryInventory();

  return {
    artifactPath: destinationPath,
    digest: selectedManifest.digest,
    envVars,
    platform: meta.platform,
    reference: meta.reference,
    sizeBytes,
  };
}
