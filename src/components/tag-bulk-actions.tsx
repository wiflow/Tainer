"use client";

import { useActionState, useEffect, useRef } from "react";
import { LoaderCircle, Play, Power, RotateCw, Square } from "lucide-react";

import { bulkTagLifecycleAction } from "@/app/group-actions";
import { useTaskToasts } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { initialBulkActionState } from "@/lib/action-states";
import { useSiteBasePath } from "@/lib/use-site-path";
import { cn } from "@/lib/utils";

type TagBulkActionsProps = {
  tagSlug: string;
  hasRunning: boolean;
  hasStopped: boolean;
};

type BulkCommand = "restart" | "shutdown" | "start" | "stop";

type ActionConfig = {
  command: BulkCommand;
  disabledWhen: "noRunning" | "noStopped";
  icon: typeof Play;
  label: string;
  variant: "danger" | "ghost" | "secondary" | "success";
};

const actions: ActionConfig[] = [
  { command: "start", disabledWhen: "noStopped", icon: Play, label: "Start All", variant: "success" },
  { command: "stop", disabledWhen: "noRunning", icon: Square, label: "Stop All", variant: "danger" },
  { command: "restart", disabledWhen: "noRunning", icon: RotateCw, label: "Restart All", variant: "secondary" },
  { command: "shutdown", disabledWhen: "noRunning", icon: Power, label: "Shutdown All", variant: "secondary" },
];

export function TagBulkActions({
  tagSlug,
  hasRunning,
  hasStopped,
}: TagBulkActionsProps) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(
    bulkTagLifecycleAction,
    initialBulkActionState,
  );

  const { pushToast, trackTask } = useTaskToasts();
  const handledRequestId = useRef("");

  useEffect(() => {
    if (!state.requestId || state.requestId === handledRequestId.current) {
      return;
    }

    handledRequestId.current = state.requestId;

    if (state.status === "error") {
      pushToast({
        message: state.message,
        title: "Bulk action failed",
        variant: "error",
      });
      return;
    }

    if (state.status === "success") {
      for (const task of state.tasks) {
        trackTask(task);
      }
    }
  }, [state, pushToast, trackTask]);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {actions.map((action) => {
        const isDisabled =
          isPending ||
          (action.disabledWhen === "noRunning" && !hasRunning) ||
          (action.disabledWhen === "noStopped" && !hasStopped);

        const Icon = isPending ? LoaderCircle : action.icon;

        return (
          <Form action={formAction} key={action.command}>
            <input name="siteSlug" type="hidden" value={siteSlug} />
            <input name="groupSlug" type="hidden" value={tagSlug} />
            <input name="command" type="hidden" value={action.command} />
            <Button
              className="h-8 w-8 px-0 text-zinc-400 hover:text-zinc-100"
              disabled={isDisabled}
              title={action.label}
              type="submit"
              variant={
                action.variant === "success"
                  ? "success"
                  : action.variant === "danger"
                    ? "danger"
                    : "ghost"
              }
            >
              <Icon
                className={cn(
                  "h-4 w-4",
                  isPending && "animate-spin text-zinc-200",
                )}
              />
              <span className="sr-only">{action.label}</span>
            </Button>
          </Form>
        );
      })}
    </div>
  );
}
