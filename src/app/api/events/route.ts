import { NextResponse, type NextRequest } from "next/server";

import { getCurrentSession, requireSiteAccess } from "@/lib/auth";
import { subscribeToSiteEvents } from "@/lib/live-events";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SSE stream of site change events. Emits `data: changed` whenever any
 * guest or node status in the site changes (server-side watcher, one
 * upstream poll per site shared by all clients), plus keepalive comments.
 * Clients (the AutoRefresh component) refresh their route on each event.
 */
export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const siteSlug = request.nextUrl.searchParams.get("site")?.trim() ?? "";
  if (!siteSlug) {
    return NextResponse.json({ error: "Missing site parameter." }, { status: 400 });
  }
  let siteId: string;
  try {
    siteId = (await resolveSiteConfigBySlug(siteSlug)).siteId;
  } catch {
    return NextResponse.json({ error: "Unknown site." }, { status: 404 });
  }
  try {
    requireSiteAccess(session, siteId);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };

      safeEnqueue("data: connected\n\n");
      const unsubscribe = subscribeToSiteEvents(siteSlug, () =>
        safeEnqueue("data: changed\n\n"),
      );
      // Keepalive comment defeats idle-connection timeouts in proxies.
      const ping = setInterval(() => safeEnqueue(": ping\n\n"), 25_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed by the runtime
        }
      };
      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
