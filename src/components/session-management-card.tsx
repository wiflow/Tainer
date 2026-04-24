"use client";

import { useActionState } from "react";
import { LogOut, Monitor, X } from "lucide-react";

import {
  revokeAllOtherSessionsAction,
  revokeSessionAction,
} from "@/app/auth-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { SectionPanel } from "@/components/ui/section-panel";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import type { SessionSummary } from "@/lib/auth";

function formatRelativeTime(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);

  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function SessionRow({ session }: { session: SessionSummary }) {
  const [state, formAction, isPending] = useActionState(
    revokeSessionAction,
    initialBasicActionState,
  );
  useActionFlashFeedback(state, {
    errorTitle: "Failed to revoke session",
    successTitle: "Session revoked",
  });

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-[#111113] px-4 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-zinc-800">
        <Monitor className="h-4 w-4 text-zinc-400" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-medium text-zinc-200">
            {session.isCurrent ? "This session" : "Active session"}
          </p>
          {session.isCurrent && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
              Current
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[12px] text-zinc-400">
          Last active {formatRelativeTime(session.lastSeenAt)}
          {" · "}
          Created {formatRelativeTime(session.createdAt)}
        </p>
      </div>
      {!session.isCurrent && (
        <Form action={formAction}>
          <input name="sessionId" type="hidden" value={session.id} />
          <button
            className="flex items-center justify-center w-9 h-9 rounded-lg text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40 cursor-pointer"
            disabled={isPending}
            aria-label="Revoke session"
            type="submit"
          >
            <X className="h-4 w-4" />
          </button>
        </Form>
      )}
    </div>
  );
}

export function SessionManagementCard({
  sessions,
}: {
  sessions: SessionSummary[];
}) {
  const [revokeAllState, revokeAllAction, revokeAllPending] = useActionState(
    revokeAllOtherSessionsAction,
    initialBasicActionState,
  );
  useActionFlashFeedback(revokeAllState, {
    errorTitle: "Failed to revoke sessions",
    successTitle: "All other sessions revoked",
  });

  const otherSessions = sessions.filter((s) => !s.isCurrent);

  return (
    <SectionPanel title="Active sessions" description="View and manage your active sign-in sessions across devices.">
        <div className="space-y-3">
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}

          {sessions.length === 0 && (
            <div className="rounded-xl border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-400">
              No active sessions found.
            </div>
          )}

          {otherSessions.length > 0 && (
            <div className="border-t border-white/5 pt-3">
              <Form action={revokeAllAction}>
                <Button disabled={revokeAllPending} type="submit" variant="danger">
                  <LogOut className="h-4 w-4" />
                  {revokeAllPending
                    ? "Revoking..."
                    : `Sign out ${otherSessions.length === 1 ? "other session" : `all ${otherSessions.length} other sessions`}`}
                </Button>
              </Form>
            </div>
          )}
        </div>
    </SectionPanel>
  );
}
