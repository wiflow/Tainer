"use client";

import { useActionState, useState } from "react";

import { updateTagAction } from "@/app/group-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { initialBasicActionState } from "@/lib/action-states";
import { TAG_COLOR_OPTIONS } from "@/lib/tag-utils";
import { useSiteBasePath } from "@/lib/use-site-path";
import { cn } from "@/lib/utils";

export function TagColorEditor({
  tagId,
  currentColor,
  description,
}: {
  tagId: string;
  currentColor: string;
  description: string;
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [selected, setSelected] = useState(currentColor);
  const [state, formAction, isPending] = useActionState(
    updateTagAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(state, {
    errorTitle: "Color update failed",
    successTitle: "Tag color updated",
  });

  function handleClick(color: string) {
    setSelected(color);
    const fd = new FormData();
    fd.set("siteSlug", siteSlug);
    fd.set("groupId", tagId);
    fd.set("color", color);
    fd.set("description", description);
    formAction(fd);
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {TAG_COLOR_OPTIONS.map((color) => (
        <button
          key={color.value}
          type="button"
          disabled={isPending}
          onClick={() => handleClick(color.value)}
          className={cn(
            "h-6 w-6 rounded-full border-2 transition-all",
            color.swatch,
            selected === color.value
              ? "border-zinc-300 ring-2 ring-offset-1 ring-offset-zinc-950 " + color.ring
              : "border-transparent hover:border-zinc-500",
          )}
          title={color.value}
        />
      ))}
    </div>
  );
}
