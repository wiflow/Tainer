"use client";

import { useActionState, useState } from "react";
import { ArrowUpCircle, Loader2 } from "lucide-react";

import { recreateFromTemplateAction } from "@/app/proxmox-actions";
import { useActionTaskFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { initialActionState } from "@/lib/action-states";
import { useSiteBasePath } from "@/lib/use-site-path";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function DeploymentUpdateBanner({
  canRecreate = true,
  deploymentId,
  templateId,
  templateName,
  deployedAt,
  templateUpdatedAt,
  imageUpdated = false,
}: {
  canRecreate?: boolean;
  deploymentId: string;
  templateId: string;
  templateName: string;
  deployedAt: string;
  templateUpdatedAt: string;
  imageUpdated?: boolean;
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [showConfirm, setShowConfirm] = useState(false);
  const [state, formAction, isPending] = useActionState(
    recreateFromTemplateAction,
    initialActionState,
  );
  useActionTaskFeedback(state, {
    errorTitle: "Recreate failed",
    successTitle: "Container recreating",
  });

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <ArrowUpCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <p className="text-[13px] font-medium text-amber-200">
              {imageUpdated ? "Image update available" : "Template update available"}
            </p>
            <p className="mt-0.5 text-[12px] text-zinc-400">
              {imageUpdated
                ? <>The base image for <span className="text-zinc-500">{templateName}</span> has changed since this container was deployed on {formatDate(deployedAt)}.</>
                : <><span className="text-zinc-500">{templateName}</span> was updated on {formatDate(templateUpdatedAt)}. This container was deployed on {formatDate(deployedAt)}.</>
              }
            </p>
          </div>
        </div>

        {!showConfirm && canRecreate ? (
          <Button
            onClick={() => setShowConfirm(true)}
            size="sm"
            variant="secondary"
            className="shrink-0"
          >
            <ArrowUpCircle className="h-3.5 w-3.5" />
            Update container
          </Button>
        ) : showConfirm && canRecreate ? (
          <Form action={formAction} className="flex items-center gap-2">
            <input name="siteSlug" type="hidden" value={siteSlug} />
            <input name="deploymentId" type="hidden" value={deploymentId} />
            <input name="templateId" type="hidden" value={templateId} />
            <input
              name="password"
              type="password"
              placeholder="Root password"
              required
              className="h-8 w-36 rounded-md border border-white/10 bg-zinc-900 px-2 text-[12px] text-zinc-200 outline-none focus:border-zinc-500"
            />
            <Button disabled={isPending} size="sm" variant="secondary" type="submit">
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowUpCircle className="h-3.5 w-3.5" />
              )}
              {isPending ? "Recreating..." : "Confirm"}
            </Button>
            <Button
              onClick={() => setShowConfirm(false)}
              size="sm"
              variant="ghost"
              type="button"
            >
              Cancel
            </Button>
          </Form>
        ) : (
          <p className="text-[12px] text-amber-200/80">
            Administrator access is required to recreate this container.
          </p>
        )}
      </div>
    </div>
  );
}
