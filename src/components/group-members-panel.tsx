"use client";

import { useState } from "react";
import { UserMinus, UserPlus } from "lucide-react";

import { updateUserGroupsAction } from "@/app/group-management-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { initialBasicActionState } from "@/lib/action-states";
import type { ManagedUserSummary } from "@/lib/auth";

export function GroupMembersPanel({
  groupId,
  members,
  allUsers,
}: {
  groupId: string;
  members: ManagedUserSummary[];
  allUsers: ManagedUserSummary[];
}) {
  const [working, setWorking] = useState<string | null>(null);
  const nonMembers = allUsers.filter((u) => !u.groupIds.includes(groupId));

  async function addUser(user: ManagedUserSummary) {
    setWorking(user.id);
    const newGroupIds = [...user.groupIds, groupId];
    const fd = new FormData();
    fd.set("userId", user.id);
    fd.set("groupIds", newGroupIds.join(","));
    await updateUserGroupsAction(initialBasicActionState, fd);
    setWorking(null);
  }

  async function removeUser(user: ManagedUserSummary) {
    setWorking(user.id);
    const newGroupIds = user.groupIds.filter((id) => id !== groupId);
    const fd = new FormData();
    fd.set("userId", user.id);
    fd.set("groupIds", newGroupIds.join(","));
    await updateUserGroupsAction(initialBasicActionState, fd);
    setWorking(null);
  }

  return (
    <Card>
      <CardHeader className="border-b border-white/5">
        <CardTitle>Members</CardTitle>
      </CardHeader>
      <CardContent className="p-5 space-y-4">
        {/* Current members */}
        {members.length === 0 ? (
          <p className="text-[13px] text-zinc-500">No members in this group yet.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-[12px] font-medium text-zinc-400">Current members</p>
            {members.map((user) => (
              <div
                className="flex items-center justify-between rounded-md border border-white/5 bg-[#111113] px-3 py-2"
                key={user.id}
              >
                <div>
                  <p className="text-[13px] font-medium text-zinc-200">{user.name}</p>
                  <p className="text-[12px] text-zinc-500">{user.email}</p>
                </div>
                <Button
                  disabled={working === user.id}
                  onClick={() => removeUser(user)}
                  size="sm"
                  variant="ghost"
                >
                  <UserMinus className="mr-1 h-3.5 w-3.5 text-zinc-500" />
                  {working === user.id ? "Removing..." : "Remove"}
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Add users */}
        {nonMembers.length > 0 && (
          <div className="space-y-2 border-t border-white/5 pt-4">
            <p className="text-[12px] font-medium text-zinc-400">Add users</p>
            {nonMembers.map((user) => (
              <div
                className="flex items-center justify-between rounded-md border border-white/5 bg-black/20 px-3 py-2"
                key={user.id}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] text-zinc-300">{user.name}</p>
                    {user.groupIds.length > 0 && (
                      <Badge className="text-[10px]" variant="neutral">
                        {user.groupIds.length} {user.groupIds.length === 1 ? "group" : "groups"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[12px] text-zinc-500">{user.email}</p>
                </div>
                <Button
                  disabled={working === user.id}
                  onClick={() => addUser(user)}
                  size="sm"
                  variant="ghost"
                >
                  <UserPlus className="mr-1 h-3.5 w-3.5 text-emerald-500" />
                  {working === user.id ? "Adding..." : "Add"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
