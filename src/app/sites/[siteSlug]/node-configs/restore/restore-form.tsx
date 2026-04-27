"use client";

import { AlertTriangle, History, ShieldAlert } from "lucide-react";
import { useActionState, useState } from "react";

import {
  initialRestoreActionState,
  restoreConfigSnapshotAction,
} from "@/app/node-config-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { SectionPanel } from "@/components/ui/section-panel";
import type { RestoreSection } from "@/lib/node-config-backup";

type DiffSummary = { changed: boolean; section: string };

const SECTION_ORDER: { key: RestoreSection; label: string; matchesDiffSection: string }[] = [
  { key: "network", label: "Network interfaces", matchesDiffSection: "Network" },
  { key: "dns", label: "DNS resolver", matchesDiffSection: "DNS" },
  { key: "hosts", label: "/etc/hosts", matchesDiffSection: "Hosts" },
  { key: "timezone", label: "Timezone", matchesDiffSection: "Timezone" },
  { key: "storage", label: "Storage definitions (cluster)", matchesDiffSection: "Storage" },
  {
    key: "firewallRules",
    label: "Firewall rules (cluster)",
    matchesDiffSection: "Firewall Rules",
  },
];

const NODE_SCOPED: ReadonlySet<RestoreSection> = new Set(["dns", "hosts", "network", "timezone"]);

const fieldClassName =
  "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

export function RestoreForm({
  diffs,
  siteSlug,
  snapshotId,
  snapshotLabel,
  nodeName,
}: {
  diffs: DiffSummary[];
  siteSlug: string;
  snapshotId: string;
  snapshotLabel: string;
  nodeName: string;
}) {
  const [state, action, isPending] = useActionState(
    restoreConfigSnapshotAction,
    initialRestoreActionState,
  );

  useActionFlashFeedback(state, {
    errorTitle: "Restore failed",
    successTitle: "Restore complete",
  });

  // Pre-check sections that actually differ between current and snapshot,
  // so the default action only touches what's drifted.
  const changedByName = new Map(diffs.map((d) => [d.section, d.changed] as const));
  const initialSelected = new Set<RestoreSection>(
    SECTION_ORDER.filter((s) => changedByName.get(s.matchesDiffSection)).map((s) => s.key),
  );
  const [selected, setSelected] = useState<Set<RestoreSection>>(initialSelected);
  const [destructive, setDestructive] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  function toggle(section: RestoreSection) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  const anySelected = selected.size > 0;
  const clusterScopedSelected = selected.has("storage") || selected.has("firewallRules");
  const networkSelected = selected.has("network");
  const canSubmit = anySelected && confirmation === "RESTORE" && !isPending;

  return (
    <SectionPanel title="Restore">
      <Form action={action} className="space-y-5">
        <input name="siteSlug" type="hidden" value={siteSlug} />
        <input name="snapshotId" type="hidden" value={snapshotId} />

        {/* Section checkboxes */}
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-zinc-400">Sections to restore</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SECTION_ORDER.map((s) => {
              const changed = changedByName.get(s.matchesDiffSection) ?? false;
              const isSelected = selected.has(s.key);
              return (
                <label
                  className="flex items-start gap-2.5 rounded-md border border-white/5 bg-zinc-900/40 px-3 py-2.5 cursor-pointer hover:border-white/10 transition-colors"
                  key={s.key}
                >
                  <input
                    checked={isSelected}
                    className="mt-0.5 h-4 w-4 rounded border-white/10 bg-zinc-900 text-sky-400"
                    name={`section_${s.key}`}
                    onChange={() => toggle(s.key)}
                    type="checkbox"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-medium text-zinc-200">{s.label}</span>
                      {!NODE_SCOPED.has(s.key) && (
                        <Badge variant="warning">cluster-wide</Badge>
                      )}
                      {changed ? (
                        <Badge variant="warning">drift detected</Badge>
                      ) : (
                        <Badge variant="success">matches</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-zinc-600">
                      {NODE_SCOPED.has(s.key)
                        ? `Applied to node ${nodeName}.`
                        : "Affects every node in the cluster."}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Network reload toggle */}
        {networkSelected && (
          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                className="mt-0.5 h-4 w-4 rounded border-white/10 bg-zinc-900 text-sky-400"
                defaultChecked
                name="reloadNetwork"
                type="checkbox"
              />
              <div>
                <p className="text-[13px] font-medium text-zinc-200">
                  Apply network changes (ifreload -a)
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  Without this, interface changes stay pending until someone applies them in the
                  Proxmox UI. Brief connectivity blips are possible during reload.
                </p>
              </div>
            </label>
          </div>
        )}

        {/* Destructive toggle */}
        {clusterScopedSelected && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                checked={destructive}
                className="mt-0.5 h-4 w-4 rounded border-white/10 bg-zinc-900 text-red-400"
                name="destructive"
                onChange={(e) => setDestructive(e.target.checked)}
                type="checkbox"
              />
              <div>
                <p className="text-[13px] font-medium text-zinc-200 flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-red-400" />
                  Destructive mode — also remove items not in the snapshot
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  Default behaviour is additive (re-add or update what was in the snapshot).
                  Enable destructive mode to also DELETE storages and firewall rules that exist
                  now but were not in the snapshot. This can disconnect storage backends and
                  break running workloads — leave off unless you know the snapshot is the
                  authoritative source.
                </p>
              </div>
            </label>
          </div>
        )}

        {/* Warning + confirmation */}
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <p className="text-[13px] font-medium text-zinc-200">You are about to restore:</p>
              <p className="text-[12px] text-zinc-400">
                Snapshot <span className="text-zinc-200">&ldquo;{snapshotLabel}&rdquo;</span> →
                node <Badge variant="neutral">{nodeName}</Badge>
              </p>
              <label className="block">
                <span className="text-[12px] font-medium text-zinc-400">
                  Type <span className="font-mono text-zinc-200">RESTORE</span> to confirm
                </span>
                <input
                  className={fieldClassName}
                  name="confirmation"
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder="RESTORE"
                  value={confirmation}
                />
              </label>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button
            disabled={!canSubmit}
            type="submit"
            variant={destructive ? "danger" : "warning"}
          >
            <History className="h-3.5 w-3.5" />
            {isPending ? "Restoring..." : "Apply restore"}
          </Button>
        </div>

        {/* Per-section results */}
        {state.result && (
          <div className="space-y-2 border-t border-white/5 pt-4">
            <p className="text-[12px] font-medium text-zinc-400">Last restore result</p>
            {state.result.sections
              .filter((s) => s.status !== "skipped")
              .map((s) => (
                <div
                  className="rounded-md border border-white/5 bg-zinc-900/40 px-3 py-2"
                  key={s.section}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-zinc-200 capitalize">
                      {s.section}
                    </span>
                    <Badge
                      variant={
                        s.status === "ok"
                          ? "success"
                          : s.status === "partial"
                            ? "warning"
                            : "destructive"
                      }
                    >
                      {s.status}
                    </Badge>
                  </div>
                  {s.details.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-500">
                      {s.details.map((d, i) => (
                        <li key={i}>• {d}</li>
                      ))}
                    </ul>
                  )}
                  {s.errors.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-[11px] text-red-400">
                      {s.errors.map((e, i) => (
                        <li key={i}>⚠ {e}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
          </div>
        )}
      </Form>
    </SectionPanel>
  );
}
