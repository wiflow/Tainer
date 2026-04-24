"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";

import { deleteTagAction } from "@/app/group-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
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
    const message = memberCount > 0
      ? `Delete "${tagName}" and remove it from ${memberCount} deployment(s)?`
      : `Delete "${tagName}"?`;

    if (!confirm(message)) {
      return;
    }

    const nextFormData = new FormData();
    nextFormData.set("siteSlug", siteSlug);
    nextFormData.set("groupId", tagId);
    formAction(nextFormData);
  }

  return (
    <Button
      className={cn(compact && "w-8 px-0", className)}
      disabled={isPending}
      onClick={handleDelete}
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
  );
}
