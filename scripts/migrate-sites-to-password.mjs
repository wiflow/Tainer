#!/usr/bin/env node
// Usage: PROXMOX_URL=... PROXMOX_USERNAME=... PROXMOX_PASSWORD=... node <this script>

import { createCipheriv, randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const SITES_FILE = path.join(DATA_DIR, "sites.json");
const SECRET_FILE = path.join(DATA_DIR, "auth-secret.txt");

const NEW_API_URL = process.env.PROXMOX_URL?.trim();
const NEW_USERNAME = process.env.PROXMOX_USERNAME?.trim();
const NEW_PASSWORD = process.env.PROXMOX_PASSWORD;

// Must stay in sync with the format in src/lib/crypto.ts.
async function getSecret() {
  if (process.env.AUTH_SECRET?.trim()) {
    return createHash("sha256").update(process.env.AUTH_SECRET.trim()).digest();
  }
  const raw = await readFile(SECRET_FILE, "utf8");
  return Buffer.from(raw.trim(), "base64");
}

function encrypt(secret, value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

async function main() {
  if (!NEW_API_URL || !NEW_USERNAME || !NEW_PASSWORD) {
    throw new Error("Set PROXMOX_URL, PROXMOX_USERNAME and PROXMOX_PASSWORD.");
  }
  const secret = await getSecret();
  const raw = await readFile(SITES_FILE, "utf8");
  const store = JSON.parse(raw);

  let migrated = 0;

  for (const site of store.sites) {
    const payload = site.payload;

    if (payload.tokenId || payload.tokenSecretEncrypted) {
      console.log(`Migrating site "${site.name}" (${site.slug}) from token → password auth...`);

      payload.apiUrl = NEW_API_URL;

      payload.username = NEW_USERNAME;
      payload.passwordEncrypted = encrypt(secret, NEW_PASSWORD);

      delete payload.tokenId;
      delete payload.tokenSecretEncrypted;

      if (!("tlsCustomCaPem" in payload)) {
        payload.tlsCustomCaPem = null;
      }

      migrated++;
    }
  }

  if (migrated === 0) {
    console.log("No sites need migration — all already use password auth.");
    return;
  }

  await writeFile(SITES_FILE, JSON.stringify(store, null, 2) + "\n");
  console.log(`Done. Migrated ${migrated} site(s). Updated ${SITES_FILE}`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
