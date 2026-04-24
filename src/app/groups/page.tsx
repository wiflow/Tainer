import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ShieldCheck, Users, UsersRound } from "lucide-react";

import { GroupsBoard } from "@/components/groups-board";
import { getCurrentSession, hasPermission, listManagedUsers } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import { listUserGroups } from "@/lib/user-groups";

export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  if (!hasPermission(session, "manage-groups")) {
    redirect("/");
  }

  const [groups, users] = await Promise.all([
    listUserGroups(),
    listManagedUsers(),
  ]);

  const adminGroupCount = groups.filter((g) => g.isAdmin).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Link
          className={cn(
            buttonVariants({ size: "sm", variant: "secondary" }),
            "gap-1.5",
          )}
          href="/groups/create"
        >
          Create group
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          icon={<UsersRound className="w-3.5 h-3.5" />}
          label="Total groups"
          value={String(groups.length)}
        />
        <MetricCard
          icon={<ShieldCheck className="w-3.5 h-3.5" />}
          label="Admin groups"
          value={String(adminGroupCount)}
        />
        <MetricCard
          icon={<Users className="w-3.5 h-3.5" />}
          label="Total users"
          value={String(users.length)}
        />
      </div>

      <GroupsBoard groups={groups} users={users} />
    </div>
  );
}
