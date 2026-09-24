"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Save, RotateCcw } from "lucide-react";

import { createVmTemplateAction } from "@/app/vm-template-actions";
import { useTaskToasts } from "@/components/task-toast-provider";
import { NodeSelector } from "@/components/node-selector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import type { IsoImage, LiveNode, LiveNodeMetrics, LiveStoragePool } from "@/lib/proxmox";
import { useSiteBasePath } from "@/lib/use-site-path";

const inputClassName =
  "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

export function VmTemplateCreateForm({
  defaultNode,
  diskTargets,
  isoImages,
  nodeMetrics,
  nodes,
}: {
  defaultNode: string;
  diskTargets: LiveStoragePool[];
  isoImages: IsoImage[];
  nodeMetrics: LiveNodeMetrics[];
  nodes: LiveNode[];
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(
    createVmTemplateAction,
    initialBasicActionState,
  );

  const { pushToast } = useTaskToasts();
  const router = useRouter();
  const handledRef = useRef("");

  useEffect(() => {
    if (!state.requestId || state.requestId === handledRef.current) return;
    handledRef.current = state.requestId;

    if (state.status === "error") {
      pushToast({ title: "Template creation failed", message: state.message, variant: "error" });
    }
    if (state.status === "success") {
      pushToast({ title: "Template created", message: state.message, variant: "success" });
      router.push("/templates");
    }
  }, [state, pushToast, router]);

  return (
    <Card>
      <CardHeader className="border-b border-white/5">
        <CardTitle>VM template configuration</CardTitle>
        <CardDescription>
          Define a reusable QEMU/KVM configuration. You can launch VMs from this template later.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5">
        <Form action={formAction} className="space-y-6">
          <input name="siteSlug" type="hidden" value={siteSlug} />
          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.15em] text-zinc-500 mb-3">Template</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">Template name</span>
                <input className={inputClassName} name="name" placeholder="Ubuntu Server 24.04" required type="text" />
              </label>
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">Hostname prefix</span>
                <input className={inputClassName} name="hostnamePrefix" placeholder="ubuntu-srv" type="text" />
              </label>
            </div>
            <label className="mt-3 block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Description</span>
              <textarea className={`${inputClassName} min-h-16 resize-y`} name="description" placeholder="Optional description..." />
            </label>
          </div>

          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.15em] text-zinc-500 mb-3">Source</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">Default node</span>
                <NodeSelector
                  className={inputClassName}
                  defaultNode={defaultNode}
                  metrics={nodeMetrics}
                  name="node"
                  nodes={nodes}
                />
              </label>
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">ISO image</span>
                <select className={inputClassName} name="isoVolid">
                  <option value="">No ISO</option>
                  {isoImages.map((iso) => (
                    <option key={iso.volid} value={iso.volid}>
                      {iso.fileName} ({iso.sizeLabel})
                    </option>
                  ))}
                </select>
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
                  <option value="kvm64">kvm64</option>
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
                <span className="text-[13px] font-medium text-zinc-200">Disk storage</span>
                <select className={inputClassName} name="diskStorage">
                  {diskTargets.map((target) => (
                    <option key={`${target.node}::${target.storage}`} value={target.storage}>
                      {target.shared ? `${target.storage} (${target.type})` : `${target.storage} on ${target.node}`}
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
            <p className="text-[12px] font-medium uppercase tracking-[0.15em] text-zinc-500 mb-3">Network &amp; Advanced</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">Bridge</span>
                <input className={inputClassName} defaultValue="vmbr0" name="bridge" type="text" />
              </label>
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">OS Type</span>
                <select className={inputClassName} defaultValue="l26" name="osType">
                  <option value="l26">Linux 2.6 - 6.x</option>
                  <option value="win11">Windows 11/2022</option>
                  <option value="win10">Windows 10/2016/2019</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">Machine</span>
                <select className={inputClassName} defaultValue="q35" name="machineType">
                  <option value="q35">q35</option>
                  <option value="i440fx">i440fx</option>
                </select>
              </label>
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">SCSI HW</span>
                <select className={inputClassName} defaultValue="virtio-scsi-single" name="scsihw">
                  <option value="virtio-scsi-single">VirtIO SCSI Single</option>
                  <option value="virtio-scsi-pci">VirtIO SCSI</option>
                  <option value="lsi">LSI 53C895A</option>
                </select>
              </label>
            </div>
          </div>

          <input name="isoFileName" type="hidden" value="" />
          <input name="isoStorage" type="hidden" value="" />
          <input name="vgaType" type="hidden" value="std" />

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-300 sm:col-span-3">
              <input defaultChecked name="accessReady" type="checkbox" />
              Managed SSH access ready
            </label>
            <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-300 sm:col-span-3">
              <input defaultChecked name="cloudInitCapable" type="checkbox" />
              Cloud-init capable installer or image
            </label>
            <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[13px] text-zinc-300">
              <input defaultChecked name="enableQemuAgent" type="checkbox" />
              QEMU Guest Agent
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
            SSH-ready VM templates are Linux-only and assume the guest can consume cloud-init user-data. Tainer
            will attach a managed access profile instead of exposing VNC in-app.
          </p>

          <div className="flex gap-2 border-t border-white/5 pt-4">
            <Button disabled={isPending} type="submit" variant="secondary">
              <Save className="h-3.5 w-3.5" />
              {isPending ? "Saving..." : "Save VM template"}
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
