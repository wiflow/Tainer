"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type ComponentType } from "react";
import { ExternalLink, LoaderCircle, Play, Power, RotateCcw, SendHorizontal, Square, Trash2 } from "lucide-react";

import { deleteDeploymentAction, migrateDeploymentAction, runDeploymentLifecycleAction } from "@/app/proxmox-actions";
import { deleteVmAction, migrateVmAction, runVmLifecycleActionServer } from "@/app/vm-actions";
import { useActionTaskFeedback, useTaskToasts } from "@/components/task-toast-provider";
import { Button, buttonVariants, type ButtonProps } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { initialActionState } from "@/lib/action-states";
import type { ContainerLifecycleAction, LiveNode, LiveNodeMetrics } from "@/lib/proxmox";
import { useSiteBasePath } from "@/lib/use-site-path";
import { cn } from "@/lib/utils";

type ExtendedAction = ContainerLifecycleAction | "delete";

type DeploymentQuickActionsProps = {
  allowDelete?: boolean;
  className?: string;
  currentNode?: string;
  deploymentId: string;
  nodeMetrics?: LiveNodeMetrics[];
  nodes?: LiveNode[];
  rawStatus: string;
  showViewLink?: boolean;
  siteSlug?: string;
  type?: "lxc" | "qemu";
  vmid: number;
};

type ActionConfig = {
  command: ExtendedAction;
  icon: ComponentType<{ className?: string }>;
  label: string;
  pendingLabel: string;
  variant: "danger" | "default" | "ghost" | "outline" | "secondary" | "success";
};

function getAvailableActions(status: string): ActionConfig[] {
  if (status === "running") {
    return [
      { command: "restart", icon: RotateCcw, label: "Restart", pendingLabel: "Restarting...", variant: "secondary" },
      { command: "shutdown", icon: Power, label: "Shutdown", pendingLabel: "Shutting down...", variant: "secondary" },
      { command: "stop", icon: Square, label: "Force stop", pendingLabel: "Stopping...", variant: "danger" },
    ];
  }

  if (status === "stopped") {
    return [
      { command: "start", icon: Play, label: "Start", pendingLabel: "Starting...", variant: "success" },
      { command: "delete", icon: Trash2, label: "Delete", pendingLabel: "Deleting...", variant: "danger" },
    ];
  }

  return [
    { command: "start", icon: Play, label: "Start", pendingLabel: "Starting...", variant: "success" },
    { command: "stop", icon: Square, label: "Force stop", pendingLabel: "Stopping...", variant: "danger" },
    { command: "delete", icon: Trash2, label: "Delete", pendingLabel: "Deleting...", variant: "danger" },
  ];
}

