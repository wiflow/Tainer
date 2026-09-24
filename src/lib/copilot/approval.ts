import "server-only";

import { createHash } from "node:crypto";

import { decryptText, encryptText } from "@/lib/crypto";
import type { ApprovalPayload } from "@/lib/copilot/types";

const APPROVAL_TTL_MS = 5 * 60 * 1000;

const consumedTokens = new Map<string, number>();

/**
 * Mint a signed, encrypted approval token. The payload is AES-256-GCM
 * encrypted under AUTH_SECRET, so the token is opaque to the client and
 * cannot be tampered with — the server is the only party that knows what
 * will run when the token is presented at /api/copilot/approve.
 *
 * The client receives the token AND a separate display blob (toolName +
 * args). The display blob is what the user sees in the approval card;
 * the token is what gets executed. If the client tampers with the
 * display blob they get a confused UI, but the server still only runs
 * whatever is inside the encrypted token.
 */
export async function mintApprovalToken(
  input: Omit<ApprovalPayload, "v" | "expiresAt">,
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Date.now() + APPROVAL_TTL_MS;
  const payload: ApprovalPayload = {
    v: 1,
    expiresAt,
    ...input,
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
    // Belt-and-braces: an attacker who exfiltrated another user's token
    // can't replay it on their own session.
    throw new Error("Approval token does not match the current user.");
  }

  return decoded;
}

/** Verify a token and mark it used, so each approval runs at most once. */
export async function consumeApprovalToken(
  token: string,
  expectedUserId: string,
): Promise<ApprovalPayload> {
  const payload = await verifyApprovalToken(token, expectedUserId);
  const now = Date.now();
  for (const [key, expiresAt] of consumedTokens) {
    if (expiresAt <= now) consumedTokens.delete(key);
  }
  const digest = createHash("sha256").update(token).digest("hex");
  if (consumedTokens.has(digest)) {
    throw new Error("This approval was already used. Ask the assistant again.");
  }
  consumedTokens.set(digest, payload.expiresAt);
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
    (v.siteSlug === null || typeof v.siteSlug === "string") &&
    !!v.args &&
    typeof v.args === "object"
  );
}
