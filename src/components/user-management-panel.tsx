"use client";

import { useActionState, useEffect, useState } from "react";
import {
  KeyRound,
  Mail,
  Shield,
  UserPlus2,
  UserRound,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { adminResetPasswordAction, createUserAction } from "@/app/auth-actions";
import { updateUserGroupsAction } from "@/app/group-management-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SectionPanel } from "@/components/ui/section-panel";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import type { ManagedUserSummary } from "@/lib/auth";
import type { UserGroup } from "@/lib/user-groups";
import { cn } from "@/lib/utils";

// ── Avatar / status helpers ──────────────────────────────────────────────────

/** Pick from a small palette deterministically based on the user's name so the
 *  same user always gets the same avatar tint (lets you scan rows by colour). */
function avatarTint(seed: string): string {
  const palette = [
    "bg-sky-500/15 text-sky-300",
    "bg-emerald-500/15 text-emerald-300",
    "bg-violet-500/15 text-violet-300",
    "bg-amber-500/15 text-amber-300",
    "bg-rose-500/15 text-rose-300",
    "bg-fuchsia-500/15 text-fuchsia-300",
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

function initials(name: string, email: string): string {
  const source = (name || email || "?").trim();
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

type Presence = { color: string; label: string };

/** Derive a presence dot from the user's lastSeenAt timestamp. Same buckets
 *  every chat-like product uses: online (now-ish), recent, idle, offline. */
function presence(lastSeenAt: string | null): Presence {
  if (!lastSeenAt) return { color: "bg-zinc-600", label: "Never signed in" };
  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  if (ageMs < 5 * 60_000) return { color: "bg-emerald-500", label: "Online" };
  if (ageMs < 60 * 60_000) return { color: "bg-emerald-600/60", label: "Recently active" };
  if (ageMs < 24 * 60 * 60_000) return { color: "bg-amber-500", label: "Idle" };
  return { color: "bg-zinc-600", label: "Offline" };
}

function UserAvatar({ user, size = 36 }: { user: ManagedUserSummary; size?: number }) {
  const tint = avatarTint(user.email || user.id);
  const dot = presence(user.lastSeenAt);
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <div
        className={cn(
          "flex h-full w-full items-center justify-center rounded-full text-[12px] font-semibold uppercase tracking-wider",
          tint,
        )}
      >
        {initials(user.name, user.email)}
      </div>
      <span
        className={cn(
          "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[#0a0a0c]",
          dot.color,
        )}
        title={dot.label}
        aria-label={dot.label}
      />
    </div>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

const inputClassName =
  "mt-1.5 w-full rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 text-[13px] text-zinc-200 outline-none transition-all duration-200 placeholder:text-zinc-600 focus:border-white/30 focus:bg-white/[0.04] focus:shadow-[0_0_0_3px_rgba(255,255,255,0.04)]";

function useRefreshOnSuccess(status: string) {
  const router = useRouter();

  useEffect(() => {
    if (status === "success") {
      router.refresh();
    }
  }, [router, status]);
}

function UserResetPasswordButton({ user }: { user: ManagedUserSummary }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    adminResetPasswordAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(state, {
    errorTitle: "Password reset failed",
    successTitle: "Password reset",
  });

  // Auto-close on success.
  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state.status, state.requestId]);

  return (
    <>
      <button
        className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
        onClick={() => setOpen(true)}
        title="Reset password"
        type="button"
      >
        <KeyRound className="h-3.5 w-3.5" />
      </button>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-amber-400" />
              Reset password
            </DialogTitle>
            <DialogDescription>
              Set a new password for{" "}
              <span className="text-zinc-200">{user.name || user.email}</span>. The user&apos;s
              other active sessions will be revoked — they&apos;ll need to sign in again.
            </DialogDescription>
          </DialogHeader>
          <Form action={formAction} className="space-y-3">
            <input name="userId" type="hidden" value={user.id} />
            <label className="block">
              <span className="text-[12px] font-medium text-zinc-400">New password</span>
              <input
                autoComplete="new-password"
                className={inputClassName}
                name="password"
                type="password"
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-zinc-400">Confirm password</span>
              <input
                autoComplete="new-password"
                className={inputClassName}
                name="confirmPassword"
                type="password"
              />
            </label>
            <DialogFooter>
              <Button
                disabled={isPending}
                onClick={() => setOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button disabled={isPending} type="submit" variant="warning">
                {isPending ? "Resetting…" : "Reset password"}
              </Button>
            </DialogFooter>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UserGroupsCell({
  user,
  allGroups,
}: {
  user: ManagedUserSummary;
  allGroups: UserGroup[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(user.groupIds));
  const [state, formAction, isPending] = useActionState(
    updateUserGroupsAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(state, {
    errorTitle: "Group update failed",
    successTitle: "Groups updated",
  });
  useRefreshOnSuccess(state.status);

  // Reset checkbox state to the current truth whenever the dialog opens.
  // Otherwise after Save the checkboxes drift and a subsequent open shows stale.
  useEffect(() => {
    if (open) setSelected(new Set(user.groupIds));
  }, [open, user.groupIds]);

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state.status, state.requestId]);

  const userGroups = allGroups.filter((g) => user.groupIds.includes(g.id));

  function toggle(groupId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  return (
    <>
      {/* Inline display: chips for current groups, plus an icon button to open
          the editor. Click the chips area or the icon to open the dialog. */}
      <button
        className="flex w-full flex-wrap items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-white/[0.03]"
        onClick={() => setOpen(true)}
        title="Edit groups"
        type="button"
      >
        {userGroups.length > 0 ? (
          userGroups.map((g) => (
            <Badge
              className={
                g.isAdmin
                  ? "border-white/15 bg-white/10 text-white"
                  : "border-white/10 bg-zinc-800 text-zinc-400"
              }
              key={g.id}
              variant="neutral"
            >
              {g.name}
            </Badge>
          ))
        ) : (
          <span className="text-[11px] text-zinc-500">No groups</span>
        )}
        <Shield className="h-3 w-3 text-zinc-600 ml-auto md:ml-1" />
      </button>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-zinc-300" />
              Edit groups
            </DialogTitle>
            <DialogDescription>
              Choose which groups{" "}
              <span className="text-zinc-200">{user.name || user.email}</span> belongs to.
              Group permissions are additive — a user with both `admin` and `operator` groups
              gets every permission either grants.
            </DialogDescription>
          </DialogHeader>
          <Form action={formAction}>
            <input name="userId" type="hidden" value={user.id} />
            <input name="groupIds" type="hidden" value={Array.from(selected).join(",")} />
            <div className="space-y-1">
              {allGroups.length === 0 ? (
                <p className="rounded-md border border-white/5 bg-black/20 px-3 py-3 text-[12px] text-zinc-500">
                  No groups exist yet. Create groups first under <em>Groups</em> in the sidebar.
                </p>
              ) : (
                allGroups.map((g) => {
                  const isSelected = selected.has(g.id);
                  return (
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md border border-transparent px-3 py-2 transition-colors",
                        isSelected
                          ? "border-white/15 bg-white/10"
                          : "hover:border-white/[0.08] hover:bg-white/[0.025]",
                      )}
                      key={g.id}
                    >
                      <input
                        checked={isSelected}
                        className="h-4 w-4 rounded border-white/10 bg-zinc-900 text-white accent-white"
                        onChange={() => toggle(g.id)}
                        type="checkbox"
                      />
                      <span className="flex-1 text-[13px] text-zinc-200">{g.name}</span>
                      {g.isAdmin && (
                        <Badge
                          className="border-white/15 bg-white/10 text-white"
                          variant="neutral"
                        >
                          admin
                        </Badge>
                      )}
                    </label>
                  );
                })
              )}
            </div>
            <DialogFooter>
              <Button
                disabled={isPending}
                onClick={() => setOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button disabled={isPending} type="submit">
                {isPending ? "Saving…" : "Save groups"}
              </Button>
            </DialogFooter>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function UserManagementPanel({
  users,
  groups,
}: {
  users: ManagedUserSummary[];
  groups: UserGroup[];
}) {
  const [showCreate, setShowCreate] = useState(users.length === 0);
  const [createUserState, createUserActionForm, createUserPending] = useActionState(
    createUserAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(createUserState, {
    errorTitle: "User creation failed",
    successTitle: "User created",
  });
  useRefreshOnSuccess(createUserState.status);

  // Auto-collapse the create form on success.
  useEffect(() => {
    if (createUserState.status === "success") setShowCreate(false);
  }, [createUserState.status, createUserState.requestId]);

  return (
    <div className="space-y-4">
      {/* ── Header strip with toggle for create form ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-medium text-white">User directory</h2>
          <p className="mt-0.5 text-[12px] text-zinc-500">
            {users.length} user{users.length === 1 ? "" : "s"} · review access, 2FA, recent activity, and groups.
          </p>
        </div>
        <Button
          onClick={() => setShowCreate((s) => !s)}
          size="sm"
          variant={showCreate ? "ghost" : "accent"}
        >
          {showCreate ? (
            "Cancel"
          ) : (
            <>
              <UserPlus2 className="h-4 w-4" />
              Create user
            </>
          )}
        </Button>
      </div>

      {/* ── Collapsible create form ── */}
      {showCreate && (
        <SectionPanel
          title="Create user"
          description="Add operators and administrators so your team can access Tainer with their own accounts."
        >
          <Form action={createUserActionForm} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
                  <UserRound className="h-4 w-4 text-zinc-500" />
                  Full name
                </span>
                <input className={inputClassName} name="name" placeholder="Jane Operator" />
              </label>

              <label className="block">
                <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
                  <Mail className="h-4 w-4 text-zinc-500" />
                  Email address
                </span>
                <input
                  className={inputClassName}
                  name="email"
                  placeholder="jane@example.com"
                  type="email"
                />
              </label>
            </div>

            <div className="block">
              <span className="text-[13px] font-medium text-zinc-300">Groups</span>
              <div className="mt-1.5 rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3">
                {groups.length > 0 ? (
                  <div className="space-y-1.5">
                    {groups.map((g) => (
                      <label
                        key={g.id}
                        className="flex items-center gap-2 text-[12px] text-zinc-400"
                      >
                        <input
                          className="h-3.5 w-3.5 rounded border-white/10 bg-zinc-900 text-white accent-white"
                          name="groupIds"
                          type="checkbox"
                          value={g.id}
                        />
                        {g.name}
                        {g.isAdmin && (
                          <span className="text-[10px] text-zinc-300">(admin)</span>
                        )}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-zinc-500">No groups yet. Create groups first.</p>
                )}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-[13px] font-medium text-zinc-300">
                  Temporary password
                </span>
                <input className={inputClassName} name="password" type="password" />
              </label>

              <label className="block">
                <span className="text-[13px] font-medium text-zinc-300">
                  Confirm password
                </span>
                <input className={inputClassName} name="confirmPassword" type="password" />
              </label>
            </div>

            <div className="rounded-xl border border-white/5 bg-[#111113] px-4 py-3 text-[12px] text-zinc-500">
              New users can sign in immediately and then manage 2FA and password resets
              from their own account page.
            </div>

            <Button disabled={createUserPending} type="submit" variant="accent">
              <UserPlus2 className="h-4 w-4" />
              {createUserPending ? "Creating..." : "Create user"}
            </Button>
          </Form>
        </SectionPanel>
      )}

      {/* ── Directory ── */}
      <SectionPanel noPadding>
        {users.length === 0 ? (
          <div className="flex flex-col items-center justify-center bg-zinc-900/20 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/5 bg-[#111113]">
              <Users className="h-5 w-5 text-zinc-500" />
            </div>
            <p className="mt-4 text-[14px] font-medium text-zinc-200">No users yet</p>
            <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-zinc-500">
              Create your first operator or administrator account to start sharing access across the team.
            </p>
          </div>
        ) : (
          <>
            {/* Column header — sticky-ish single row, pixel-aligned with row below */}
            <div className="hidden md:grid grid-cols-[minmax(220px,1.4fr)_120px_160px_minmax(160px,1.2fr)_88px] items-center gap-4 border-b border-white/5 bg-black/30 px-5 py-2.5 text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
              <span>User</span>
              <span>Security</span>
              <span>Activity</span>
              <span>Groups</span>
              <span className="text-right">Actions</span>
            </div>

            <ul className="divide-y divide-white/5">
              {users.map((user) => (
                <li
                  key={user.id}
                  className="md:grid md:grid-cols-[minmax(220px,1.4fr)_120px_160px_minmax(160px,1.2fr)_88px] items-center gap-4 px-5 py-3.5 transition-colors hover:bg-white/[0.02]"
                >
                  {/* Identity column */}
                  <div className="flex items-center gap-3 min-w-0">
                    <UserAvatar user={user} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-medium text-zinc-100 truncate">
                          {user.name || user.email.split("@")[0]}
                        </span>
                        <Badge variant={user.role === "admin" ? "review" : "neutral"}>
                          {user.role}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-zinc-500 truncate">{user.email}</p>
                    </div>
                  </div>

                  {/* Security */}
                  <div className="mt-2 md:mt-0">
                    {user.hasTwoFactor ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        2FA on
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-zinc-900/60 px-2.5 py-0.5 text-[11px] text-zinc-500">
                        <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                        2FA off
                      </span>
                    )}
                  </div>

                  {/* Activity */}
                  <div className="mt-2 md:mt-0 text-[12px] text-zinc-400">
                    <p>
                      <strong className="text-zinc-200">{user.activeSessionCount}</strong>{" "}
                      <span className="text-zinc-500">active</span>
                    </p>
                    <p
                      className="text-[11px] text-zinc-600"
                      title={
                        user.lastSeenAt
                          ? new Date(user.lastSeenAt).toLocaleString()
                          : undefined
                      }
                    >
                      Seen {relativeTime(user.lastSeenAt)}
                    </p>
                  </div>

                  {/* Groups */}
                  <div className="mt-2 md:mt-0 min-w-0">
                    <UserGroupsCell allGroups={groups} user={user} />
                  </div>

                  {/* Actions */}
                  <div className="mt-2 md:mt-0 flex md:justify-end">
                    <UserResetPasswordButton user={user} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </SectionPanel>
    </div>
  );
}
