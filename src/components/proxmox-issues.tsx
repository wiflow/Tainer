import { AlertTriangle } from "lucide-react";

import { SectionPanel } from "@/components/ui/section-panel";
import type { ProxmoxIssue } from "@/lib/proxmox";

export function ProxmoxIssues({
  issues,
  title = "Proxmox access notes",
  description = "The API connection is live, but some views still need broader ACL coverage.",
}: {
  description?: string;
  issues: ProxmoxIssue[];
  title?: string;
}) {
  if (issues.length === 0) {
    return null;
  }

  return (
    <SectionPanel noPadding>
      <div className="flex items-center gap-2 border-b border-white/5 px-5 py-4">
        <AlertTriangle className="h-4 w-4 text-amber-400" />
        <div>
          <h2 className="text-[15px] font-medium text-white">{title}</h2>
          <p className="mt-0.5 text-[12px] text-zinc-500">{description}</p>
        </div>
      </div>
      <div className="divide-y divide-white/5">
        {issues.map((issue) => (
          <div key={`${issue.endpoint}-${issue.message}`} className="px-4 py-3">
            <p className="text-[13px] font-medium text-zinc-200">{issue.endpoint}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
              {issue.message}
            </p>
            {issue.requiredPrivileges.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {issue.requiredPrivileges.map((privilege) => (
                  <span
                    key={privilege}
                    className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400"
                  >
                    {privilege}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </SectionPanel>
  );
}
