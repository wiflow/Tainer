"use client";

import { useActionState } from "react";
import { Download } from "lucide-react";

import { pullCustomRegistryAction } from "@/app/docker-hub-actions";
import { useActionTaskFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialDockerHubActionState } from "@/lib/action-states";
import type { TemplateTarget } from "@/lib/proxmox";
import { useSiteBasePath } from "@/lib/use-site-path";

export function CustomRegistryPullPanel({
  defaultReference,
  targets,
}: {
  defaultReference?: string;
  targets: TemplateTarget[];
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const defaultTarget = targets[0]
    ? `${targets[0].node}::${targets[0].storage}`
    : "";
  const [state, formAction, isPending] = useActionState(
    pullCustomRegistryAction,
    initialDockerHubActionState,
  );
  useActionTaskFeedback(state, {
    errorTitle: "Registry pull failed",
    successTitle: "Registry pull queued",
  });

  const inputClassName =
    "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

  return (
    <Card>
      <CardHeader className="border-b border-white/5">
        <CardTitle>Pull from custom registry</CardTitle>
        <CardDescription>
          Pull an OCI container image from any registry (Gitea, GitLab, Harbor, etc.) directly into Proxmox storage.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5">
        <Form action={formAction} className="space-y-4">
          <input name="siteSlug" type="hidden" value={siteSlug} />
          <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <span className="text-[13px] font-medium text-zinc-200">Image reference</span>
            <input
              className={`${inputClassName} font-mono`}
              defaultValue={defaultReference ?? ""}
              name="reference"
              placeholder="registry.example.com/org/image:tag"
            />
            <p className="mt-1.5 text-[11px] text-zinc-600">
              OCI reference with tag (e.g. <code className="text-zinc-500">infra-repository/Container-Images/nxs-nexusterm:latest</code>). https:// is stripped automatically.
            </p>
          </label>

          <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <span className="text-[13px] font-medium text-zinc-200">Target storage</span>
            <select
              className={inputClassName}
              defaultValue={defaultTarget}
              disabled={targets.length === 0}
              name="target"
            >
              {targets.length > 0 ? (
                targets.map((target) => (
                  <option
                    key={`${target.node}::${target.storage}`}
                    value={`${target.node}::${target.storage}`}
                  >
                    {target.shared
                      ? target.storage
                      : `${target.storage} on ${target.node}`}
                  </option>
                ))
              ) : (
                <option value="">No CT template storage visible</option>
              )}
            </select>
          </label>

          <Button disabled={isPending || targets.length === 0} type="submit" variant="secondary">
            <Download className="h-3.5 w-3.5" />
            {isPending ? "Pulling..." : "Pull image"}
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}
