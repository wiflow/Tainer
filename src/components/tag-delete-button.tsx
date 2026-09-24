"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";

import { deleteTagAction } from "@/app/group-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { initialBasicActionState } from "@/lib/action-states";
import { useSiteBasePath } from "@/lib/use-site-path";
import { cn } from "@/lib/utils";

type TagDeleteButtonProps = {
  className?: string;
  compact?: boolean;
  memberCount?: number;
  redirectTo?: string;
  tagId: string;
  tagName: string;
};

export function TagDeleteButton({
  className,
  compact = false,
  memberCount = 0,
  redirectTo,
  tagId,
  tagName,
}: TagDeleteButtonProps) {
  const router = useRouter();
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(
    deleteTagAction,
    initialBasicActionState,
  );
  const lastHandledRequestId = useRef("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  useActionFlashFeedback(state, {
    errorTitle: "Delete failed",
    successTitle: "Tag deleted",
  });

  useEffect(() => {
    if (!redirectTo || state.status !== "success" || !state.requestId || state.requestId === lastHandledRequestId.current) {
      return;
    }

    lastHandledRequestId.current = state.requestId;
    router.push(redirectTo);
  }, [redirectTo, router, state]);

  function handleDelete() {
    setConfirmOpen(false);
    const nextFormData = new FormData();
    nextFormData.set("siteSlug", siteSlug);
    nextFormData.set("groupId", tagId);
    formAction(nextFormData);
  }

  return (
    <>
      <Button
        className={cn(compact && "w-8 px-0", className)}
        disabled={isPending}
        onClick={() => setConfirmOpen(true)}
        size="sm"
        title={compact ? `Delete ${tagName}` : undefined}
        type="button"
        variant="danger"
      >
        {isPending ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
        {compact ? <span className="sr-only">Delete {tagName}</span> : "Delete"}
      </Button>

      <ConfirmDialog
        consequences={
          memberCount > 0
            ? [
                <>
                  Removed from <span className="text-zinc-200">{memberCount}</span> deployment
                  {memberCount === 1 ? "" : "s"}. The deployments themselves are not touched.
                </>,
              ]
            : undefined
        }
        description={`Delete the tag "${tagName}"?`}
        onConfirm={handleDelete}
        onOpenChange={setConfirmOpen}
        open={confirmOpen}
        pending={isPending}
        title="Delete tag"
      />
    </>
  );
}
