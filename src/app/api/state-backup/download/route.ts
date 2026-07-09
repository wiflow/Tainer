import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { NextResponse, type NextRequest } from "next/server";

import { getCurrentSession } from "@/lib/auth";
import {
  getStateBackupConfig,
  resolveBackupFilePath,
  resolveDestinationDir,
} from "@/lib/state-backup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Streams an encrypted state-backup archive to the browser so admins can
 * keep off-host copies. Admin-only; the file name is validated against the
 * backup naming scheme (no path traversal) and served only from the
 * configured destination directory.
 */
export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const name = request.nextUrl.searchParams.get("file") ?? "";
  let filePath: string;
  try {
    const config = await getStateBackupConfig();
    filePath = resolveBackupFilePath(resolveDestinationDir(config), name);
  } catch {
    return NextResponse.json({ error: "Invalid backup file name." }, { status: 400 });
  }

  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return NextResponse.json({ error: "Backup not found." }, { status: 404 });
  }

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
