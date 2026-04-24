import { redirect } from "next/navigation";

import { GroupForm } from "@/components/group-form";
import { getCurrentSession, hasPermission } from "@/lib/auth";
import { listSites } from "@/lib/site-store";

export const dynamic = "force-dynamic";

export default async function GroupCreatePage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  if (!hasPermission(session, "manage-groups")) {
    redirect("/");
  }

  const sites = await listSites();
  const siteInfos = sites.map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
          Create group
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          Define a new user group with site access and permissions.
        </p>
      </div>

      <GroupForm sites={siteInfos} />
    </div>
  );
}
