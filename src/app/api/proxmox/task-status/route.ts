import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession, hasSiteAccess } from "@/lib/auth";
import { getTaskSnapshot, withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

export const dynamic = "force-dynamic";

type TaskStatusBatchRequest = {
  tasks?: Array<{
    node?: string;
    siteSlug?: string;
    upid?: string;
  }>;
};

const POLL_RATE_LIMIT = 30;
const POLL_WINDOW_MS = 60_000;
const pollCounts = new Map<string, { count: number; firstReq: number }>();

function checkPollRateLimit(key: string): boolean {
  const now = Date.now();
  // Prune expired entries to prevent unbounded map growth
  const cutoff = now - POLL_WINDOW_MS;
  for (const [k, entry] of pollCounts) {
    if (entry.firstReq < cutoff) pollCounts.delete(k);
  }

  const entry = pollCounts.get(key);
  if (entry && now - entry.firstReq < POLL_WINDOW_MS) {
    if (entry.count >= POLL_RATE_LIMIT) return false;
    entry.count += 1;
  } else {
    pollCounts.set(key, { count: 1, firstReq: now });
  }
  return true;
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 200).replace(/\/[^\s]+/g, "[path]");
  }
  return "Failed to read task status.";
}

async function requireAuthenticatedSession() {
  const session = await getCurrentSession();

  if (!session) {
    throw new Error("Authentication required.");
  }

  return session;
}

export async function GET(request: NextRequest) {
  let session;
  try {
    session = await requireAuthenticatedSession();
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Authentication required.",
      },
      {
        status: 401,
      },
    );
  }

  if (!checkPollRateLimit(session.user.id)) {
    return NextResponse.json(
      { message: "Too many requests. Please slow down." },
      { status: 429 },
    );
  }

  const node = request.nextUrl.searchParams.get("node")?.trim();
  const upid = request.nextUrl.searchParams.get("upid")?.trim();
  const siteSlug = request.nextUrl.searchParams.get("siteSlug") ?? "";

  if (!node || !upid) {
    return NextResponse.json(
      {
        message: "Both node and upid are required.",
      },
      {
        status: 400,
      },
    );
  }

  const handler = async () => {
    try {
      const snapshot = await getTaskSnapshot(node, upid);

      return NextResponse.json(snapshot, {
        headers: {
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      const safeMessage = sanitizeErrorMessage(error);
      return NextResponse.json(
        {
          message: safeMessage,
        },
        {
          status: 500,
        },
      );
    }
  };

  if (siteSlug) {
    const config = await resolveSiteConfigBySlug(siteSlug);
    if (!hasSiteAccess(session, config.siteId)) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }
    return withSiteConfig(config, handler);
  }

  if (session.user.role !== "admin") {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  return handler();
}

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireAuthenticatedSession();
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Authentication required.",
      },
      {
        status: 401,
      },
    );
  }

  if (!checkPollRateLimit(session.user.id)) {
    return NextResponse.json(
      { message: "Too many requests. Please slow down." },
      { status: 429 },
    );
  }

  const payload = (await request.json().catch(() => null)) as TaskStatusBatchRequest | null;
  const tasks = (payload?.tasks ?? [])
    .map((task) => ({
      node: String(task.node ?? "").trim(),
      upid: String(task.upid ?? "").trim(),
    }))
    .filter((task) => task.node && task.upid)
    .slice(0, 50);

  if (tasks.length === 0) {
    return NextResponse.json(
      {
        message: "At least one valid task is required.",
      },
      {
        status: 400,
      },
    );
  }

  // Resolve site slug from query params or from the first task in the body
  const siteSlug =
    request.nextUrl.searchParams.get("siteSlug") ||
    String((payload?.tasks ?? [])[0]?.siteSlug ?? "").trim();

  const handler = async () => {
    const snapshots = await Promise.all(
      tasks.map(async (task) => {
        try {
          return {
            ...task,
            snapshot: await getTaskSnapshot(task.node, task.upid),
          };
        } catch (error) {
          return {
            ...task,
            error: sanitizeErrorMessage(error),
          };
        }
      }),
    );

    return NextResponse.json(
      {
        tasks: snapshots,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  };

  if (siteSlug) {
    const config = await resolveSiteConfigBySlug(siteSlug);
    if (!hasSiteAccess(session, config.siteId)) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }
    return withSiteConfig(config, handler);
  }

  if (session.user.role !== "admin") {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  return handler();
}
