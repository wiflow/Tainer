import { ScrollText } from "lucide-react";
import { redirect } from "next/navigation";

import { AuditLogViewer } from "@/components/audit-log-viewer";
import { getAdminAuditLog } from "@/lib/admin-audit-log";
import { getCurrentSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AuditLogPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/");

  const entries = await getAdminAuditLog(1000);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-sky-400" />
          <div>
            <h1 className="text-[15px] font-medium text-white">Audit log</h1>
            <p className="text-[12px] text-zinc-500">
              Every administrative action recorded by Tainer — sign-ins, user changes,
              settings updates, SSO provisioning. Newest first. Up to {Math.min(entries.length, 1000)} of the
              last 5,000 entries shown.
            </p>
          </div>
        </div>
      </div>

      <AuditLogViewer entries={entries} />
    </div>
  );
}
