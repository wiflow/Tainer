import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth";
import {
  deleteChatForUser,
  getChatForUser,
  listChatsForUser,
  saveChatForUser,
} from "@/lib/copilot/chat-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Saved chats are strictly per-user — every function below scopes by the
// session's user id, so one user can never list, read, or delete another's.

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const chat = await getChatForUser(session.user.id, id);
    if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    return NextResponse.json({ chat });
  }

  const chats = await listChatsForUser(session.user.id);
  return NextResponse.json({ chats });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { id?: string | null; turns?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.turns) || body.turns.length === 0) {
    return NextResponse.json({ error: "turns must be a non-empty array" }, { status: 400 });
  }

  const summary = await saveChatForUser(session.user.id, {
    id: typeof body.id === "string" ? body.id : null,
    turns: body.turns,
  });
  return NextResponse.json({ chat: summary });
}

export async function DELETE(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id query param required" }, { status: 400 });
  }

  const deleted = await deleteChatForUser(session.user.id, id);
  return NextResponse.json({ deleted });
}
