"use client";

import { useActionState, useState } from "react";
import { Play, RotateCcw } from "lucide-react";

import { createLxcAction } from "@/app/proxmox-actions";
import { EnvVarsField, type EnvSuggestionGroup } from "@/components/env-vars-field";
import { LxcNetworkFields } from "@/components/lxc-network-fields";
import { LocalSshKeyFields } from "@/components/local-ssh-key-fields";
import { useActionTaskFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NodeSelector } from "@/components/node-selector";
import { initialActionState } from "@/lib/action-states";
import type { DeploymentTemplate } from "@/lib/deployment-templates";
import type { LiveNode, LiveNodeMetrics, RootfsTarget } from "@/lib/proxmox";
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

function mergeEnvText(existing: string, incoming: string): string {
  const map = new Map<string, string>();
  for (const text of [existing, incoming]) {
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const sep = trimmed.indexOf("=");
      if (sep > 0) {
        map.set(trimmed.slice(0, sep).trim(), trimmed.slice(sep + 1));
      }
    }
  }
  return Array.from(map)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

export function DeploymentTemplateLaunchPanel({
  imageEnv,
  ipPools,
  nextId,
  nodeMetrics,
  nodes,
  suggestedNode,
  rootfsTargets,
  template,
}: {
  imageEnv: string;
  ipPools: LxcIpPoolOption[];
  nextId: string | null;
  nodeMetrics: LiveNodeMetrics[];
  nodes: LiveNode[];
  suggestedNode?: string | null;
  rootfsTargets: RootfsTarget[];
  template: DeploymentTemplate;
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
  const defaultHostname =
    template.hostnamePrefix && nextId
      ? `${template.hostnamePrefix}-${nextId}`
      : template.hostnamePrefix || template.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const defaultEnv = imageEnv
    ? mergeEnvText(imageEnv, template.envText)
    : template.envText;
  const [networkMode, setNetworkMode] = useState<"dhcp" | "static">("dhcp");
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

  return (
    <Card>
      <CardHeader className="border-b border-white/5">
        <CardTitle>Deploy from template</CardTitle>
        <CardDescription>
          Launch a container from this saved deployment template with its standardized defaults already applied.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5">
        <form
          action={formAction}
          className="space-y-6"
          onReset={() => setNetworkMode("dhcp")}
        >
          <input name="siteSlug" type="hidden" value={siteSlug} />
          <input name="ostemplate" type="hidden" value={template.sourceVolid} />
          <input name="deploymentTemplateId" type="hidden" value={template.id} />
          <input name="deploymentTemplateName" type="hidden" value={template.name} />
          <input name="deploymentTemplateVersion" type="hidden" value={template.updatedAt} />
          <input name="deploymentTemplateAccessReady" type="hidden" value={template.accessReady ? "1" : ""} />
          <input name="deploymentTemplateManagedLoginUser" type="hidden" value={template.managedLoginUser} />
          <input
            name="deploymentTemplateAuthorityFingerprint"
            type="hidden"
            value={template.sshAuthorityFingerprint ?? ""}
          />

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
              <input className={inputClassName} defaultValue={nextId ?? ""} name="vmid" type="number" />
            </label>
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3 sm:col-span-2 xl:col-span-1">
              <span className="text-[13px] font-medium text-zinc-200">Hostname</span>
              <input className={inputClassName} defaultValue={defaultHostname} name="hostname" type="text" />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Rootfs storage</span>
              <select className={inputClassName} defaultValue={template.rootfsStorage} name="rootfsStorage">
                {rootfsTargets.map((target) => (
                  <option key={`${target.node}::${target.storage}`} value={target.storage}>
                    {target.shared
                      ? `${target.storage} (${target.type})`
                      : `${target.storage} on ${target.node}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Rootfs size (GB)</span>
              <input className={inputClassName} defaultValue={template.rootfsSize} name="rootfsSize" type="number" />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Memory (MB)</span>
              <input className={inputClassName} defaultValue={template.memory} name="memory" type="number" />
            </label>
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Cores</span>
              <input className={inputClassName} defaultValue={template.cores} name="cores" type="number" />
            </label>
          </div>

          <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <span className="text-[13px] font-medium text-zinc-200">Root password</span>
            <input className={inputClassName} name="password" type="password" />
          </label>

          <LxcNetworkFields
            defaultBridge={template.bridge || "vmbr0"}
            inputClassName={inputClassName}
            ipPools={ipPools}
            mode={networkMode}
            onModeChange={setNetworkMode}
          />

          <EnvVarsField
            helperText={
              imageEnv
                ? "Includes imported image defaults merged with template env. Edit, remove, or add variables before create."
                : "No cached image defaults were found for this image yet. Add any variables you need before create."
            }
            initialText={defaultEnv}
            label="Environment variables"
            name="envText"
            placeholder="value"
            suggestionGroups={envSuggestionGroups}
          />

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-300">
              <input defaultChecked={template.unprivileged} name="unprivileged" type="checkbox" />
              Unprivileged
            </label>
            <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-300">
              <input defaultChecked={template.onboot} name="onboot" type="checkbox" />
              Start on boot
            </label>
            <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-300 sm:col-span-2 xl:col-span-1">
              <input defaultChecked={template.startAfterCreate} name="start" type="checkbox" />
              Start after create
            </label>
          </div>

          <LocalSshKeyFields
            defaultLoginUser="root"
            helpText="Proxmox can inject a public key into the container at create time. Generate one here if you want a downloadable private key for local SSH."
            includeLoginUser={false}
            title="Optional local SSH key"
          />

          <div className="flex gap-2 border-t border-white/5 pt-4">
            <Button disabled={isPending || rootfsTargets.length === 0} type="submit" variant="secondary">
              <Play className="h-3.5 w-3.5" />
              {isPending ? "Submitting..." : "Create container"}
            </Button>
            <Button type="reset" variant="ghost">
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
