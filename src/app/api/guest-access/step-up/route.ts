import { NextResponse } from "next/server";

import { recordAdminAudit } from "@/lib/admin-audit-log";
import { getCurrentSession, verifyGuestShellStepUp, type AuthSession } from "@/lib/auth";

function validateOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return; // non-browser client, SameSite cookies still protect
  try {
    const originUrl = new URL(origin);
    // request.url can be the internal address behind a reverse proxy.
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
  let session: AuthSession | null = null;

  try {
    validateOrigin(request);
    session = await getCurrentSession();
    const payload = (await request.json()) as { code?: string };
    const code = String(payload.code ?? "").trim();

    if (!code) {
      return NextResponse.json({ error: "Authenticator code or recovery code is required." }, { status: 400 });
    }

    const result = await verifyGuestShellStepUp(code);
    if (session) {
      recordAdminAudit({
        action: "guest-shell-step-up",
        actorEmail: session.user.email,
        actorName: session.user.name,
        message: "Verified 2FA for in-app SSH",
      }).catch(() => {});
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to verify 2FA challenge.";
    if (session) {
      recordAdminAudit({
        action: "guest-shell-step-up-failure",
        actorEmail: session.user.email,
        actorName: session.user.name,
        message: `2FA check for in-app SSH failed: ${message}`,
      }).catch(() => {});
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
