import "server-only";

import https from "node:https";
import http from "node:http";

const DEFAULT_PAGE_SIZE = 20;

type GiteaPackageResponse = {
  created_at?: string;
  id: number;
  name: string;
  type: string;
  version: string;
};

export type GiteaPackage = {
  createdAt: string | null;
  name: string;
  path: string;
  tagCount: number;
  tags: string[];
};

export type GiteaPackageDetail = {
  name: string;
  ociReference: string;
  tags: GiteaTag[];
};

export type GiteaTag = {
  createdAt: string | null;
  name: string;
};

export type GiteaOverview = {
  configured: boolean;
  issues: GiteaIssue[];
  packages: GiteaPackage[];
  page: number;
  query: string;
  totalPackages: number | null;
};

export type GiteaIssue = {
  endpoint: string;
  message: string;
  requiredPrivileges: string[];
};

type GiteaConfig = {
  owner: string;
  tlsInsecure: boolean;
  token: string;
  url: string;
  username: string;
};

function getConfig(): GiteaConfig {
  return {
    owner: process.env.GITEA_OWNER?.trim() || "",
    tlsInsecure: process.env.GITEA_TLS_INSECURE === "true",
    token: process.env.GITEA_TOKEN?.trim() || "",
    url: process.env.GITEA_URL?.trim().replace(/\/+$/, "") || "",
    username: process.env.GITEA_USERNAME?.trim() || "",
  };
}

export function isGiteaConfigured(): boolean {
  const config = getConfig();
  return Boolean(config.url && config.owner);
}

export function buildGiteaOciReference(
  name: string,
  tag: string,
): string {
  const config = getConfig();
  const parsed = safeParseUrl(config.url);
  if (!parsed) return `${config.owner.toLowerCase()}/${name}:${tag}`;

  let host = parsed.hostname;

  // Hostnames without dots (e.g. "infra-repository") are ambiguous to skopeo — adding
  // the explicit port forces it to treat this as a self-hosted registry, not a Docker Hub path.
  if (!host.includes(".") && !host.includes(":")) {
    const defaultPort = parsed.protocol === "https:" ? "443" : "80";
    if (!parsed.port) {
      host = `${host}:${defaultPort}`;
    }
  }
  if (parsed.port) {
    host = `${host}:${parsed.port}`;
  }

  return `${host}/${config.owner.toLowerCase()}/${name.toLowerCase()}:${tag}`;
}

export function buildGiteaTemplateFileName(name: string, tag: string): string {
  return `${name}_${tag}.tar`;
}

function safeParseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function normalizeIssue(endpoint: string, error: unknown): GiteaIssue {
  return {
    endpoint,
    message: error instanceof Error ? error.message : "Unknown Gitea request failure",
    requiredPrivileges: [],
  };
}

function giteaRequest<T>(
  endpoint: string,
): Promise<{ data: T; totalCount: number | null }> {
  const config = getConfig();

  if (!config.url) {
    return Promise.reject(new Error("GITEA_URL is not configured."));
  }

  const url = new URL(`/api/v1${endpoint}`, config.url);
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (config.username && config.token) {
    headers.Authorization = `Basic ${Buffer.from(`${config.username}:${config.token}`).toString("base64")}`;
  } else if (config.token) {
    headers.Authorization = `token ${config.token}`;
  }

  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        headers,
        method: "GET",
        rejectUnauthorized: !config.tlsInsecure,
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { raw += chunk; });
        response.on("end", () => {
          if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) {
            reject(new Error(
              `Gitea request failed (${response.statusCode}). ${raw.slice(0, 300).trim()}`,
            ));
            return;
          }

          try {
            const data = JSON.parse(raw) as T;
            const totalHeader = response.headers["x-total-count"];
            const totalCount = totalHeader
              ? Number.parseInt(String(totalHeader), 10)
              : null;

            resolve({
              data,
              totalCount: Number.isNaN(totalCount) ? null : totalCount,
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    req.on("error", (error) => {
      reject(new Error(`Gitea request failed: ${error.message}`));
    });

    req.end();
  });
}

export async function getGiteaOverview(input?: {
  page?: string;
  q?: string;
}): Promise<GiteaOverview> {
  const config = getConfig();

  if (!config.url || !config.owner) {
    return {
      configured: false,
      issues: [],
      packages: [],
      page: 1,
      query: "",
      totalPackages: null,
    };
  }

  const query = input?.q?.trim() ?? "";
  const parsedPage = Number.parseInt(input?.page ?? "1", 10);
  const page = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;

  try {
    const params = new URLSearchParams({
      limit: String(DEFAULT_PAGE_SIZE),
      page: String(page),
      type: "container",
    });

    if (query) {
      params.set("q", query);
    }

    const { data: versions, totalCount } = await giteaRequest<GiteaPackageResponse[]>(
      `/packages/${encodeURIComponent(config.owner)}?${params.toString()}`,
    );

    // Group by package name — the API returns one entry per version
    const packageMap = new Map<string, { tags: string[]; latest: GiteaPackageResponse }>();

    for (const version of versions) {
      const existing = packageMap.get(version.name);
      if (existing) {
        existing.tags.push(version.version);
        if (
          version.created_at &&
          (!existing.latest.created_at || version.created_at > existing.latest.created_at)
        ) {
          existing.latest = version;
        }
      } else {
        packageMap.set(version.name, {
          latest: version,
          tags: [version.version],
        });
      }
    }

    const packages: GiteaPackage[] = [...packageMap.entries()].map(
      ([name, { tags, latest }]) => ({
        createdAt: latest.created_at ?? null,
        name,
        path: `/images/gitea-registry/${encodeURIComponent(name)}`,
        tagCount: tags.length,
        tags,
      }),
    );

    return {
      configured: true,
      issues: [],
      packages,
      page,
      query,
      totalPackages: totalCount,
    };
  } catch (error) {
    return {
      configured: true,
      issues: [normalizeIssue("Gitea packages", error)],
      packages: [],
      page,
      query,
      totalPackages: null,
    };
  }
}

export async function getGiteaPackageDetail(
  name: string,
): Promise<GiteaPackageDetail | null> {
  const config = getConfig();

  if (!config.url || !config.owner) {
    return null;
  }

  try {
    const params = new URLSearchParams({
      limit: "50",
      q: name,
      type: "container",
    });

    const { data: versions } = await giteaRequest<GiteaPackageResponse[]>(
      `/packages/${encodeURIComponent(config.owner)}?${params.toString()}`,
    );

    // q is a prefix/substring search, so filter to exact name matches
    const matched = versions.filter((v) => v.name === name);

    if (matched.length === 0) {
      return null;
    }

    const tags: GiteaTag[] = matched
      .map((v) => ({
        createdAt: v.created_at ?? null,
        name: v.version,
      }))
      .sort((a, b) => {
        if (a.name === "latest") return -1;
        if (b.name === "latest") return 1;
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });

    return {
      name,
      ociReference: buildGiteaOciReference(name, tags[0]?.name ?? "latest"),
      tags,
    };
  } catch {
    return null;
  }
}
