"use client";

import { useActionState } from "react";
import { ArrowRightLeft } from "lucide-react";

import { migrateDeploymentAction } from "@/app/proxmox-actions";
import { useActionTaskFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialActionState } from "@/lib/action-states";
import type { LiveNodeMetrics, LiveNode } from "@/lib/proxmox";
import { useSiteBasePath } from "@/lib/use-site-path";

export function DeploymentMigratePanel({
  currentNode,
  deploymentId,
  nodeMetrics,
  nodes,
}: {
  currentNode: string;
  deploymentId: string;
  nodeMetrics: LiveNodeMetrics[];
  nodes: LiveNode[];
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(
    migrateDeploymentAction,
    initialActionState,
  );
  useActionTaskFeedback(state, {
    errorTitle: "Migration failed",
    successTitle: "Migration queued",
  });

  const inputClassName =
    "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

  const otherNodes = nodes.filter(
    (n) => n.name !== currentNode && n.status === "online",
  );

  if (otherNodes.length === 0) return null;

  return (
    <Card>
      <CardHeader className="border-b border-white/5">
        <CardTitle>Migrate</CardTitle>
        <CardDescription>
          Move this container to another node in the cluster.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5">
        <Form action={formAction} className="space-y-4">
          <input name="siteSlug" type="hidden" value={siteSlug} />
          <input name="deploymentId" type="hidden" value={deploymentId} />

          <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <span className="text-[13px] font-medium text-zinc-200">Target node</span>
            <select className={inputClassName} name="target">
              {otherNodes.map((node) => {
                const m = nodeMetrics.find((entry) => entry.node === node.name);
                const cpuPct = m ? Math.round((m.cpuRatio ?? 0) * 100) : 0;
                const memPct =
                  m && m.memoryTotalBytes
                    ? Math.round(
                        ((m.memoryUsedBytes ?? 0) / m.memoryTotalBytes) * 100,
                      )
                    : 0;

                return (
                  <option key={node.name} value={node.name}>
                    {node.name} (CPU {cpuPct}% · RAM {memPct}%)
                  </option>
                );
              })}
            </select>
          </label>

          <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[12px] text-zinc-500">
            Currently on <span className="font-medium text-zinc-300">{currentNode}</span>. The container will be restarted on the target node.
          </div>

          <Button disabled={isPending} type="submit" variant="secondary">
            <ArrowRightLeft className="h-3.5 w-3.5" />
            {isPending ? "Migrating..." : "Migrate container"}
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}
