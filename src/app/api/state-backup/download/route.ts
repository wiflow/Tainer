import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { NextResponse, type NextRequest } from "next/server";

import { recordAdminAudit } from "@/lib/admin-audit-log";
import { getCurrentSession } from "@/lib/auth";
import {
  getStateBackupConfig,
  resolveBackupFilePath,
  resolveDestinationDir,
} from "@/lib/state-backup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  recordAdminAudit({
    action: "state-backup-downloaded",
    actorEmail: session.user.email,
    actorName: session.user.name,
    message: `Downloaded state backup ${name}`,
  }).catch(() => {});

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
