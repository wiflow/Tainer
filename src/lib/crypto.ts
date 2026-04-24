import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";

import { getDataDirectoryPath, resolveDataFilePath } from "@/lib/app-data";

let cachedSecret: Buffer | null = null;
let secretInitPromise: Promise<Buffer> | null = null;

async function loadOrCreateSecret(): Promise<Buffer> {
  if (process.env.AUTH_SECRET?.trim()) {
    return createHash("sha256").update(process.env.AUTH_SECRET.trim()).digest();
  }

  try {
    const raw = await readFile(await resolveDataFilePath("auth-secret.txt"), "utf8");
    return Buffer.from(raw.trim(), "base64");
  } catch {
    const secret = randomBytes(32);
    const filePath = await resolveDataFilePath("auth-secret.txt");
    await mkdir(getDataDirectoryPath(), { recursive: true });
    // Use wx flag (exclusive create) to avoid race conditions on first boot.
    // If another request already created the file, re-read it instead.
    try {
      await writeFile(filePath, `${secret.toString("base64")}\n`, { encoding: "utf8", flag: "wx" });
      await chmod(filePath, 0o600);
      return secret;
    } catch {
      // Another concurrent request won the race; read their secret
      const raw = await readFile(filePath, "utf8");
      return Buffer.from(raw.trim(), "base64");
    }
  }
}

export async function getAuthSecret() {
  if (cachedSecret) return cachedSecret;

  // Serialize concurrent calls so only one initialization occurs
  if (!secretInitPromise) {
    secretInitPromise = loadOrCreateSecret().then((secret) => {
      cachedSecret = secret;
      secretInitPromise = null;
      return secret;
    }).catch((err) => {
      secretInitPromise = null;
      throw err;
    });
  }

  return secretInitPromise;
}

export async function encryptText(value: string) {
  const secret = await getAuthSecret();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export async function decryptText(value: string) {
  const [ivRaw, tagRaw, encryptedRaw] = value.split(".");

  if (!ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("Invalid encrypted payload.");
  }

  const secret = await getAuthSecret();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    secret,
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
