import { redirect } from "next/navigation";

import { UserManagementPanel } from "@/components/user-management-panel";
import { getCurrentSession, hasPermission, listManagedUsers } from "@/lib/auth";
import { listUserGroups } from "@/lib/user-groups";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  if (!hasPermission(session, "manage-users")) {
    redirect("/");
  }

  const [users, groups] = await Promise.all([
    listManagedUsers(),
    listUserGroups(),
  ]);

  return (
    <div className="space-y-4">
      <UserManagementPanel users={users} groups={groups} />
    </div>
  );
}
