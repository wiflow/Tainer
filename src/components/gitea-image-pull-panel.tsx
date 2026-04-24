"use client";

import { useActionState, useState } from "react";
import { Download, RotateCcw } from "lucide-react";

import { pullGiteaImageAction } from "@/app/gitea-actions";
import { useActionTaskFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { initialDockerHubActionState } from "@/lib/action-states";
import type { GiteaTag } from "@/lib/gitea";
import type { TemplateTarget } from "@/lib/proxmox";
import { useSiteBasePath } from "@/lib/use-site-path";

export function GiteaImagePullPanel({
  name,
  ociReference,
  tags,
  targets,
}: {
  name: string;
  ociReference: string;
  tags: GiteaTag[];
  targets: TemplateTarget[];
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const defaultTag = tags[0]?.name ?? "latest";
  const defaultTarget = targets[0]
    ? `${targets[0].node}::${targets[0].storage}`
    : "";
  const [state, formAction, isPending] = useActionState(
    pullGiteaImageAction,
    initialDockerHubActionState,
  );
  useActionTaskFeedback(state, {
    errorTitle: "Gitea pull failed",
    successTitle: "Gitea pull queued",
  });
  const [selectedTag, setSelectedTag] = useState(defaultTag);
  const [selectedTarget, setSelectedTarget] = useState(defaultTarget);
  const inputClassName =
    "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";
  const [selectedNode, selectedStorage] = selectedTarget.split("::");

  // Update the reference preview with the currently selected tag
  const referencePreview = ociReference.replace(/:([^/]*)$/, `:${selectedTag || defaultTag}`);
  const fileNamePreview = `${name}_${selectedTag || defaultTag}.tar`;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <Card>
        <CardHeader className="border-b border-white/5">
          <CardTitle>Pull To Proxmox CT Templates</CardTitle>
          <CardDescription>
            Pull this Gitea container image into Proxmox as a native OCI CT template.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5">
          <form
            action={formAction}
            className="space-y-4"
            onReset={() => {
              setSelectedTag(defaultTag);
              setSelectedTarget(defaultTarget);
            }}
          >
            <input name="siteSlug" type="hidden" value={siteSlug} />
            <input name="name" type="hidden" value={name} />

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">Tag</span>
                <select
                  className={inputClassName}
                  name="tag"
                  value={selectedTag}
                  onChange={(event) => setSelectedTag(event.target.value)}
                >
                  {tags.length > 0 ? (
                    tags.map((tag) => (
                      <option key={tag.name} value={tag.name}>
                        {tag.name}
                      </option>
                    ))
                  ) : (
                    <option value="latest">latest</option>
                  )}
                </select>
              </label>

              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">Target storage</span>
                <select
                  className={inputClassName}
                  name="target"
                  value={selectedTarget}
                  onChange={(event) => setSelectedTarget(event.target.value)}
                >
                  {targets.length > 0 ? (
                    targets.map((target) => (
                      <option
                        key={`${target.node}::${target.storage}`}
                        value={`${target.node}::${target.storage}`}
                      >
                        {target.storage} ({target.node})
                      </option>
                    ))
                  ) : (
                    <option value="">No CT template storages available</option>
                  )}
                </select>
              </label>
            </div>

            <div className="flex gap-2 border-t border-white/5 pt-4">
              <Button disabled={!selectedTarget || isPending} type="submit">
                <Download className="h-3.5 w-3.5" />
                {isPending ? "Submitting..." : "Pull template"}
              </Button>
              <Button type="reset" variant="secondary">
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader className="border-b border-white/5">
          <CardTitle>Proxmox Output</CardTitle>
          <CardDescription>
            Proxmox converts the registry image into a CT template archive.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <p className="text-[11px] font-medium text-zinc-500">Registry reference</p>
            <p className="mt-1 break-all text-[13px] text-zinc-200">{referencePreview}</p>
          </div>
          <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <p className="text-[11px] font-medium text-zinc-500">Expected template filename</p>
            <p className="mt-1 text-[13px] text-zinc-200">{fileNamePreview}</p>
          </div>
          <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <p className="text-[11px] font-medium text-zinc-500">Destination</p>
            <p className="mt-1 text-[13px] text-zinc-200">
              {selectedStorage && selectedNode
                ? `${selectedStorage} on ${selectedNode}`
                : "No Proxmox CT template storage available"}
            </p>
          </div>
          {targets.length === 0 ? (
            <div className="rounded-md border border-amber-900 bg-amber-950/30 px-4 py-3 text-[12px] leading-relaxed text-amber-300">
              No Proxmox storage that accepts CT templates is currently available to this token.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
