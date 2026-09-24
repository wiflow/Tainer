import "server-only";

import { randomUUID } from "node:crypto";

import { decryptText, encryptText } from "@/lib/crypto";
import type { ApprovalPayload } from "@/lib/copilot/types";

const APPROVAL_TTL_MS = 5 * 60 * 1000;

const consumedTokens = new Map<string, number>();

/** Only the encrypted token decides what runs; client display args are never trusted. */
export async function mintApprovalToken(
  input: Omit<ApprovalPayload, "v" | "expiresAt" | "nonce">,
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Date.now() + APPROVAL_TTL_MS;
  const payload: ApprovalPayload = {
    v: 1,
    expiresAt,
    ...input,
    nonce: randomUUID(),
  };
  const token = await encryptText(JSON.stringify(payload));
  return { token, expiresAt };
}

export async function verifyApprovalToken(
  token: string,
  expectedUserId: string,
): Promise<ApprovalPayload> {
  let decoded: unknown;
  try {
    const raw = await decryptText(token);
    decoded = JSON.parse(raw);
  } catch {
    throw new Error("Invalid approval token.");
  }

  if (!isApprovalPayload(decoded)) {
    throw new Error("Malformed approval token.");
  }

  if (decoded.v !== 1) {
    throw new Error("Unsupported approval token version.");
  }

  if (decoded.expiresAt <= Date.now()) {
    throw new Error("Approval token has expired. Ask the assistant again.");
  }

  if (decoded.userId !== expectedUserId) {
    throw new Error("Approval token does not match the current user.");
  }

  return decoded;
}

export async function consumeApprovalToken(
  token: string,
  expectedUserId: string,
): Promise<ApprovalPayload> {
  const payload = await verifyApprovalToken(token, expectedUserId);
  const now = Date.now();
  for (const [key, expiresAt] of consumedTokens) {
    if (expiresAt <= now) consumedTokens.delete(key);
  }
  const key = `${payload.userId}:${payload.nonce}`;
  if (consumedTokens.has(key)) {
    throw new Error("This approval was already used. Ask the assistant again.");
  }
  consumedTokens.set(key, payload.expiresAt);
  return payload;
}

function isApprovalPayload(value: unknown): value is ApprovalPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    typeof v.toolCallId === "string" &&
    typeof v.toolName === "string" &&
    typeof v.userId === "string" &&
    typeof v.expiresAt === "number" &&
    typeof v.nonce === "string" &&
    v.nonce.length > 0 &&
    (v.siteSlug === null || typeof v.siteSlug === "string") &&
    !!v.args &&
    typeof v.args === "object"
  );
}
