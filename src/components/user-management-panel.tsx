"use client";

import { useActionState, useEffect, useState } from "react";
import { KeyRound, Mail, Shield, UserPlus2, UserRound, Users } from "lucide-react";
import { useRouter } from "next/navigation";

import { adminResetPasswordAction, createUserAction } from "@/app/auth-actions";
import { updateUserGroupsAction } from "@/app/group-management-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionPanel } from "@/components/ui/section-panel";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import type { ManagedUserSummary } from "@/lib/auth";
import type { UserGroup } from "@/lib/user-groups";

const inputClassName =
  "mt-1.5 w-full rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 text-[13px] text-zinc-200 outline-none transition-all duration-200 placeholder:text-zinc-600 focus:border-teal-500/40 focus:bg-white/[0.04] focus:shadow-[0_0_0_3px_rgba(20,184,166,0.08),0_0_24px_-4px_rgba(20,184,166,0.1)]";

function useRefreshOnSuccess(status: string) {
  const router = useRouter();

  useEffect(() => {
    if (status === "success") {
      router.refresh();
    }
  }, [router, status]);
}

function UserResetPasswordForm({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    adminResetPasswordAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(state, {
    errorTitle: "Password reset failed",
    successTitle: "Password reset",
  });

  useEffect(() => {
    if (state.status === "success") {
      setOpen(false);
    }
  }, [state.status, state.requestId]);

  if (!open) {
    return (
      <button
        className="flex items-center gap-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-300"
        onClick={() => setOpen(true)}
        type="button"
      >
        <KeyRound className="h-3 w-3" />
        Reset password
      </button>
    );
  }

  return (
    <Form action={formAction} className="mt-3 flex w-full flex-col gap-3 rounded-lg border border-white/5 bg-black/20 p-3 text-left">
      <input name="userId" type="hidden" value={userId} />
      <label className="block w-full">
        <span className="text-[11px] text-zinc-500">New password</span>
        <input className={inputClassName} name="password" type="password" />
      </label>
      <label className="block w-full">
        <span className="text-[11px] text-zinc-500">Confirm</span>
        <input className={inputClassName} name="confirmPassword" type="password" />
      </label>
      <div className="flex w-full justify-end gap-1">
        <Button onClick={() => setOpen(false)} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={isPending} size="sm" type="submit" variant="danger">
          {isPending ? "Reset..." : "Reset"}
        </Button>
      </div>
    </Form>
  );
}

function UserGroupsEditor({
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

  useEffect(() => {
    if (state.status === "success") {
      setOpen(false);
    }
  }, [state.status, state.requestId]);

  const userGroups = allGroups.filter((g) => user.groupIds.includes(g.id));

  if (!open) {
    return (
      <div className="mt-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {userGroups.length > 0 ? (
            userGroups.map((g) => (
              <Badge
                key={g.id}
                className={
                  g.isAdmin
                    ? "border-teal-500/20 bg-teal-500/10 text-teal-300"
                    : "border-white/10 bg-zinc-800 text-zinc-400"
                }
                variant="neutral"
              >
                {g.name}
              </Badge>
            ))
          ) : (
            <span className="text-[11px] text-zinc-500">No groups assigned</span>
          )}
          <button
            className="flex items-center gap-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-300"
            onClick={() => {
              setSelected(new Set(user.groupIds));
              setOpen(true);
            }}
            type="button"
          >
            <Shield className="h-3 w-3" />
            Edit groups
          </button>
        </div>
      </div>
    );
  }

  function toggle(groupId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-white/5 bg-black/20 p-3">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
        Groups
      </p>
      <Form action={formAction}>
        <input type="hidden" name="userId" value={user.id} />
        <input type="hidden" name="groupIds" value={Array.from(selected).join(",")} />
        <div className="flex flex-col gap-1.5">
          {allGroups.map((g) => (
            <label
              key={g.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-zinc-400 transition-colors hover:bg-white/5"
            >
              <input
                type="checkbox"
                checked={selected.has(g.id)}
                onChange={() => toggle(g.id)}
                className="h-3.5 w-3.5 rounded border-white/10 bg-zinc-900 text-white accent-white"
              />
              {g.name}
              {g.isAdmin && (
                <span className="text-[10px] text-teal-400">(admin)</span>
              )}
            </label>
          ))}
        </div>
        <div className="mt-3 flex gap-1">
          <Button disabled={isPending} size="sm" type="submit">
            {isPending ? "Saving..." : "Save"}
          </Button>
          <Button onClick={() => setOpen(false)} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
        </div>
      </Form>
    </div>
  );
}

export function UserManagementPanel({
  users,
  groups,
}: {
  users: ManagedUserSummary[];
  groups: UserGroup[];
}) {
  const [createUserState, createUserActionForm, createUserPending] = useActionState(
    createUserAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(createUserState, {
    errorTitle: "User creation failed",
    successTitle: "User created",
  });
  useRefreshOnSuccess(createUserState.status);

  return (
    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
      <SectionPanel title="Create user" description="Add operators and administrators so your team can access Tainer with their own accounts.">
          <Form action={createUserActionForm} className="space-y-4">
            <label className="block">
              <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
                <UserRound className="h-4 w-4 text-teal-400/50" />
                Full name
              </span>
              <input className={inputClassName} name="name" placeholder="Jane Operator" />
            </label>

            <label className="block">
              <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
                <Mail className="h-4 w-4 text-teal-400/50" />
                Email address
              </span>
              <input
                className={inputClassName}
                name="email"
                placeholder="jane@example.com"
                type="email"
              />
            </label>

            <div className="block">
              <span className="text-[13px] font-medium text-zinc-300">Groups</span>
              <div className="mt-1.5 rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3">
                {groups.length > 0 ? (
                  <div className="space-y-1.5">
                    {groups.map((g) => (
                      <label key={g.id} className="flex items-center gap-2 text-[12px] text-zinc-400">
                        <input
                          className="h-3.5 w-3.5 rounded border-white/10 bg-zinc-900 text-white accent-white"
                          name="groupIds"
                          type="checkbox"
                          value={g.id}
                        />
                        {g.name}
                        {g.isAdmin && <span className="text-[10px] text-teal-400">(admin)</span>}
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
                <span className="text-[13px] font-medium text-zinc-300">Temporary password</span>
                <input className={inputClassName} name="password" type="password" />
              </label>

              <label className="block">
                <span className="text-[13px] font-medium text-zinc-300">Confirm password</span>
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

      <SectionPanel className="flex flex-col" title="User directory" description="Review who has access, their role, recent activity, and 2FA status." noPadding>
          <div className="flex-1 flex flex-col">
            {users.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-white/5 bg-black/40">
                      <th className="px-5 py-3 font-medium text-zinc-400">User</th>
                      <th className="px-5 py-3 font-medium text-zinc-400">Security</th>
                      <th className="px-5 py-3 font-medium text-zinc-400">Activity</th>
                      <th className="px-5 py-3 font-medium text-zinc-400 min-w-[200px]">Access Groups</th>
                      <th className="px-5 py-3 font-medium text-zinc-400 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {users.map((user) => (
                      <tr key={user.id} className="hover:bg-white/5 transition-colors group">
                        <td className="px-5 py-4 align-top">
                          <div className="flex flex-col gap-1">
                            <span className="font-medium text-zinc-100">{user.name}</span>
                            <span className="text-[12px] text-zinc-500">{user.email}</span>
                            <span className="mt-1 w-fit">
                              <Badge variant={user.role === "admin" ? "review" : "neutral"}>
                                {user.role}
                              </Badge>
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <span
                            className={
                              user.hasTwoFactor
                                ? "inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400"
                                : "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/50 px-2.5 py-0.5 text-[11px] text-zinc-400"
                            }
                          >
                            {user.hasTwoFactor ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> : <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />}
                            {user.hasTwoFactor ? "2FA enabled" : "2FA off"}
                          </span>
                        </td>
                        <td className="px-5 py-4 align-top text-[12px] text-zinc-400">
                          <div className="flex flex-col gap-1.5">
                            <span>
                              <strong className="text-zinc-200">{user.activeSessionCount}</strong> active sessions
                            </span>
                            <span className="text-zinc-500">
                              Seen {user.lastSeenAt ? new Date(user.lastSeenAt).toLocaleString() : "Never"}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <UserGroupsEditor user={user} allGroups={groups} />
                        </td>
                        <td className="px-5 py-4 align-top text-right">
                          <UserResetPasswordForm userId={user.id} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center bg-zinc-900/20 px-6 py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/5 bg-[#111113]">
                  <Users className="h-5 w-5 text-zinc-500" />
                </div>
                <p className="mt-4 text-[14px] font-medium text-zinc-200">No extra users yet</p>
                <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-zinc-500">
                  Create your first operator or administrator account to start sharing
                  access across the team.
                </p>
              </div>
            )}
          </div>
      </SectionPanel>
    </div>
  );
}