function MigratePopover({
  currentNode,
  deploymentId,
  nodeMetrics,
  nodes,
  siteSlug,
  type = "lxc",
}: {
  currentNode: string;
  deploymentId: string;
  nodeMetrics: LiveNodeMetrics[];
  nodes: LiveNode[];
  siteSlug: string;
  type?: "lxc" | "qemu";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const migrateAction = type === "qemu" ? migrateVmAction : migrateDeploymentAction;
  const [state, formAction, isPending] = useActionState(migrateAction, initialActionState);

  useActionTaskFeedback(state, {
    errorTitle: "Migration failed",
    successTitle: "Migration queued",
  });

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close after successful submit
  useEffect(() => {
    if (state.status === "success") {
      queueMicrotask(() => setOpen(false));
    }
  }, [state.status, state.requestId]);

  const otherNodes = nodes.filter((n) => n.name !== currentNode && n.status === "online");
  if (otherNodes.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <Button
        className="h-8 w-8 px-0 text-zinc-400 hover:text-zinc-100"
        onClick={() => setOpen((v) => !v)}
        title="Migrate"
        type="button"
        variant="ghost"
      >
        <SendHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-white/5 bg-zinc-950 p-2 shadow-2xl shadow-black/40">
          <p className="px-2 py-1.5 text-[11px] font-medium text-zinc-500">Migrate to</p>
          {otherNodes.map((node) => {
            const m = nodeMetrics.find((entry) => entry.node === node.name);
            const cpuPct = m ? Math.round((m.cpuRatio ?? 0) * 100) : 0;
            const memPct = m && m.memoryTotalBytes ? Math.round(((m.memoryUsedBytes ?? 0) / m.memoryTotalBytes) * 100) : 0;

            return (
              <Form action={formAction} key={node.name}>
                <input name="siteSlug" type="hidden" value={siteSlug} />
                <input name="deploymentId" type="hidden" value={deploymentId} />
                <input name="target" type="hidden" value={node.name} />
                <button
                  className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-[13px] text-zinc-300 transition-colors hover:bg-zinc-800/60"
                  disabled={isPending}
                  type="submit"
                >
                  <span className="font-medium">{node.name}</span>
                  <span className="text-[11px] text-zinc-600">CPU {cpuPct}% · RAM {memPct}%</span>
                </button>
              </Form>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DeploymentQuickActions({
  allowDelete = true,
  className,
  currentNode,
  deploymentId,
  nodeMetrics,
  nodes,
  rawStatus,
  showViewLink = false,
  siteSlug: siteSlugProp,
  type = "lxc",
  vmid,
}: DeploymentQuickActionsProps) {
  const lifecycleServerAction = type === "qemu" ? runVmLifecycleActionServer : runDeploymentLifecycleAction;
  const deleteServerAction = type === "qemu" ? deleteVmAction : deleteDeploymentAction;

  const [lifecycleState, lifecycleAction, isLifecyclePending] = useActionState(
    lifecycleServerAction,
    initialActionState,
  );

  const [deleteState, deleteAction, isDeletePending] = useActionState(
    deleteServerAction,
    initialActionState,
  );

  const router = useRouter();
  const siteBase = useSiteBasePath();
  const siteSlug = siteSlugProp ?? siteBase.replace(/^\/sites\//, "") ?? "";
  const { activeTaskUpids } = useTaskToasts();

  const [pendingCommand, setPendingCommand] = useState<ExtendedAction | null>(null);

  const activeState = pendingCommand === "delete" ? deleteState : lifecycleState;
  const isServerActionPending =
    pendingCommand === "delete"
      ? isDeletePending
      : pendingCommand
        ? isLifecyclePending
        : false;

  const currentUpid =
    activeState.status === "success" ? activeState.task?.upid : null;
  const isTaskRunning = currentUpid ? activeTaskUpids.has(currentUpid) : false;

  useEffect(() => {
    if (!pendingCommand) return;

    if (!isServerActionPending && activeState.status === "error") {
      queueMicrotask(() => setPendingCommand(null));
      return;
    }

    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    if (!isServerActionPending && currentUpid && !isTaskRunning) {
      queueMicrotask(() => {
        setPendingCommand(null);
        router.refresh();
        // Follow-up refresh to catch Proxmox state propagation delay
        refreshTimer = setTimeout(() => router.refresh(), 1500);
      });
    }

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [
    pendingCommand,
    isServerActionPending,
    activeState.status,
    currentUpid,
    isTaskRunning,
    router,
  ]);

  useActionTaskFeedback(lifecycleState, {
    errorTitle: "Deployment action failed",
    successTitle: "Deployment action queued",
  });

  useActionTaskFeedback(deleteState, {
    errorTitle: "Container deletion failed",
    successTitle: "Container deletion queued",
  });

  const actions = getAvailableActions(rawStatus).filter(
    (action) => allowDelete || action.command !== "delete",
  );

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {actions.map((action) => {
        const isCurrentAction = pendingCommand === action.command;
        const isPending = isCurrentAction && (isServerActionPending || isTaskRunning);
        const Icon = isPending ? LoaderCircle : action.icon;
        const btnVariant: NonNullable<ButtonProps["variant"]> = action.variant === "success"
          ? "success"
          : action.variant === "danger"
            ? "danger"
            : "ghost";

        return (
          <Form
            action={action.command === "delete" ? deleteAction : lifecycleAction}
            key={action.command}
            onSubmit={() => setPendingCommand(action.command)}
          >
            <input name="siteSlug" type="hidden" value={siteSlug} />
            <input name="deploymentId" type="hidden" value={deploymentId} />
            <input name="command" type="hidden" value={action.command} />
            <Button
              disabled={isPending}
              title={action.label}
              type="submit"
              variant={btnVariant}
              className="h-8 w-8 px-0 text-zinc-400 hover:text-zinc-100"
            >
              <Icon
                className={cn(
                  "h-4 w-4",
                  isCurrentAction && "animate-spin text-zinc-200",
                )}
              />
              <span className="sr-only">{action.label}</span>
            </Button>
          </Form>
        );
      })}

      {nodes && nodes.length > 1 && currentNode && nodeMetrics && (
        <MigratePopover
          currentNode={currentNode}
          deploymentId={deploymentId}
          nodeMetrics={nodeMetrics}
          nodes={nodes}
          siteSlug={siteSlug}
          type={type}
        />
      )}

      {showViewLink && (
        <Link
          className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "ml-2 h-8")}
          href={`${siteBase}/deployments/${deploymentId}`}
        >
          <ExternalLink className="h-3.5 w-3.5 mr-1" />
          {type === "qemu" ? "VM" : "CT"} {vmid}
        </Link>
      )}
    </div>
  );
}
