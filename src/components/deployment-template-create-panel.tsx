"use client";

import { useActionState, useState } from "react";
import { Save } from "lucide-react";

import { createDeploymentTemplateAction } from "@/app/deployment-template-actions";
import { EnvVarsField, type EnvSuggestionGroup } from "@/components/env-vars-field";
import { useActionTaskFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { initialActionState } from "@/lib/action-states";
import type { LiveTemplate, RootfsTarget } from "@/lib/proxmox";
import { useSiteBasePath } from "@/lib/use-site-path";
import { formatBytes } from "@/lib/utils";

export function DeploymentTemplateCreatePanel({
  baseTemplates,
  defaultRootfsStorage,
  imageEnvMap,
  rootfsTargets,
}: {
  baseTemplates: LiveTemplate[];
  defaultRootfsStorage: string;
  imageEnvMap: Record<string, string>;
  rootfsTargets: RootfsTarget[];
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(
    createDeploymentTemplateAction,
    initialActionState,
  );
  useActionTaskFeedback(state, {
    errorTitle: "Template save failed",
    successTitle: "Template saved",
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState(baseTemplates[0]?.id ?? "");

  const inputClassName =
    "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";
  const selectedTemplate = baseTemplates.find((template) => template.id === selectedTemplateId) ?? baseTemplates[0] ?? null;
  const selectedTemplateFileName = selectedTemplate?.volid.split("/").at(-1) ?? "";
  const defaultImageEnv = selectedTemplate
    ? imageEnvMap[selectedTemplate.volid] || imageEnvMap[selectedTemplateFileName] || ""
    : "";
  const envSuggestionGroups: EnvSuggestionGroup[] = [
    {
      title: "Common container vars",
      description: "Reusable container/runtime variables. LXC itself does not have a fixed exhaustive env allowlist, so custom keys are still supported.",
      text: [
        "TZ=UTC",
        "LANG=en_US.UTF-8",
        "LANGUAGE=en_US",
        "LC_ALL=en_US.UTF-8",
        "HTTP_PROXY=",
        "HTTPS_PROXY=",
        "NO_PROXY=",
        "APP_ENV=production",
        "LOG_LEVEL=info",
      ].join("\n"),
    },
    {
      title: "Image vars",
      description: "Variables discovered from the selected image import.",
      text: defaultImageEnv,
    },
  ];

  return (
    <Card>
      <CardHeader className="border-b border-white/5">
        <CardTitle>Create Deployment Template</CardTitle>
        <CardDescription>
          Save a reusable configuration on top of a base CT image so future deployments start from approved defaults.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5">
        <form
          action={formAction}
          className="space-y-5"
          onReset={() => setSelectedTemplateId(baseTemplates[0]?.id ?? "")}
        >
          <input name="siteSlug" type="hidden" value={siteSlug} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Template name</span>
              <input
                className={inputClassName}
                defaultValue=""
                name="name"
                placeholder="Grafana standard"
                type="text"
              />
            </label>

            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Hostname prefix</span>
              <input
                className={inputClassName}
                defaultValue=""
                name="hostnamePrefix"
                placeholder="grafana"
                type="text"
              />
            </label>
          </div>

          <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <span className="text-[13px] font-medium text-zinc-200">Description</span>
            <textarea
              className={`${inputClassName} min-h-24 resize-y`}
              defaultValue=""
              name="description"
              placeholder="Internal Grafana deployment with standard storage, memory, and environment defaults."
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Base CT image</span>
              <select
                className={inputClassName}
                name="sourceTemplateId"
                onChange={(event) => setSelectedTemplateId(event.target.value)}
                value={selectedTemplateId}
              >
                {baseTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.storage})
                  </option>
                ))}
              </select>
            </label>

            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Default rootfs storage</span>
              <select
                className={inputClassName}
                defaultValue={defaultRootfsStorage}
                name="rootfsStorage"
              >
                {rootfsTargets.map((target) => (
                  <option key={`${target.node}::${target.storage}`} value={target.storage}>
                    {target.shared
                      ? `${target.storage} (${target.type})`
                      : `${target.storage} on ${target.node}`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Rootfs size (GB)</span>
              <input className={inputClassName} defaultValue="8" min="1" name="rootfsSize" type="number" />
            </label>
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Memory (MB)</span>
              <input className={inputClassName} defaultValue="512" min="128" name="memory" type="number" />
            </label>
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Cores</span>
              <input className={inputClassName} defaultValue="2" min="1" name="cores" type="number" />
            </label>
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Bridge</span>
              <input className={inputClassName} defaultValue="vmbr0" name="bridge" type="text" />
            </label>
          </div>

          <EnvVarsField
            helperText="Auto-filled from imported image defaults when available. Edit, remove, or add variables before saving the template."
            initialText={defaultImageEnv}
            key={`${selectedTemplateId}:${defaultImageEnv}`}
            label="Default environment"
            name="envText"
            placeholder="value"
            suggestionGroups={envSuggestionGroups}
          />

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-300 sm:col-span-3">
              <input defaultChecked name="accessReady" type="checkbox" />
              Managed SSH access ready
            </label>
            <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-300">
              <input defaultChecked name="unprivileged" type="checkbox" />
              Unprivileged
            </label>
            <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-300">
              <input name="onboot" type="checkbox" />
              Start on boot
            </label>
            <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-300">
              <input defaultChecked name="startAfterCreate" type="checkbox" />
              Start after create
            </label>
          </div>

          <input name="managedLoginUser" type="hidden" value="tainer" />

          <p className="text-[11px] leading-relaxed text-zinc-600">
            SSH-ready LXC templates must already include `sshd`, the managed `tainer` user, and trust for the
            current Tainer SSH CA. Tainer no longer shells into containers with `pct enter`.
          </p>

          <div className="flex items-center justify-between gap-3 border-t border-white/5 pt-4">
            <p className="text-[12px] text-zinc-500">
              {baseTemplates.length} base image{baseTemplates.length === 1 ? "" : "s"} and{" "}
              {rootfsTargets.length} rootfs pool{rootfsTargets.length === 1 ? "" : "s"} visible.
            </p>
            <Button
              disabled={isPending || baseTemplates.length === 0 || rootfsTargets.length === 0}
              type="submit"
              variant="secondary"
            >
              <Save className="h-3.5 w-3.5" />
              {isPending ? "Saving..." : "Save template"}
            </Button>
          </div>

          {rootfsTargets.length > 0 ? (
            <div className="flex flex-wrap gap-2 text-[11px] text-zinc-500">
              {rootfsTargets.map((target) => (
                <span
                  key={`${target.node}::${target.storage}`}
                  className="rounded-full border border-white/5 bg-zinc-900 px-2.5 py-1"
                >
                  {target.shared ? target.storage : `${target.storage} on ${target.node}`} · {formatBytes(target.availableBytes ?? 0)} free
                </span>
              ))}
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
