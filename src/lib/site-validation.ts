import "server-only";

import https from "node:https";
import http from "node:http";

import { getExtraCaCerts } from "@/lib/aia-fetch";
import type { ResolvedSiteConfig, SiteValidationResult } from "@/lib/site-types";
import { buildProxmoxUrl } from "@/lib/utils";

const VALIDATION_TIMEOUT_MS = 5_000;

export async function validateSiteConnection(
  config: ResolvedSiteConfig,
): Promise<SiteValidationResult> {
  const start = Date.now();

  try {
    const isHttps = new URL(config.apiUrl).protocol === "https:";
    const transport = isHttps ? https : http;

    let extraTlsOpts: { ca?: string[] } = {};
    if (isHttps && !config.tlsInsecure) {
      const extras: string[] = [];
      if (config.tlsCustomCaPem) extras.push(config.tlsCustomCaPem);
      try {
        const parsed = new URL(config.apiUrl);
        const aiaCerts = await Promise.race([
          getExtraCaCerts(parsed.hostname, parsed.port || "8006"),
          new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 3000)),
        ]);
        if (aiaCerts.length > 0) extras.push(...aiaCerts);
      } catch { /* proceed without */ }
      if (extras.length > 0) {
        const { rootCertificates } = await import("node:tls");
        extraTlsOpts = { ca: [...new Set([...rootCertificates, ...extras])] };
      }
    }

    const baseTlsOpts = { rejectUnauthorized: !config.tlsInsecure, ...extraTlsOpts };

    const loginUrl = buildProxmoxUrl("/api2/json/access/ticket", config.apiUrl);
    const loginBody = new URLSearchParams({
      username: config.username,
      password: config.password,
    }).toString();

    const ticket = await new Promise<string>((resolve, reject) => {
      const req = transport.request(
        loginUrl,
        {
          method: "POST",
          headers: {
            "Content-Length": Buffer.byteLength(loginBody),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          ...baseTlsOpts,
        },
        (res) => {
          let raw = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => { raw += chunk; });
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`Login failed (HTTP ${res.statusCode}) — check username and password.`));
              return;
            }
            try {
              const parsed = JSON.parse(raw);
              if (!parsed.data?.ticket) {
                reject(new Error("Login failed — invalid credentials."));
                return;
              }
              resolve(parsed.data.ticket as string);
            } catch {
              reject(new Error(`Invalid response from Proxmox login endpoint (${res.statusCode}).`));
            }
          });
        },
      );
      req.on("error", reject);
      req.setTimeout(VALIDATION_TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error(`Connection timed out after ${VALIDATION_TIMEOUT_MS}ms.`));
      });
      req.write(loginBody);
      req.end();
    });

    const versionUrl = buildProxmoxUrl("/api2/json/version", config.apiUrl);

    const data = await new Promise<{ version?: string; release?: string }>((resolve, reject) => {
      const req = transport.request(
        versionUrl,
        {
          headers: { Cookie: `PVEAuthCookie=${ticket}` },
          method: "GET",
          ...baseTlsOpts,
        },
        (res) => {
          let raw = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => { raw += chunk; });
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
              return;
            }
            try {
              const parsed = JSON.parse(raw) as {
                data?: { version?: string; release?: string };
              };
              resolve(parsed.data ?? {});
            } catch {
              const preview = raw.slice(0, 120).trim();
              reject(new Error(
                `Invalid JSON response from Proxmox API. Got (${res.statusCode}): ${preview || "(empty body)"}`,
              ));
            }
          });
        },
      );

      req.on("error", reject);
      req.setTimeout(VALIDATION_TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error(`Connection timed out after ${VALIDATION_TIMEOUT_MS}ms.`));
      });
      req.end();
    });

    let nodes: { name: string; fingerprint: string }[] | undefined;
    try {
      const nodesUrl = buildProxmoxUrl("/api2/json/nodes", config.apiUrl);
      const nodesData = await new Promise<{ node: string; ssl_fingerprint?: string }[]>((resolve, reject) => {
        const req = transport.request(
          nodesUrl,
          {
            headers: { Cookie: `PVEAuthCookie=${ticket}` },
            method: "GET",
            ...baseTlsOpts,
          },
          (res) => {
            let raw = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => { raw += chunk; });
            res.on("end", () => {
              try {
                const parsed = JSON.parse(raw) as { data?: { node: string; ssl_fingerprint?: string }[] };
                resolve(parsed.data ?? []);
              } catch {
                resolve([]);
              }
            });
          },
        );
        req.on("error", () => resolve([]));
        req.setTimeout(VALIDATION_TIMEOUT_MS, () => { req.destroy(); resolve([]); });
        req.end();
      });

      if (nodesData.length > 0) {
        nodes = nodesData
          .filter((n) => n.ssl_fingerprint)
          .map((n) => ({ name: n.node, fingerprint: n.ssl_fingerprint! }));
      }
    } catch {
      // best-effort
    }

    const latencyMs = Date.now() - start;
    const version = data.version
      ? `${data.version}${data.release ? `-${data.release}` : ""}`
      : null;

    return {
      ok: true,
      latencyMs,
      version,
      nodes,
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    const message =
      error instanceof Error ? error.message : "Unknown connection error.";

    return {
      ok: false,
      latencyMs,
      version: null,
      message,
    };
  }
}
