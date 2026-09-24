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

const inputClassName =
  "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

export function VmCreateWizard({
  defaultNode,
  diskTargets,
  isoImages,
  nextId,
  nodeMetrics,
  nodes,
  suggestedNode,
}: {
  defaultNode: string;
  diskTargets: LiveStoragePool[];
  isoImages: IsoImage[];
  nextId: string | null;
  nodeMetrics: LiveNodeMetrics[];
  nodes: LiveNode[];
  suggestedNode?: string | null;
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

  return (
    <Card>
      <CardHeader className="border-b border-white/5">
        <CardTitle>Create virtual machine</CardTitle>
        <CardDescription>
          Configure and launch a new QEMU/KVM virtual machine on your Proxmox cluster.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5">
        <Form action={formAction} className="space-y-6">
          <input name="siteSlug" type="hidden" value={siteSlug} />
          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.15em] text-zinc-500 mb-3">Identity</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">Node</span>
                <NodeSelector
                  className={inputClassName}
                  defaultNode={defaultNode}
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
                <input className={inputClassName} name="name" placeholder="my-vm" type="text" />
              </label>
            </div>
          </div>

          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.15em] text-zinc-500 mb-3">Hardware</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">CPU Type</span>
                <select className={inputClassName} defaultValue="x86-64-v2-AES" name="cpuType">
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
                <input className={inputClassName} defaultValue="2" name="cores" type="number" min="1" />
              </label>
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">Sockets</span>
                <input className={inputClassName} defaultValue="1" name="sockets" type="number" min="1" />
              </label>
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">Memory (MB)</span>
                <input className={inputClassName} defaultValue="2048" name="memory" type="number" min="128" step="128" />
              </label>
            </div>
          </div>

          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.15em] text-zinc-500 mb-3">Storage</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">Disk storage pool</span>
                <select className={inputClassName} name="diskStorage">
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
                <input className={inputClassName} defaultValue="32" name="diskSize" type="number" min="1" />
              </label>
            </div>
          </div>

          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.15em] text-zinc-500 mb-3">Boot</p>
            <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">ISO image</span>
              <select className={inputClassName} name="isoVolid">
                <option value="">No ISO (PXE / manual)</option>
                {isoImages.map((iso) => (
                  <option key={iso.volid} value={iso.volid}>
                    {iso.fileName} ({iso.sizeLabel}) — {iso.storage}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11px] text-zinc-600">
                Select an ISO image from Proxmox storage to boot from.
              </p>
            </label>
          </div>

          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.15em] text-zinc-500 mb-3">Network</p>
            <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Bridge</span>
              <input className={inputClassName} defaultValue="vmbr0" name="bridge" type="text" />
            </label>
          </div>

          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.15em] text-zinc-500 mb-3">Advanced</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">OS Type</span>
                <select className={inputClassName} defaultValue="l26" name="osType">
                  <option value="l26">Linux 2.6 - 6.x</option>
                  <option value="l24">Linux 2.4</option>
                  <option value="win11">Windows 11/2022</option>
                  <option value="win10">Windows 10/2016/2019</option>
                  <option value="win8">Windows 8/2012</option>
                  <option value="win7">Windows 7/2008r2</option>
                  <option value="wxp">Windows XP/2003</option>
                  <option value="solaris">Solaris</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">Machine Type</span>
                <select className={inputClassName} defaultValue="q35" name="machineType">
                  <option value="q35">q35</option>
                  <option value="i440fx">i440fx</option>
                </select>
              </label>
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">SCSI Controller</span>
                <select className={inputClassName} defaultValue="virtio-scsi-single" name="scsihw">
                  <option value="virtio-scsi-single">VirtIO SCSI Single</option>
                  <option value="virtio-scsi-pci">VirtIO SCSI</option>
                  <option value="lsi">LSI 53C895A</option>
                  <option value="lsi53c810">LSI 53C810</option>
                  <option value="megasas">MegaRAID SAS</option>
                  <option value="pvscsi">VMware PVSCSI</option>
                </select>
              </label>
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">VGA</span>
                <select className={inputClassName} defaultValue="std" name="vgaType">
                  <option value="std">Standard VGA</option>
                  <option value="virtio">VirtIO-GPU</option>
                  <option value="virtio-gl">VirtIO-GPU (GL)</option>
                  <option value="qxl">QXL</option>
                  <option value="vmware">VMware</option>
                  <option value="cirrus">Cirrus</option>
                  <option value="serial0">Serial terminal</option>
                  <option value="none">None</option>
                </select>
              </label>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-300">
              <input defaultChecked name="enableQemuAgent" type="checkbox" />
              QEMU Guest Agent
            </label>
            <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-300">
              <input name="onboot" type="checkbox" />
              Start on boot
            </label>
            <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-300">
              <input defaultChecked name="start" type="checkbox" />
              Start after create
            </label>
          </div>

          <LocalSshKeyFields
            defaultLoginUser="ubuntu"
            disabled
            disabledMessage="VM local SSH provisioning is disabled until Tainer can verify that the selected image really consumes the injected key. Use the native Proxmox console first, then configure SSH inside the guest."
            title="Optional local SSH key"
          />

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
