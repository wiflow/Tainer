"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Shield, ShieldOff, Trash2 } from "lucide-react";

import {
  addGuestFirewallRuleAction,
  deleteGuestFirewallRuleAction,
  setGuestFirewallEnabledAction,
} from "@/app/guest-firewall-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import type { GuestFirewallOptions, GuestFirewallRule } from "@/lib/proxmox";
import { cn } from "@/lib/utils";

const inputClassName =
  "w-full rounded-md border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-[12.5px] text-zinc-200 outline-none transition-colors focus:border-zinc-500";

/**
 * Per-guest Proxmox firewall: enable toggle, rule list, add/delete. The
 * guest firewall only takes effect on NICs whose firewall flag is on —
 * surfaced here because it's the #1 "why isn't my rule working" gotcha.
 */
export function DeploymentFirewallCard({
  siteSlug,
  deploymentId,
  options,
  rules,
  canManage,
}: {
  siteSlug: string;
  deploymentId: string;
  options: GuestFirewallOptions;
  rules: GuestFirewallRule[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [toggleState, toggleAction, isToggling] = useActionState(
    setGuestFirewallEnabledAction,
    initialBasicActionState,
  );
  const [addState, addAction, isAdding] = useActionState(
    addGuestFirewallRuleAction,
    initialBasicActionState,
  );
  const [deleteState, deleteAction, isDeleting] = useActionState(
    deleteGuestFirewallRuleAction,
    initialBasicActionState,
  );
  const [showAddForm, setShowAddForm] = useState(false);

  useActionFlashFeedback(toggleState, {
    errorTitle: "Firewall toggle failed",
    successTitle: "Firewall updated",
  });
  useActionFlashFeedback(addState, {
    errorTitle: "Rule not added",
    successTitle: "Firewall rule added",
  });
  useActionFlashFeedback(deleteState, {
    errorTitle: "Rule not deleted",
    successTitle: "Firewall rule deleted",
  });

  // Re-pull server data after any successful mutation.
  const handledRef = useRef("");
  useEffect(() => {
    for (const state of [toggleState, addState, deleteState]) {
      if (
        state.status === "success" &&
        state.requestId &&
        state.requestId !== handledRef.current
      ) {
        handledRef.current = state.requestId;
        router.refresh();
      }
    }
  }, [toggleState, addState, deleteState, router]);

  const hidden = (
    <>
      <input name="siteSlug" type="hidden" value={siteSlug} />
      <input name="deploymentId" type="hidden" value={deploymentId} />
    </>
  );

  return (
    <Card>
      <CardHeader className="border-b border-white/5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              {options.enable ? (
                <Shield className="h-4 w-4 text-emerald-400" />
              ) : (
                <ShieldOff className="h-4 w-4 text-zinc-500" />
              )}
              Firewall
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium border",
                  options.enable
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                    : "border-white/10 bg-white/[0.04] text-zinc-500",
                )}
              >
                {options.enable ? "enabled" : "disabled"}
              </span>
            </CardTitle>
            <CardDescription>
              Guest-level rules (policy in: {options.policyIn}, out: {options.policyOut}).
              Rules only apply on interfaces with their firewall flag on. Set it per NIC
              in Proxmox (firewall=1 on the netN line).
            </CardDescription>
          </div>
          {canManage ? (
            <Form action={toggleAction}>
              {hidden}
              <input name="enable" type="hidden" value={options.enable ? "0" : "1"} />
              <Button
                disabled={isToggling}
                size="sm"
                type="submit"
                variant={options.enable ? "secondary" : "success"}
              >
                {isToggling ? "Applying…" : options.enable ? "Disable" : "Enable"}
              </Button>
            </Form>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rules.length === 0 ? (
          <p className="px-5 py-4 text-[12.5px] text-zinc-500">
            No guest-level rules — traffic follows the default policies above
            {options.enable ? "" : " once the firewall is enabled"}.
          </p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-white/5 bg-black/40 text-zinc-400">
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Dir</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Proto</th>
                <th className="px-4 py-2 font-medium">Port</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Comment</th>
                {canManage ? <th className="w-10 px-2 py-2" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rules.map((rule) => (
                <tr key={rule.pos} className={cn(rule.enable === 0 && "opacity-45")}>
                  <td className="px-4 py-2 tabular-nums text-zinc-500">{rule.pos}</td>
                  <td className="px-4 py-2 font-mono text-[11px] text-zinc-300">
                    {rule.type ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10.5px] font-medium",
                        rule.action === "ACCEPT"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-rose-500/15 text-rose-300",
                      )}
                    >
                      {rule.action ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px] text-zinc-400">
                    {rule.proto ?? "any"}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px] text-zinc-300">
                    {rule.dport ?? "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px] text-zinc-400">
                    {rule.source ?? "any"}
                  </td>
                  <td className="max-w-[160px] truncate px-4 py-2 text-zinc-500">
                    {rule.comment ?? ""}
                  </td>
                  {canManage ? (
                    <td className="px-2 py-1.5">
                      <Form action={deleteAction}>
                        {hidden}
                        <input name="pos" type="hidden" value={rule.pos} />
                        <Button
                          className="h-7 w-7 px-0 text-zinc-500 hover:text-rose-300"
                          disabled={isDeleting}
                          title={`Delete rule #${rule.pos}`}
                          type="submit"
                          variant="ghost"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </Form>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}

        {canManage ? (
          <div className="border-t border-white/5 px-5 py-3">
            {showAddForm ? (
              <Form action={addAction} className="space-y-3">
                {hidden}
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <label className="block text-[11px] text-zinc-500">
                    Direction
                    <select name="type" className={inputClassName} defaultValue="in">
                      <option value="in">in</option>
                      <option value="out">out</option>
                    </select>
                  </label>
                  <label className="block text-[11px] text-zinc-500">
                    Action
                    <select name="action" className={inputClassName} defaultValue="ACCEPT">
                      <option value="ACCEPT">ACCEPT</option>
                      <option value="DROP">DROP</option>
                      <option value="REJECT">REJECT</option>
                    </select>
                  </label>
                  <label className="block text-[11px] text-zinc-500">
                    Protocol
                    <input name="proto" className={inputClassName} placeholder="tcp" />
                  </label>
                  <label className="block text-[11px] text-zinc-500">
                    Port(s)
                    <input name="dport" className={inputClassName} placeholder="443 or 8000:8100" />
                  </label>
                  <label className="block text-[11px] text-zinc-500">
                    Source
                    <input name="source" className={inputClassName} placeholder="any" />
                  </label>
                  <label className="block text-[11px] text-zinc-500">
                    Comment
                    <input name="comment" className={inputClassName} placeholder="optional" />
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <Button disabled={isAdding} size="sm" type="submit">
                    {isAdding ? "Adding…" : "Add rule"}
                  </Button>
                  <Button
                    onClick={() => setShowAddForm(false)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                </div>
              </Form>
            ) : (
              <Button onClick={() => setShowAddForm(true)} size="sm" type="button" variant="secondary">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add rule
              </Button>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
