"use client";

import { useActionState, useState } from "react";
import { Play, RotateCcw } from "lucide-react";

import { createLxcAction } from "@/app/proxmox-actions";
import {
  EnvSuggestionsCard,
  EnvVarsEditorCard,
  type EnvSuggestionGroup,
  useEnvVarsFieldController,
} from "@/components/env-vars-field";
import { LxcNetworkFields } from "@/components/lxc-network-fields";
import { useActionTaskFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NodeSelector } from "@/components/node-selector";
import { initialActionState } from "@/lib/action-states";
import type { LiveNode, LiveNodeMetrics, LiveTemplate, ProxmoxIssue, RootfsTarget } from "@/lib/proxmox";
import { useSiteBasePath } from "@/lib/use-site-path";

type LxcIpPoolOption = {
  availableAddresses: string[];
  availableCount: number;
  bridge: string;
  defaultDns: string;
  gateway: string;
  hostPrefix: number;
  id: string;
  name: string;
  subnet: string;
  tagName: string | null;
};

export function TemplateFormPreview({
  defaultRootfsStorage,
  imageEnv,
  ipPools,
  issues,
  nextId,
  nodeMetrics,
  nodes,
  suggestedNode,
  rootfsTargets,
  template,
}: {
  defaultRootfsStorage: string;
  imageEnv: string;
  ipPools: LxcIpPoolOption[];
  issues: ProxmoxIssue[];
  nextId: string | null;
  nodeMetrics: LiveNodeMetrics[];
  nodes: LiveNode[];
  suggestedNode?: string | null;
  rootfsTargets: RootfsTarget[];
  template: LiveTemplate;
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(
    createLxcAction,
    initialActionState,
  );
  useActionTaskFeedback(state, {
    autoNavigateOnTaskSuccess: true,
    errorTitle: "Container creation failed",
    successTitle: "Container creation queued",
  });

  const inputClassName =
    "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";
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
      text: imageEnv,
    },
  ];
  const envController = useEnvVarsFieldController({
    initialText: imageEnv,
    suggestionGroups: envSuggestionGroups,
  });
  const [networkMode, setNetworkMode] = useState<"dhcp" | "static">("dhcp");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
      <Card>
        <CardHeader className="border-b border-white/5">
          <div>
            <CardTitle>Launch configuration</CardTitle>
            <CardDescription>
              Real Proxmox create parameters for the selected LXC template image.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-5">
          <form
            action={formAction}
            className="space-y-6"
            onReset={() => setNetworkMode("dhcp")}
          >
            <input name="siteSlug" type="hidden" value={siteSlug} />
            <input name="ostemplate" type="hidden" value={template.volid} />

            <section>
              <h4 className="mb-3 text-[12px] font-medium text-zinc-500">
                Identity
              </h4>
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                  <span className="text-[13px] font-medium text-zinc-200">Node</span>
                  <NodeSelector
                    className={inputClassName}
                    defaultNode={template.node}
                    metrics={nodeMetrics}
                    name="node"
                    nodes={nodes}
                    suggestedNode={suggestedNode}
                  />
                </label>
                <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                  <span className="text-[13px] font-medium text-zinc-200">VMID</span>
                  <input
                    className={inputClassName}
                    defaultValue={nextId ?? ""}
                    name="vmid"
                    type="number"
                  />
                </label>
                <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3 sm:col-span-2 2xl:col-span-1">
                  <span className="text-[13px] font-medium text-zinc-200">Hostname</span>
                  <input
                    className={inputClassName}
                    defaultValue={template.name
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-|-$/g, "")
                    }
                    name="hostname"
                    type="text"
                  />
                </label>
              </div>
            </section>

            <section>
              <h4 className="mb-3 text-[12px] font-medium text-zinc-500">
                Runtime
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                  <span className="text-[13px] font-medium text-zinc-200">Rootfs storage</span>
                  <select
                    className={inputClassName}
                    defaultValue={defaultRootfsStorage}
                    disabled={rootfsTargets.length === 0}
                    name="rootfsStorage"
                  >
                    {rootfsTargets.length > 0 ? (
                      rootfsTargets.map((target) => (
                        <option key={`${target.node}::${target.storage}`} value={target.storage}>
                          {target.storage} ({target.type})
                        </option>
                      ))
                    ) : (
                      <option value="">No rootfs-capable storage visible</option>
                    )}
                  </select>
                </label>
                <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                  <span className="text-[13px] font-medium text-zinc-200">Rootfs size (GB)</span>
                  <input
                    className={inputClassName}
                    defaultValue="8"
                    min="1"
                    name="rootfsSize"
                    type="number"
                  />
                </label>
                <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                  <span className="text-[13px] font-medium text-zinc-200">Memory (MB)</span>
                  <input
                    className={inputClassName}
                    defaultValue="512"
                    min="128"
                    name="memory"
                    type="number"
                  />
                </label>
                <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                  <span className="text-[13px] font-medium text-zinc-200">Cores</span>
                  <input
                    className={inputClassName}
                    defaultValue="2"
                    min="1"
                    name="cores"
                    type="number"
                  />
                </label>
              </div>
            </section>

            <section>
              <h4 className="mb-3 text-[12px] font-medium text-zinc-500">
                Access and networking
              </h4>
              <div className="space-y-3">
                <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                  <span className="text-[13px] font-medium text-zinc-200">Root password</span>
                  <input className={inputClassName} name="password" type="password" />
                </label>
                <LxcNetworkFields
                  defaultBridge="vmbr0"
                  inputClassName={inputClassName}
                  ipPools={ipPools}
                  mode={networkMode}
                  onModeChange={setNetworkMode}
                />
                <EnvVarsEditorCard
                  controller={envController}
                  helperText={
                    imageEnv
                      ? "Pre-filled from imported image defaults. Edit, remove, or add variables before create."
                      : "No cached image defaults were found for this image yet. Add any variables you need before create."
                  }
                  label="Initial environment variables"
                  name="envText"
                  placeholder="value"
                />
              </div>
            </section>

            <section>
              <h4 className="mb-3 text-[12px] font-medium text-zinc-500">
                Defaults
              </h4>
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-300">
                  <input defaultChecked name="unprivileged" type="checkbox" />
                  Unprivileged
                </label>
                <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-300">
                  <input name="onboot" type="checkbox" />
                  Start on boot
                </label>
                <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-300 sm:col-span-2 2xl:col-span-1">
                  <input defaultChecked name="start" type="checkbox" />
                  Start after create
                </label>
              </div>
            </section>

            <div className="flex gap-2 border-t border-white/5 pt-4">
              <Button disabled={isPending || rootfsTargets.length === 0} type="submit">
                <Play className="h-3.5 w-3.5" />
                {isPending ? "Submitting..." : "Create container"}
              </Button>
              <Button type="reset" variant="secondary">
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <EnvSuggestionsCard controller={envController} />

        <Card className="h-fit">
          <CardHeader className="border-b border-white/5">
            <CardTitle>Template source</CardTitle>
            <CardDescription>
              The selected LXC image and launch defaults that will be used by the
              real create action.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <p className="text-[11px] font-medium text-zinc-500">VOLID</p>
              <p className="mt-1 break-all text-[13px] text-zinc-200">{template.volid}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <p className="text-[11px] font-medium text-zinc-500">Node</p>
                <p className="mt-1 text-[13px] text-zinc-200">{template.node}</p>
              </div>
              <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <p className="text-[11px] font-medium text-zinc-500">Storage</p>
                <p className="mt-1 text-[13px] text-zinc-200">{template.storage}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <p className="text-[11px] font-medium text-zinc-500">Size</p>
                <p className="mt-1 text-[13px] text-zinc-200">{template.sizeLabel}</p>
              </div>
              <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <p className="text-[11px] font-medium text-zinc-500">Next suggested VMID</p>
                <p className="mt-1 text-[13px] text-zinc-200">{nextId ?? "Unavailable"}</p>
              </div>
            </div>
            {issues.length > 0 ? (
              <div className="rounded-md border border-amber-900 bg-amber-950/30 px-4 py-3 text-[12px] leading-relaxed text-amber-300">
                Some template and storage reads still fail with permission errors.
                The create form is wired, but launches will only work once the token
                also has the required storage and VM allocation privileges.
              </div>
            ) : null}
            {rootfsTargets.length === 0 ? (
              <div className="rounded-md border border-amber-900 bg-amber-950/30 px-4 py-3 text-[12px] leading-relaxed text-amber-300">
                No rootfs-capable storage pools are visible to this token, so container creation is likely to fail until one is available.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
