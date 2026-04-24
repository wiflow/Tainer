import { notFound, redirect } from "next/navigation";

import { GroupForm } from "@/components/group-form";
import { GroupMembersPanel } from "@/components/group-members-panel";
import { getCurrentSession, hasPermission, listManagedUsers } from "@/lib/auth";
import { listSites } from "@/lib/site-store";
import { getUserGroup } from "@/lib/user-groups";

export const dynamic = "force-dynamic";

export default async function GroupEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  if (!hasPermission(session, "manage-groups")) {
    redirect("/");
  }

  const { id } = await params;
  const group = await getUserGroup(id);

  if (!group) {
    notFound();
  }

  const [sites, users] = await Promise.all([
    listSites(),
    listManagedUsers(),
  ]);

  const siteInfos = sites.map((s) => ({ id: s.id, name: s.name }));
  const members = users.filter((u) => u.groupIds.includes(group.id));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
          Edit group: {group.name}
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          Update permissions, site access, and manage members.
        </p>
      </div>

      <GroupForm group={group} sites={siteInfos} />

      <GroupMembersPanel groupId={group.id} members={members} allUsers={users} />
    </div>
  );
}
