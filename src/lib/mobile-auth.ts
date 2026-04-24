import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { getAuthSecret } from "@/lib/crypto";

const JWT_NAMESPACE = "tainer_mobile";
const TOKEN_TTL_DAYS = 14;

type JwtHeader = { alg: "HS256"; typ: "JWT" };
type JwtPayload = {
  exp: number;
  iat: number;
  sessionId: string;
  sub: string; // userId
};

export type MobileTokenClaims = {
  sessionId: string;
  userId: string;
};

function base64urlEncode(data: string): string {
  return Buffer.from(data, "utf8").toString("base64url");
}

function base64urlDecode(encoded: string): string {
  return Buffer.from(encoded, "base64url").toString("utf8");
}

function sign(headerAndPayload: string, secret: Buffer): string {
  return createHmac("sha256", secret)
    .update(`${JWT_NAMESPACE}:${headerAndPayload}`)
    .digest("base64url");
}

export async function generateMobileToken(
  sessionId: string,
  userId: string,
): Promise<string> {
  const secret = await getAuthSecret();
  const now = Math.floor(Date.now() / 1000);

  const header: JwtHeader = { alg: "HS256", typ: "JWT" };
  const payload: JwtPayload = {
    exp: now + TOKEN_TTL_DAYS * 24 * 60 * 60,
    iat: now,
    sessionId,
    sub: userId,
  };

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const headerAndPayload = `${encodedHeader}.${encodedPayload}`;
  const signature = sign(headerAndPayload, secret);

  return `${headerAndPayload}.${signature}`;
}

export async function validateMobileToken(
  token: string,
): Promise<MobileTokenClaims | null> {
  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, providedSignature] = parts;

  if (!encodedHeader || !encodedPayload || !providedSignature) {
    return null;
  }

  const secret = await getAuthSecret();
  const headerAndPayload = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = sign(headerAndPayload, secret);

  // Timing-safe comparison to prevent signature oracle attacks
  const sigA = Buffer.from(providedSignature, "base64url");
  const sigB = Buffer.from(expectedSignature, "base64url");

  if (sigA.length !== sigB.length || !timingSafeEqual(sigA, sigB)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64urlDecode(encodedPayload)) as JwtPayload;

    if (!payload.exp || !payload.iat || !payload.sessionId || !payload.sub) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);

    if (payload.exp <= now) {
      return null;
    }

    return {
      sessionId: payload.sessionId,
      userId: payload.sub,
    };
  } catch {
    return null;
  }
}
