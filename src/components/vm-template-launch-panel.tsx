"use client";

import { useActionState } from "react";
import { Play, RotateCcw } from "lucide-react";

import { createVmAction } from "@/app/vm-actions";
import { LocalSshKeyFields } from "@/components/local-ssh-key-fields";
import { useActionTaskFeedback } from "@/components/task-toast-provider";
import { NodeSelector } from "@/components/node-selector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialActionState } from "@/lib/action-states";
import type { IsoImage, LiveNode, LiveNodeMetrics, LiveStoragePool } from "@/lib/proxmox";
import { useSiteBasePath } from "@/lib/use-site-path";
import type { VmTemplate } from "@/lib/vm-templates";

const inputClassName =
  "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

export function VmTemplateLaunchPanel({
  diskTargets,
  isoImages,
  nextId,
  nodeMetrics,
  nodes,
  suggestedNode,
  template,
}: {
  diskTargets: LiveStoragePool[];
  isoImages: IsoImage[];
  nextId: string | null;
  nodeMetrics: LiveNodeMetrics[];
  nodes: LiveNode[];
  suggestedNode?: string | null;
  template: VmTemplate;
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(
    createVmAction,
    initialActionState,
  );
  useActionTaskFeedback(state, {
    autoNavigateOnTaskSuccess: true,
    errorTitle: "VM creation failed",
    successTitle: "VM creation queued",
  });

  const defaultName =
    template.hostnamePrefix && nextId
      ? `${template.hostnamePrefix}-${nextId}`
      : template.hostnamePrefix || template.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return (
    <Card>
      <CardHeader className="border-b border-white/5">
        <CardTitle>Deploy from VM template</CardTitle>
        <CardDescription>
          Launch a virtual machine from this saved template with its standardized defaults already applied.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5">
        <Form action={formAction} className="space-y-6">
          <input name="siteSlug" type="hidden" value={siteSlug} />
          <div className="grid gap-3 sm:grid-cols-3">
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
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">VM Name</span>
              <input className={inputClassName} defaultValue={defaultName} name="name" type="text" />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">CPU Type</span>
              <select className={inputClassName} defaultValue={template.cpuType} name="cpuType">
                <option value="host">host</option>
                <option value="x86-64-v2-AES">x86-64-v2-AES</option>
                <option value="x86-64-v2">x86-64-v2</option>
                <option value="x86-64-v3">x86-64-v3</option>
                <option value="x86-64-v4">x86-64-v4</option>
                <option value="kvm64">kvm64</option>
                <option value="qemu64">qemu64</option>
              </select>
            </label>
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Cores</span>
              <input className={inputClassName} defaultValue={template.cores} name="cores" type="number" min="1" />
            </label>
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Sockets</span>
              <input className={inputClassName} defaultValue={template.sockets} name="sockets" type="number" min="1" />
            </label>
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Memory (MB)</span>
              <input className={inputClassName} defaultValue={template.memory} name="memory" type="number" min="128" step="128" />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Disk storage</span>
              <select className={inputClassName} defaultValue={template.diskStorage} name="diskStorage">
                {diskTargets.map((target) => (
                  <option key={`${target.node}::${target.storage}`} value={target.storage}>
                    {target.shared
                      ? `${target.storage} (${target.type})`
                      : `${target.storage} on ${target.node}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Disk size (GB)</span>
              <input className={inputClassName} defaultValue={template.diskSize} name="diskSize" type="number" min="1" />
            </label>
          </div>

          <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <span className="text-[13px] font-medium text-zinc-200">ISO image</span>
            <select className={inputClassName} defaultValue={template.isoVolid} name="isoVolid">
              <option value="">No ISO (PXE / manual)</option>
              {isoImages.map((iso) => (
                <option key={iso.volid} value={iso.volid}>
                  {iso.fileName} ({iso.sizeLabel}) — {iso.storage}
                </option>
              ))}
            </select>
          </label>

          <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <span className="text-[13px] font-medium text-zinc-200">Bridge</span>
            <input className={inputClassName} defaultValue={template.bridge} name="bridge" type="text" />
          </label>

          {/* Hidden advanced fields from template */}
          <input name="vmTemplateId" type="hidden" value={template.id} />
          <input name="osType" type="hidden" value={template.osType} />
          <input name="machineType" type="hidden" value={template.machineType} />
          <input name="scsihw" type="hidden" value={template.scsihw} />
          <input name="vgaType" type="hidden" value={template.vgaType} />

          <LocalSshKeyFields
            defaultLoginUser={template.managedLoginUser || "tainer"}
            disabled
            disabledMessage="VM local SSH provisioning is disabled until Tainer can verify that the selected image really consumes the injected key. Use the native Proxmox console first, then configure SSH inside the guest."
            loginUserLabel="Cloud-init SSH login user"
            title="Optional local SSH key"
          />

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-300">
              <input defaultChecked={template.enableQemuAgent} name="enableQemuAgent" type="checkbox" />
              QEMU Guest Agent
            </label>
            <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-300">
              <input defaultChecked={template.onboot} name="onboot" type="checkbox" />
              Start on boot
            </label>
            <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-300">
              <input defaultChecked={template.startAfterCreate} name="start" type="checkbox" />
              Start after create
            </label>
          </div>

          <div className="flex gap-2 border-t border-white/5 pt-4">
            <Button disabled={isPending || diskTargets.length === 0} type="submit" variant="secondary">
              <Play className="h-3.5 w-3.5" />
              {isPending ? "Submitting..." : "Create VM"}
            </Button>
            <Button type="reset" variant="ghost">
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          </div>
        </Form>
      </CardContent>
    </Card>
  );
}
