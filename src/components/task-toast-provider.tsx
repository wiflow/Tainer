"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { CheckCircle2, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";

import type { ActionStatus, ProxmoxTaskHandle } from "@/lib/action-states";
import { cn } from "@/lib/utils";

type FlashToastVariant = "error" | "success";

type FlashToast = {
  id: string;
  message: string;
  title: string;
  type: "flash";
  variant: FlashToastVariant;
};

type TaskSnapshot = {
  completed: boolean;
  exitStatus: string | null;
  latestLog: string | null;
  message: string;
  node: string;
  progress: number;
  status: "error" | "running" | "success" | "warning";
  taskId: string;
  taskType: string;
  upid: string;
};

type TaskSnapshotBatchItem =
  | {
      node: string;
      snapshot: TaskSnapshot;
      upid: string;
    }
  | {
      error: string;
      node: string;
      upid: string;
    };

type TrackedTaskToast = ProxmoxTaskHandle & {
  autoNavigateOnSuccess?: boolean;
  completedAt: number | null;
  id: string;
  message: string;
  progress: number;
  status: "error" | "running" | "success" | "warning";
  successHref?: string;
  type: "task";
};

type ToastItem = FlashToast | TrackedTaskToast;

type ToastPayload = {
  message: string;
  title: string;
  variant: FlashToastVariant;
};

type ActionFeedbackState = {
  message: string;
  requestId: string;
  status: ActionStatus;
  task: ProxmoxTaskHandle | null;
};

type FlashFeedbackState = {
  message: string;
  requestId: string;
  status: ActionStatus;
};

type ActionFeedbackOptions = {
  autoNavigateOnTaskSuccess?: boolean;
  errorTitle: string;
  successTitle: string;
};

type TaskToastContextValue = {
  activeTaskUpids: Set<string>;
  dismissToast: (id: string) => void;
  pushToast: (payload: ToastPayload) => void;
  trackTask: (task: ProxmoxTaskHandle, options?: { autoNavigateOnSuccess?: boolean }) => void;
};

const POLL_FAST_MS = 2000;
const POLL_SLOW_MS = 5000;
const TOAST_TTL_MS = 6000;

const TaskToastContext = createContext<TaskToastContextValue | null>(null);

function randomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function taskKey(node: string, upid: string) {
  return `${node}:${upid}`;
}

function statusAccentClass(status: FlashToastVariant | TrackedTaskToast["status"]) {
  if (status === "success") {
    return "border-emerald-900/80 bg-emerald-950/90 text-emerald-100";
  }

  if (status === "warning") {
    return "border-amber-900/80 bg-amber-950/90 text-amber-100";
  }

  if (status === "error") {
    return "border-rose-900/80 bg-rose-950/90 text-rose-100";
  }

  return "border-sky-900/80 bg-zinc-950/95 text-zinc-100";
}

function ProgressBar({ progress, status }: { progress: number; status: TrackedTaskToast["status"] }) {
  const indicatorClassName =
    status === "success"
      ? "bg-emerald-400"
      : status === "warning"
        ? "bg-amber-400"
      : status === "error"
        ? "bg-rose-400"
        : "bg-sky-400";

  return (
    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", indicatorClassName)}
        style={{ width: `${Math.max(4, Math.min(progress, 100))}%` }}
      />
    </div>
  );
}

