"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Cpu,
  FileText,
  Info,
  MemoryStick,
  MonitorCog,
  RefreshCcw,
  Save,
  Settings2,
  Sliders,
  Tag,
} from "lucide-react";

import { updateDeploymentConfigAction } from "@/app/proxmox-actions";
import { useActionTaskFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { initialActionState } from "@/lib/action-states";
import type { LiveDeploymentDetail } from "@/lib/proxmox";
import { stripTainerMeta } from "@/lib/tainer-meta";
import { useSiteBasePath } from "@/lib/use-site-path";
import { cn } from "@/lib/utils";

type TabKey = "general" | "resources" | "advanced";

const baseInputClass = cn(
  "w-full min-w-0 rounded-md border border-white/10 bg-zinc-950/60 px-3 py-2 font-mono text-[13.5px] tabular-nums text-zinc-100 outline-none transition-colors",
  "placeholder:text-zinc-700",
  "focus:border-zinc-400 focus:bg-zinc-900",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

type FieldShellProps = {
  children: ReactNode;
  currentLabel?: string;
  hint?: string;
  icon?: ReactNode;
  label: string;
};

function FieldShell({ children, currentLabel, hint, icon, label }: FieldShellProps) {
  return (
    <div className="group rounded-xl border border-white/5 bg-black/40 p-3.5 transition-colors focus-within:border-white/15 focus-within:bg-black/60">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-zinc-400">
          {icon && <span className="text-zinc-500">{icon}</span>}
          <span className="text-[11px] font-medium uppercase tracking-[0.14em]">{label}</span>
        </div>
        {currentLabel && (
          <span className="rounded-md border border-white/5 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-zinc-400">
            {currentLabel}
          </span>
        )}
      </div>
      {children}
      {hint && <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">{hint}</p>}
    </div>
  );
}

type NumberFieldProps = {
  currentLabel: string;
  disabled?: boolean;
  hint?: string;
  icon: ReactNode;
  label: string;
  max?: number;
  min?: number;
  name: string;
  onChange: (value: string) => void;
  placeholder: string;
  suffix: string;
  value: string;
};

function NumberField({
  currentLabel,
  disabled,
  hint,
  icon,
  label,
  max,
  min,
  name,
  onChange,
  placeholder,
  suffix,
  value,
}: NumberFieldProps) {
  return (
    <FieldShell currentLabel={currentLabel} hint={hint} icon={icon} label={label}>
      <div className="flex items-baseline gap-2">
        <input
          className={baseInputClass}
          disabled={disabled}
          inputMode="numeric"
          max={max}
          min={min}
          name={name}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          step={1}
          type="number"
          value={value}
        />
        <span className="text-[12px] font-medium text-zinc-500">{suffix}</span>
      </div>
    </FieldShell>
  );
}

type TextFieldProps = {
  currentLabel?: string;
  disabled?: boolean;
  hint?: string;
  icon: ReactNode;
  label: string;
  name: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
};

function TextField({
  currentLabel,
  disabled,
  hint,
  icon,
  label,
  name,
  onChange,
  placeholder,
  value,
}: TextFieldProps) {
  return (
    <FieldShell currentLabel={currentLabel} hint={hint} icon={icon} label={label}>
      <input
        className={cn(baseInputClass, "font-sans text-[14px]")}
        disabled={disabled}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
    </FieldShell>
  );
}

type SelectFieldProps = {
  currentLabel?: string;
  disabled?: boolean;
  hint?: string;
  icon: ReactNode;
  label: string;
  name: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  value: string;
};

function SelectField({
  currentLabel,
  disabled,
  hint,
  icon,
  label,
  name,
  onChange,
  options,
  value,
}: SelectFieldProps) {
  return (
    <FieldShell currentLabel={currentLabel} hint={hint} icon={icon} label={label}>
      <select
        className={cn(baseInputClass, "appearance-none font-sans text-[14px]")}
        disabled={disabled}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

type TextareaFieldProps = {
  disabled?: boolean;
  hint?: string;
  icon: ReactNode;
  label: string;
  name: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  value: string;
};

function TextareaField({
  disabled,
  hint,
  icon,
  label,
  name,
  onChange,
  placeholder,
  rows = 4,
  value,
}: TextareaFieldProps) {
  return (
    <FieldShell hint={hint} icon={icon} label={label}>
      <textarea
        className={cn(baseInputClass, "resize-y font-sans text-[13.5px] leading-relaxed")}
        disabled={disabled}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        value={value}
      />
    </FieldShell>
  );
}

const SCSIHW_OPTIONS: { label: string; value: string }[] = [
  { label: "Default (keep)", value: "" },
  { label: "VirtIO SCSI single", value: "virtio-scsi-single" },
  { label: "VirtIO SCSI PCI", value: "virtio-scsi-pci" },
  { label: "LSI 53C895A", value: "lsi" },
  { label: "LSI 53C810", value: "lsi53c810" },
  { label: "MegaRAID SAS 8708EM2", value: "megasas" },
  { label: "VMware PVSCSI", value: "pvscsi" },
];

export function DeploymentEditButton({
  deployment,
  className,
}: {
  deployment: LiveDeploymentDetail;
  className?: string;
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const isVm = deployment.type === "qemu";
  const isRunning = deployment.rawStatus === "running";
  const guestLabel = isVm ? "VM" : "container";
  const guestShortLabel = isVm ? "VM" : "CT";

  const initial = useMemo(() => {
    const userDescription = stripTainerMeta(deployment.description ?? "");
    return {
      hostname: deployment.name || "",
      description: userDescription,
      cores: deployment.coresConfigured != null ? String(deployment.coresConfigured) : "",
      memoryMb: deployment.memoryConfiguredMb != null ? String(deployment.memoryConfiguredMb) : "",
      swapMb: deployment.swapConfiguredMb != null ? String(deployment.swapConfiguredMb) : "",
      sockets: deployment.vmSockets != null ? String(deployment.vmSockets) : "",
      cpuType: deployment.vmCpuType ?? "",
      machine: deployment.vmMachineType ?? "",
      scsihw: deployment.vmScsiHw ?? "",
      vga: deployment.vmVga ?? "",
    };
  }, [
    deployment.coresConfigured,
    deployment.description,
    deployment.memoryConfiguredMb,
    deployment.name,
    deployment.swapConfiguredMb,
    deployment.vmCpuType,
    deployment.vmMachineType,
    deployment.vmScsiHw,
    deployment.vmSockets,
    deployment.vmVga,
  ]);

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>("general");

  const [hostname, setHostname] = useState(initial.hostname);
  const [description, setDescription] = useState(initial.description);
  const [cores, setCores] = useState(initial.cores);
  const [memoryMb, setMemoryMb] = useState(initial.memoryMb);
  const [swapMb, setSwapMb] = useState(initial.swapMb);
  const [sockets, setSockets] = useState(initial.sockets);
  const [cpuType, setCpuType] = useState(initial.cpuType);
  const [machine, setMachine] = useState(initial.machine);
  const [scsihw, setScsihw] = useState("");
  const [vga, setVga] = useState(initial.vga);

  const resetToInitial = () => {
    setHostname(initial.hostname);
    setDescription(initial.description);
    setCores(initial.cores);
    setMemoryMb(initial.memoryMb);
    setSwapMb(initial.swapMb);
    setSockets(initial.sockets);
    setCpuType(initial.cpuType);
    setMachine(initial.machine);
    setScsihw("");
    setVga(initial.vga);
    setTab("general");
  };

  useEffect(() => {
    if (open) {
      resetToInitial();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const [state, formAction, isPending] = useActionState(
    updateDeploymentConfigAction,
    initialActionState,
  );
  useActionTaskFeedback(state, {
    errorTitle: "Update failed",
    successTitle: "Update queued",
  });

  const lastHandledRequest = useRef<string | null>(null);
  useEffect(() => {
    if (!state.requestId || state.requestId === lastHandledRequest.current) return;
    if (state.status === "success") {
      lastHandledRequest.current = state.requestId;
      setOpen(false);
    } else if (state.status === "error") {
      lastHandledRequest.current = state.requestId;
    }
  }, [state.requestId, state.status]);

  const disabled = !deployment.configAccessible;

  const dirty =
    hostname !== initial.hostname ||
    description !== initial.description ||
    cores !== initial.cores ||
    memoryMb !== initial.memoryMb ||
    (isVm
      ? sockets !== initial.sockets ||
        cpuType !== initial.cpuType ||
        machine !== initial.machine ||
        scsihw !== "" ||
        vga !== initial.vga
      : swapMb !== initial.swapMb);

  const formatCurrent = (value: string, suffix = "") => (value ? `${value}${suffix}` : "unset");

  const tabs: { key: TabKey; label: string; icon: ReactNode }[] = [
    { key: "general", label: "General", icon: <Tag className="h-3.5 w-3.5" /> },
    { key: "resources", label: "CPU & Memory", icon: <Sliders className="h-3.5 w-3.5" /> },
  ];
  if (isVm) {
    tabs.push({ key: "advanced", label: "Hardware", icon: <MonitorCog className="h-3.5 w-3.5" /> });
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <button
          aria-label="Edit deployment"
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/5 bg-white/[0.03] text-zinc-400 transition-all duration-200",
            "hover:border-white/15 hover:bg-white/10 hover:text-zinc-100 hover:shadow-[0_0_0_3px_rgba(255,255,255,0.03)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
            "active:scale-95",
            className,
          )}
          title="Edit deployment"
          type="button"
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </DialogTrigger>

      <DialogContent
        className="max-w-xl gap-0 overflow-hidden border border-white/10 bg-[#0c0c0e] p-0 ring-0 sm:max-w-xl"
      >
        <Form action={formAction}>
          <input name="siteSlug" type="hidden" value={siteSlug} />
          <input name="deploymentId" type="hidden" value={deployment.id} />
          <input name="digest" type="hidden" value={deployment.digest} />

          {/* Header */}
          <DialogHeader className="gap-1 border-b border-white/5 bg-gradient-to-b from-white/[0.03] to-transparent px-6 pt-6 pb-5">
            <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 shadow-inner">
              <Settings2 className="h-4 w-4" />
            </div>
            <DialogTitle className="text-[15px] font-semibold text-zinc-100">
              Edit {guestLabel}
            </DialogTitle>
            <DialogDescription className="text-[12.5px] leading-relaxed text-zinc-500">
              {guestShortLabel} {deployment.vmid} &middot; {deployment.name} &middot;{" "}
              {deployment.cpu} &middot; {deployment.memory}
            </DialogDescription>
          </DialogHeader>

          {/* Tabs */}
          <div className="flex items-center gap-1 border-b border-white/5 bg-black/30 px-4 pt-3">
            {tabs.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  className={cn(
                    "relative inline-flex items-center gap-1.5 rounded-t-md px-3 py-2 text-[12px] font-medium transition-colors",
                    active
                      ? "text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300",
                  )}
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  type="button"
                >
                  {t.icon}
                  {t.label}
                  {active && (
                    <span className="absolute right-0 bottom-0 left-0 h-[2px] rounded-t-full bg-zinc-100" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Body */}
          <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 py-5">
            {tab === "general" && (
              <div className="space-y-3">
                <TextField
                  currentLabel={initial.hostname || "unset"}
                  disabled={disabled}
                  hint={
                    isVm
                      ? "Display name for the VM. Allowed: letters, digits, dot, dash, underscore."
                      : "Hostname visible to the guest and inside the cluster. Must be a valid DNS label."
                  }
                  icon={<Tag className="h-3.5 w-3.5" />}
                  label={isVm ? "VM name" : "Hostname"}
                  name="hostname"
                  onChange={setHostname}
                  placeholder={initial.hostname || "my-service"}
                  value={hostname}
                />
                <TextareaField
                  disabled={disabled}
                  hint="Free-form notes. Tainer keeps its own metadata block below your text automatically."
                  icon={<FileText className="h-3.5 w-3.5" />}
                  label="Description"
                  name="description"
                  onChange={setDescription}
                  placeholder="Notes about this deployment…"
                  rows={5}
                  value={description}
                />
              </div>
            )}

            {tab === "resources" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField
                  currentLabel={formatCurrent(initial.cores)}
                  disabled={disabled}
                  hint={isVm ? "Cores per socket." : "CPU cores available to the container."}
                  icon={<Cpu className="h-3.5 w-3.5" />}
                  label="CPU cores"
                  max={256}
                  min={1}
                  name="cores"
                  onChange={setCores}
                  placeholder={initial.cores || "2"}
                  suffix="cores"
                  value={cores}
                />
                <NumberField
                  currentLabel={formatCurrent(initial.memoryMb, " MB")}
                  disabled={disabled}
                  hint="Memory in megabytes. 1024 MB = 1 GB."
                  icon={<MemoryStick className="h-3.5 w-3.5" />}
                  label="Memory"
                  max={1_048_576}
                  min={16}
                  name="memoryMb"
                  onChange={setMemoryMb}
                  placeholder={initial.memoryMb || "2048"}
                  suffix="MB"
                  value={memoryMb}
                />
                {isVm ? (
                  <NumberField
                    currentLabel={formatCurrent(initial.sockets || "1")}
                    disabled={disabled}
                    hint="Total vCPUs = sockets × cores."
                    icon={<Cpu className="h-3.5 w-3.5" />}
                    label="CPU sockets"
                    max={16}
                    min={1}
                    name="sockets"
                    onChange={setSockets}
                    placeholder={initial.sockets || "1"}
                    suffix="sockets"
                    value={sockets}
                  />
                ) : (
                  <NumberField
                    currentLabel={formatCurrent(initial.swapMb || "0", " MB")}
                    disabled={disabled}
                    hint="Swap space available to the container."
                    icon={<MemoryStick className="h-3.5 w-3.5" />}
                    label="Swap"
                    max={1_048_576}
                    min={0}
                    name="swapMb"
                    onChange={setSwapMb}
                    placeholder={initial.swapMb || "0"}
                    suffix="MB"
                    value={swapMb}
                  />
                )}
              </div>
            )}

            {tab === "advanced" && isVm && (
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  currentLabel={initial.cpuType || "default"}
                  disabled={disabled}
                  hint="QEMU CPU model, e.g. host, kvm64, x86-64-v3."
                  icon={<Cpu className="h-3.5 w-3.5" />}
                  label="CPU type"
                  name="cpuType"
                  onChange={setCpuType}
                  placeholder="host"
                  value={cpuType}
                />
                <TextField
                  currentLabel={initial.machine || "default"}
                  disabled={disabled}
                  hint="Machine type, e.g. q35, pc-i440fx."
                  icon={<MonitorCog className="h-3.5 w-3.5" />}
                  label="Machine"
                  name="machine"
                  onChange={setMachine}
                  placeholder="q35"
                  value={machine}
                />
                <SelectField
                  currentLabel={initial.scsihw || "default"}
                  disabled={disabled}
                  hint="Disk controller used by the guest."
                  icon={<Sliders className="h-3.5 w-3.5" />}
                  label="SCSI hardware"
                  name="scsihw"
                  onChange={setScsihw}
                  options={SCSIHW_OPTIONS}
                  value={scsihw}
                />
                <TextField
                  currentLabel={initial.vga || "default"}
                  disabled={disabled}
                  hint="VGA adapter, e.g. std, virtio, qxl, serial0."
                  icon={<MonitorCog className="h-3.5 w-3.5" />}
                  label="VGA"
                  name="vga"
                  onChange={setVga}
                  placeholder="std"
                  value={vga}
                />
              </div>
            )}

            {isRunning && tab !== "general" && (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-400/15 bg-amber-400/[0.04] px-3 py-2.5">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300/80" />
                <p className="text-[11.5px] leading-relaxed text-amber-100/70">
                  {isVm
                    ? "The VM is running. CPU/memory changes apply via hotplug if the guest supports it; hardware changes take effect after a reboot."
                    : "The container is running. CPU limits apply live; memory and swap changes require a reboot."}
                </p>
              </div>
            )}

            {disabled && (
              <p className="rounded-lg border border-white/5 bg-black/30 px-3 py-2.5 text-[11.5px] leading-relaxed text-zinc-500">
                This {guestLabel}&apos;s config isn&apos;t readable with the current token, so editing is disabled.
              </p>
            )}
          </div>

          {/* Footer */}
          <DialogFooter className="border-white/5 bg-black/30 px-6 py-4">
            <Button
              className="gap-1.5 bg-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              disabled={!dirty || isPending}
              onClick={(event) => {
                event.preventDefault();
                resetToInitial();
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
            <div className="flex-1" />
            <DialogClose asChild>
              <Button size="sm" type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button
              className="gap-1.5 bg-white text-zinc-900 shadow-[0_1px_0_0_rgba(255,255,255,0.25)_inset] hover:bg-zinc-100"
              disabled={disabled || !dirty || isPending}
              size="sm"
              type="submit"
            >
              <Save className="h-3.5 w-3.5" />
              {isPending ? "Applying…" : "Apply changes"}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// Back-compat alias so older imports still work.
export const DeploymentResourceEditButton = DeploymentEditButton;
