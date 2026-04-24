import "server-only";

import http from "node:http";
import https from "node:https";

export const CLOUD_STORAGE_KEY = "__cloud__";

export function isCloudBackupEnabled(): boolean {
  return process.env.TAINER_CLOUD_BACKUP === "true";
}

function getCloudConfig() {
  const url = process.env.TAINER_CLOUD_BACKUP_URL;
  const token = process.env.TAINER_CLOUD_BACKUP_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

function getTunnelProxy(): string | null {
  return process.env.TAINER_TUNNEL_PROXY || null;
}

// Agent uploads directly to SaaS via HTTPS rather than through the WS tunnel for performance
export async function requestCloudUpload(
  node: string,
  storage: string,
  filename: string,
): Promise<{ success: boolean; sizeBytes?: number; error?: string }> {
  const cloud = getCloudConfig();
  const tunnelProxy = getTunnelProxy();
  if (!cloud || !tunnelProxy) return { success: false, error: "Cloud backup not configured" };

  const body = JSON.stringify({
    node,
    storage,
    filename,
    uploadUrl: cloud.url,
    token: cloud.token,
  });

  const url = new URL("/__tainer__/cloud-upload", tunnelProxy);

  return new Promise((resolve) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
      rejectUnauthorized: false,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch {
          resolve({ success: false, error: "Invalid response from agent" });
        }
      });
    });

    req.on("error", (err) => resolve({ success: false, error: err.message }));
    req.setTimeout(600000, () => { req.destroy(); resolve({ success: false, error: "Upload timeout" }); });
    req.write(body);
    req.end();
  });
}

export type CloudBackupEntry = {
  filename: string;
  sizeBytes: number;
  createdAt: string;
};

export async function listCloudBackups(): Promise<CloudBackupEntry[]> {
  const cloud = getCloudConfig();
  if (!cloud) return [];

  const url = new URL(`/api/backup/list?token=${cloud.token}`, cloud.url);

  return new Promise((resolve) => {
    const mod = url.protocol === "https:" ? https : http;
    mod.get(url, { rejectUnauthorized: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          resolve(data.backups ?? []);
        } catch {
          resolve([]);
        }
      });
    }).on("error", () => resolve([]));
  });
}

export async function deleteCloudBackup(filename: string): Promise<boolean> {
  const cloud = getCloudConfig();
  if (!cloud) return false;

  const url = new URL(
    `/api/backup/delete?token=${cloud.token}&filename=${encodeURIComponent(filename)}`,
    cloud.url,
  );

  return new Promise((resolve) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(url, { method: "DELETE", rejectUnauthorized: false }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.end();
  });
}