function ToastCard({
  onDismiss,
  onNavigate,
  toast,
}: {
  onDismiss: (id: string) => void;
  onNavigate?: (href: string) => void;
  toast: ToastItem;
}) {
  const icon =
    toast.type === "task" ? (
      toast.status === "success" ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
      ) : toast.status === "warning" ? (
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
      ) : toast.status === "error" ? (
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
      ) : (
        <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-sky-300" />
      )
    ) : toast.variant === "success" ? (
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
    ) : (
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
    );

  const status =
    toast.type === "task"
      ? toast.status
      : toast.variant;

  const isClickable =
    toast.type === "task" &&
    (toast.status === "success" || toast.status === "warning") &&
    toast.successHref &&
    onNavigate;

  const handleClick = () => {
    if (
      toast.type === "task" &&
      (toast.status === "success" || toast.status === "warning") &&
      toast.successHref &&
      onNavigate
    ) {
      onDismiss(toast.id);
      onNavigate(toast.successHref);
    }
  };

  return (
    <div
      className={cn(
        "pointer-events-auto w-[min(24rem,calc(100vw-2rem))] rounded-xl border px-4 py-3 shadow-2xl shadow-black/30 backdrop-blur",
        statusAccentClass(status),
        isClickable && "cursor-pointer transition-opacity hover:opacity-90",
      )}
      onClick={isClickable ? handleClick : undefined}
    >
      <div className="flex items-start gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold">{toast.title}</p>
              {toast.type === "task" ? (
                <p className="mt-0.5 text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                  {toast.status === "running"
                    ? `${toast.progress}%`
                    : toast.status === "success"
                      ? isClickable
                        ? "Completed. Click to open"
                        : "Completed"
                      : toast.status === "warning"
                        ? isClickable
                          ? "Completed with warnings. Click to open"
                          : "Completed with warnings"
                      : "Failed"}
                </p>
              ) : null}
            </div>
            <button
              className="flex items-center justify-center w-7 h-7 rounded-md text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100 cursor-pointer"
              onClick={(event) => {
                event.stopPropagation();
                onDismiss(toast.id);
              }}
              aria-label="Dismiss notification"
              type="button"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1.5 whitespace-pre-line text-[12px] leading-relaxed text-zinc-300">
            {toast.message}
          </p>
          {toast.type === "task" ? (
            <>
              <ProgressBar progress={toast.progress} status={toast.status} />
              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                <span>{toast.node}</span>
                <span className="truncate">{toast.upid}</span>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function TaskToastProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const autoNavigatedTaskIds = useRef(new Set<string>());
  const refreshedTaskIds = useRef(new Set<string>());
  const pollInFlightRef = useRef(false);
  const pollCountRef = useRef(0);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(({ message, title, variant }: ToastPayload) => {
    const id = randomId();

    setToasts((current) => [
      ...current,
      {
        id,
        message,
        title,
        type: "flash",
        variant,
      },
    ]);

    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, TOAST_TTL_MS);
  }, []);

  const trackTask = useCallback((task: ProxmoxTaskHandle, options?: { autoNavigateOnSuccess?: boolean }) => {
    pollCountRef.current = 0;
    setToasts((current) => {
      if (
        current.some(
          (toast) =>
            toast.type === "task" &&
            toast.upid === task.upid &&
            toast.node === task.node,
        )
      ) {
        return current;
      }

      return [
        ...current,
        {
          autoNavigateOnSuccess: options?.autoNavigateOnSuccess,
          ...task,
          completedAt: null,
          id: taskKey(task.node, task.upid),
          message: task.submittedMessage,
          progress: 8,
          status: "running",
          type: "task",
        },
      ];
    });
  }, []);

  const pollRunningTasks = useEffectEvent(async () => {
    const activeTasks = toasts.filter(
      (toast): toast is TrackedTaskToast =>
        toast.type === "task" && toast.status === "running",
    );

    if (activeTasks.length === 0 || pollInFlightRef.current) {
      return;
    }

    pollInFlightRef.current = true;
    pollCountRef.current += 1;

    try {
      const response = await fetch("/api/proxmox/task-status", {
        body: JSON.stringify({
          tasks: activeTasks.map((task) => ({
            node: task.node,
            siteSlug: task.siteSlug,
            upid: task.upid,
          })),
        }),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;

        throw new Error(payload?.message || "Failed to fetch task status.");
      }

      const payload = (await response.json()) as {
        tasks?: TaskSnapshotBatchItem[];
      };
      const snapshotsByTask = new Map(
        (payload.tasks ?? []).map((entry) => [taskKey(entry.node, entry.upid), entry]),
      );
      let shouldRefresh = false;

      setToasts((current) =>
        current.map((toast) => {
          if (toast.type !== "task" || toast.status !== "running") {
            return toast;
          }

          const next = snapshotsByTask.get(taskKey(toast.node, toast.upid));

          if (!next) {
            return toast;
          }

          if ("error" in next) {
            if (!refreshedTaskIds.current.has(taskKey(toast.node, toast.upid))) {
              refreshedTaskIds.current.add(taskKey(toast.node, toast.upid));
              shouldRefresh = true;
            }

            return {
              ...toast,
              completedAt: Date.now(),
              message: next.error || "Failed to fetch task status.",
              progress: toast.progress,
              status: "error",
            };
          }

          const message =
            next.snapshot.status === "success"
              ? toast.successMessage
              : next.snapshot.status === "warning"
                ? [toast.successMessage, next.snapshot.message]
                    .filter(Boolean)
                    .join("\n\n")
              : next.snapshot.status === "error"
                ? next.snapshot.exitStatus || next.snapshot.message || "Task failed."
                : next.snapshot.message || "Task is running in Proxmox.";
          const refreshKey = taskKey(toast.node, toast.upid);
          const shouldAutoNavigate =
            next.snapshot.completed
            && (next.snapshot.status === "success" || next.snapshot.status === "warning")
            && Boolean(toast.autoNavigateOnSuccess && toast.successHref);

          if (next.snapshot.completed && !refreshedTaskIds.current.has(refreshKey)) {
            refreshedTaskIds.current.add(refreshKey);
            shouldRefresh = !shouldAutoNavigate;
          }

          return {
            ...toast,
            completedAt: next.snapshot.completed ? Date.now() : null,
            message,
            progress: next.snapshot.progress,
            status: next.snapshot.status,
          };
        }),
      );

      if (shouldRefresh && document.visibilityState === "visible") {
        fetch("/api/revalidate", { method: "POST" }).finally(() => {
          router.refresh();
          // Proxmox updates /cluster/resources on a ~10s cadence, so refresh again after completion.
          for (const delayMs of [1500, 5000, 12000]) {
            setTimeout(() => {
              if (document.visibilityState === "visible") {
                router.refresh();
              }
            }, delayMs);
          }
        });
      }
    } catch {} finally {
      pollInFlightRef.current = false;
    }
  });

  const hasRunningTask = toasts.some(
    (toast) => toast.type === "task" && toast.status === "running",
  );

  useEffect(() => {
    if (!hasRunningTask) {
      return;
    }

    let timeout: number | null = null;
    let cancelled = false;

    const scheduleNextPoll = () => {
      if (cancelled) {
        return;
      }

      timeout = window.setTimeout(() => {
        void runPollLoop();
      }, pollCountRef.current > 15 ? POLL_SLOW_MS : POLL_FAST_MS);
    };

    const runPollLoop = async () => {
      if (cancelled) {
        return;
      }

      if (document.visibilityState === "visible") {
        await pollRunningTasks();
      }

      scheduleNextPoll();
    };

    void runPollLoop();

    return () => {
      cancelled = true;

      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
    };
  }, [hasRunningTask]);

  useEffect(() => {
    const finishedToasts = toasts.filter(
      (toast) => toast.type === "task" && toast.completedAt,
    );

    if (finishedToasts.length === 0) {
      return;
    }

    const timeouts = finishedToasts.map((toast) =>
      window.setTimeout(() => {
        dismissToast(toast.id);
      }, TOAST_TTL_MS),
    );

    return () => {
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
    };
  }, [dismissToast, toasts]);

  useEffect(() => {
    const targetToast = toasts.find(
      (toast): toast is TrackedTaskToast =>
        toast.type === "task"
        && Boolean(toast.completedAt)
        && (toast.status === "success" || toast.status === "warning")
        && Boolean(toast.autoNavigateOnSuccess && toast.successHref)
        && !autoNavigatedTaskIds.current.has(toast.id),
    );

    if (!targetToast?.successHref) {
      return;
    }

    const successHref = targetToast.successHref;

    const attemptNavigation = () => {
      if (document.visibilityState !== "visible" || autoNavigatedTaskIds.current.has(targetToast.id)) {
        return false;
      }

      autoNavigatedTaskIds.current.add(targetToast.id);
      router.push(successHref);
      return true;
    };

    if (attemptNavigation()) {
      return;
    }

    const handleVisibilityChange = () => {
      if (attemptNavigation()) {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [router, toasts]);

  // Reuse the Set when its contents are unchanged so progress updates skip re-renders.
  const prevUpidsRef = useRef<Set<string>>(new Set());
  const activeTaskUpids = useMemo(() => {
    const next = new Set<string>();
    for (const toast of toasts) {
      if (toast.type === "task" && toast.status === "running") {
        next.add(toast.upid);
      }
    }
    const prev = prevUpidsRef.current;
    if (next.size === prev.size) {
      let same = true;
      for (const upid of next) {
        if (!prev.has(upid)) { same = false; break; }
      }
      if (same) return prev;
    }
    prevUpidsRef.current = next;
    return next;
  }, [toasts]);

  const value = useMemo<TaskToastContextValue>(
    () => ({
      activeTaskUpids,
      dismissToast,
      pushToast,
      trackTask,
    }),
    [activeTaskUpids, dismissToast, pushToast, trackTask],
  );

  return (
    <TaskToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-h-[calc(100vh-2rem)] flex-col gap-3 overflow-y-auto" role="log" aria-live="polite" aria-label="Notifications">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} onDismiss={dismissToast} onNavigate={(href) => router.push(href)} toast={toast} />
        ))}
      </div>
    </TaskToastContext.Provider>
  );
}

export function useTaskToasts() {
  const context = useContext(TaskToastContext);

  if (!context) {
    throw new Error("useTaskToasts must be used within a TaskToastProvider.");
  }

  return context;
}

export function useActionTaskFeedback(
  state: ActionFeedbackState,
  options: ActionFeedbackOptions,
) {
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
        title: options.errorTitle,
        variant: "error",
      });
      return;
    }

    if (state.status === "success" && state.task) {
      trackTask(state.task, {
        autoNavigateOnSuccess: options.autoNavigateOnTaskSuccess,
      });
      return;
    }

    if (state.status === "success") {
      pushToast({
        message: state.message,
        title: options.successTitle,
        variant: "success",
      });
    }
  }, [options.errorTitle, options.successTitle, pushToast, state, trackTask]);
}

export function useActionFlashFeedback(
  state: FlashFeedbackState,
  options: ActionFeedbackOptions,
) {
  const { pushToast } = useTaskToasts();
  const handledRequestId = useRef("");

  useEffect(() => {
    if (!state.requestId || state.requestId === handledRequestId.current) {
      return;
    }

    handledRequestId.current = state.requestId;

    if (state.status === "error") {
      pushToast({
        message: state.message,
        title: options.errorTitle,
        variant: "error",
      });
      return;
    }

    if (state.status === "success") {
      pushToast({
        message: state.message,
        title: options.successTitle,
        variant: "success",
      });
    }
  }, [options.errorTitle, options.successTitle, pushToast, state]);
}
