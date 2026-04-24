import { NextResponse } from "next/server";

import { verifyGuestShellStepUp } from "@/lib/auth";

function validateOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return; // non-browser client, SameSite cookies still protect
  try {
    const originUrl = new URL(origin);
    // Use x-forwarded-host (reverse proxy) or Host header instead of request.url,
    // which may reflect the internal server address behind a proxy.
    const expectedHost =
      request.headers.get("x-forwarded-host") ||
      request.headers.get("host") ||
      new URL(request.url).host;
    if (originUrl.host !== expectedHost) {
      throw new Error("Cross-origin request rejected.");
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("Cross-origin")) throw e;
    throw new Error("Invalid request origin.");
  }
}

export async function POST(request: Request) {
  try {
    validateOrigin(request);
    const payload = (await request.json()) as { code?: string };
    const code = String(payload.code ?? "").trim();

    if (!code) {
      return NextResponse.json({ error: "Authenticator code or recovery code is required." }, { status: 400 });
    }

    const result = await verifyGuestShellStepUp(code);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to verify 2FA challenge." },
      { status: 400 },
    );
  }
}
