"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { ArrowRight, Search, ShieldCheck, Trash2 } from "lucide-react";

import { deleteGroupAction } from "@/app/group-management-actions";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { initialBasicActionState } from "@/lib/action-states";
import type { ManagedUserSummary } from "@/lib/auth";
import type { UserGroup } from "@/lib/user-groups";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

export function GroupsBoard({
  groups,
  users,
}: {
  groups: UserGroup[];
  users: ManagedUserSummary[];
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const deferredSearch = useDeferredValue(search);

  const filtered = groups.filter(
    (g) =>
      g.name.toLowerCase().includes(deferredSearch.toLowerCase()) ||
      g.description.toLowerCase().includes(deferredSearch.toLowerCase()),
  );

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function memberCount(group: UserGroup): number {
    return users.filter((u) => u.groupIds.includes(group.id)).length;
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        <input
          className="w-full rounded-md border border-white/5 bg-zinc-900 py-2 pl-9 pr-3 text-[13px] text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-zinc-600"
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="Search groups..."
          type="text"
          value={search}
        />
      </div>

      {paginated.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-[13px] text-zinc-400">
              {groups.length === 0
                ? "No groups yet."
                : "No groups match your search."}
            </p>
            {groups.length === 0 && (
              <Link
                className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "mt-4")}
                href="/groups/create"
              >
                Create group
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="overflow-hidden overflow-x-auto rounded-xl border border-white/5 bg-[#111113]">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-white/5 bg-black/40">
                  <th className="px-5 py-3 font-medium text-zinc-400">Group Name</th>
                  <th className="px-5 py-3 font-medium text-zinc-400 w-24">Members</th>
                  <th className="px-5 py-3 font-medium text-zinc-400 w-24">Sites</th>
                  <th className="px-5 py-3 font-medium text-zinc-400 text-right w-10">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {paginated.map((group) => (
                  <GroupTableRow
                    key={group.id}
                    group={group}
                    memberCount={memberCount(group)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-white/5 pt-3">
          <p className="text-[12px] text-zinc-500">
            Page {page + 1} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
              size="sm"
              variant="ghost"
            >
              Previous
            </Button>
            <Button
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
              size="sm"
              variant="ghost"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupTableRow({
  group,
  memberCount,
}: {
  group: UserGroup;
  memberCount: number;
}) {
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleDelete() {
    setConfirmOpen(false);
    setDeleting(true);
    const fd = new FormData();
    fd.set("groupId", group.id);
    await deleteGroupAction(initialBasicActionState, fd);
    setDeleting(false);
  }

  return (
    <tr className="hover:bg-white/5 transition-colors group">
      <td className="px-5 py-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-zinc-100">{group.name}</span>
            {group.isAdmin && (
              <Badge className="border-amber-800/50 bg-amber-900/20 text-amber-300" variant="warning">
                <ShieldCheck className="mr-1 h-3 w-3" />
                Admin
              </Badge>
            )}
          </div>
          {group.description && (
            <span className="text-[12px] text-zinc-400 line-clamp-1">
              {group.description}
            </span>
          )}
        </div>
      </td>
      <td className="px-5 py-4 text-[12px] text-zinc-400">
        {memberCount}
      </td>
      <td className="px-5 py-4 text-[12px] text-zinc-400">
        {group.siteAccess.length}
      </td>
      <td className="px-5 py-4 text-right">
        <div className="flex justify-end items-center gap-2 relative">
          <Button
            disabled={deleting}
            onClick={() => setConfirmOpen(true)}
            size="sm"
            variant="ghost"
          >
            <Trash2 className="h-3.5 w-3.5 text-zinc-500" />
          </Button>
          <ConfirmDialog
            consequences={[
              <>
                <span className="text-zinc-200">{memberCount}</span> member
                {memberCount === 1 ? "" : "s"} lose the permissions this group grants. Their
                accounts stay.
              </>,
            ]}
            description={`Delete the group "${group.name}"?`}
            onConfirm={handleDelete}
            onOpenChange={setConfirmOpen}
            open={confirmOpen}
            pending={deleting}
            title="Delete group"
          />
          <Link
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-zinc-200 transition-colors hover:bg-white/10"
            href={`/groups/${group.id}`}
          >
            Manage
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </td>
    </tr>
  );
}
