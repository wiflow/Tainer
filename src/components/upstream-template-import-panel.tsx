"use client";

import { useActionState } from "react";
import { Download } from "lucide-react";

import { importUpstreamTemplateAction } from "@/app/proxmox-actions";
import { useActionTaskFeedback } from "@/components/task-toast-provider";
import { initialActionState } from "@/lib/action-states";
import type { AvailableTemplate } from "@/lib/proxmox";
import { useSiteBasePath } from "@/lib/use-site-path";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function UpstreamTemplateImportPanel({
  templates,
}: {
  templates: AvailableTemplate[];
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(
    importUpstreamTemplateAction,
    initialActionState,
  );
  useActionTaskFeedback(state, {
    errorTitle: "Template import failed",
    successTitle: "Template import queued",
  });

  return (
    <Card>
      <CardHeader className="border-b border-white/5">
        <CardTitle>Import Base CT Images</CardTitle>
        <CardDescription>
          Bring in Proxmox-compatible LXC base images that your deployment templates can build on top of.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-zinc-800/60 p-0">
        {templates.length === 0 ? (
          <div className="px-5 py-4 text-[13px] text-zinc-500">
            No upstream LXC templates are visible right now.
          </div>
        ) : (
          templates.map((template) => (
            <form
              key={`${template.storage}:${template.fileName}`}
              action={formAction}
              className="px-5 py-4"
            >
              <input name="siteSlug" type="hidden" value={siteSlug} />
              <input name="node" type="hidden" value={template.node} />
              <input name="storage" type="hidden" value={template.storage} />
              <input name="filename" type="hidden" value={template.fileName} />
              <input name="url" type="hidden" value={template.location} />

              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[13px] font-semibold text-zinc-100">
                      {template.headline}
                    </h2>
                    <Badge variant="neutral">{template.storage}</Badge>
                    <Badge variant="review">{template.os}</Badge>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">
                    {template.description}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-zinc-500">
                    <span>{template.fileName}</span>
                    <span>{template.version}</span>
                    <span>{template.architecture}</span>
                  </div>
                </div>
                <Button disabled={isPending} type="submit" variant="secondary">
                  <Download className="h-3.5 w-3.5" />
                  {isPending ? "Submitting..." : "Import"}
                </Button>
              </div>
            </form>
          ))
        )}
      </CardContent>
    </Card>
  );
}
