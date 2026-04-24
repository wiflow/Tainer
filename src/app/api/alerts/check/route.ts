import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { runAlertCheck } from "@/lib/alert-engine";

export const dynamic = "force-dynamic";

function matchesSecret(secret: string, providedToken: string) {
  const expected = Buffer.from(secret, "utf8");
  const actual = Buffer.from(providedToken, "utf8");

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.ALERTS_CRON_SECRET?.trim();

  if (!cronSecret) {
    return NextResponse.json(
      { message: "ALERTS_CRON_SECRET environment variable is not configured." },
      { status: 503 },
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const providedToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!providedToken || !matchesSecret(cronSecret, providedToken)) {
    return NextResponse.json(
      { message: "Invalid or missing authorization." },
      { status: 401 },
    );
  }

  try {
    const result = await runAlertCheck();

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 200)
        : "Alert check failed.";

    return NextResponse.json({ message }, { status: 500 });
  }
}
