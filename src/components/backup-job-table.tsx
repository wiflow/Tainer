import { Badge } from "@/components/ui/badge";
import type { ProxmoxBackupJob } from "@/lib/proxmox";

export function BackupJobTable({
  jobs,
}: {
  jobs: ProxmoxBackupJob[];
}) {
  if (jobs.length === 0) {
    return (
      <div className="px-5 py-4 text-[13px] text-zinc-500">
        No scheduled backup jobs found. Configure backup jobs in Proxmox Datacenter &rarr; Backup.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-[#111113]">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-white/5 bg-black/40">
            <th className="px-4 py-3 font-medium text-zinc-400">ID</th>
            <th className="px-4 py-3 font-medium text-zinc-400">Schedule</th>
            <th className="px-4 py-3 font-medium text-zinc-400">Storage</th>
            <th className="px-4 py-3 font-medium text-zinc-400">Mode</th>
            <th className="px-4 py-3 font-medium text-zinc-400">Coverage</th>
            <th className="px-4 py-3 font-medium text-zinc-400">Enabled</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {jobs.map((job) => (
            <tr key={job.id} className="hover:bg-white/5 transition-colors group">
              <td className="px-4 py-3 font-medium text-zinc-200">{job.id}</td>
              <td className="px-4 py-3 text-zinc-400">{job.schedule || "Not set"}</td>
              <td className="px-4 py-3 text-zinc-400">{job.storage || "Default"}</td>
              <td className="px-4 py-3 text-zinc-400">{job.mode}</td>
              <td className="px-4 py-3 text-zinc-400">
                {job.all ? (
                  <Badge variant="success">All</Badge>
                ) : job.vmids.length > 0 ? (
                  <span>
                    {job.vmids.length} VMID{job.vmids.length !== 1 ? "s" : ""}
                  </span>
                ) : (
                  <Badge variant="neutral">None</Badge>
                )}
              </td>
              <td className="px-4 py-3 text-zinc-400">
                {job.enabled ? (
                  <span className="text-emerald-400">Yes</span>
                ) : (
                  <span className="text-zinc-500">No</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
