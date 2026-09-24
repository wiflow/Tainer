import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth";
import { runCopilotTurn } from "@/lib/copilot/run";
import type { ChatMessage, CopilotStreamEvent } from "@/lib/copilot/types";

export const dynamic = "force-dynamic";
// Reading streamed SSE only makes sense in the Node runtime here — the
// proxmox client uses node:https. Keep edge off.
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_MESSAGES = 200;

type ChatPayload = {
  messages: ChatMessage[];
  context?: { pathname?: string; siteSlug?: string; deploymentId?: string };
};

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.role === "user") return typeof v.content === "string";
  if (v.role === "assistant") return typeof v.content === "string";
  if (v.role === "tool") return Array.isArray(v.results);
  return false;
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Conversation too large. Start a new chat." }, { status: 413 });
  }

  let payload: ChatPayload;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Conversation too large. Start a new chat." }, { status: 413 });
    }
    payload = JSON.parse(text) as ChatPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(payload.messages) || !payload.messages.every(isChatMessage)) {
    return NextResponse.json({ error: "Invalid messages array" }, { status: 400 });
  }
  if (payload.messages.length > MAX_MESSAGES) {
    return NextResponse.json({ error: "Conversation too long. Start a new chat." }, { status: 413 });
  }

  // SSE stream — one event per line, double-newline separated.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: CopilotStreamEvent) {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(data));
      }

      try {
        const generator = runCopilotTurn({
          session,
          context: {
            pathname: payload.context?.pathname ?? null,
            siteSlug: payload.context?.siteSlug ?? null,
            deploymentId: payload.context?.deploymentId ?? null,
          },
          messages: payload.messages,
        });

        for await (const event of generator) {
          send(event);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
    cancel() {
      // Client disconnected — generator's `for await` will throw and the
      // try/finally above will close. Nothing else to do here.
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
