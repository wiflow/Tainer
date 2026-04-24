"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";

import { createTagAction } from "@/app/group-actions";
import { TagColorPicker } from "@/components/tag-color-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import { useSiteBasePath } from "@/lib/use-site-path";

export function TagCreateForm() {
  const router = useRouter();
  const siteBase = useSiteBasePath();
  const siteSlug = siteBase.replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(
    createTagAction,
    initialBasicActionState,
  );
  const lastRequestId = useRef(state.requestId);

  useEffect(() => {
    if (state.requestId && state.requestId !== lastRequestId.current) {
      lastRequestId.current = state.requestId;
      if (state.status === "success") {
        router.push(`${siteBase}/tags`);
      }
    }
  }, [state, router, siteBase]);

  const inputClassName =
    "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

  return (
    <Card>
      <CardHeader className="border-b border-white/5">
        <CardTitle>New tag</CardTitle>
      </CardHeader>
      <CardContent className="p-5">
        <Form action={formAction} className="space-y-5">
          <input name="siteSlug" type="hidden" value={siteSlug} />
          <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <span className="text-[13px] font-medium text-zinc-200">Name</span>
            <input
              className={inputClassName}
              name="name"
              placeholder="e.g. Production"
              required
              type="text"
            />
          </label>

          <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <span className="text-[13px] font-medium text-zinc-200">Description</span>
            <textarea
              className={`${inputClassName} min-h-[72px] resize-y`}
              name="description"
              placeholder="Optional description for this tag"
              rows={2}
            />
          </label>

          <TagColorPicker defaultValue="emerald" />

          {state.status === "error" && state.message && (
            <div className="rounded-md border border-red-800/50 bg-red-900/20 px-4 py-3 text-[13px] text-red-300">
              {state.message}
            </div>
          )}

          <div className="flex gap-2 border-t border-white/5 pt-4">
            <Button disabled={isPending} type="submit">
              {isPending ? "Creating..." : "Create tag"}
            </Button>
          </div>
        </Form>
      </CardContent>
    </Card>
  );
}
