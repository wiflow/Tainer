"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Box, ChevronDown, Layers3, Monitor, Plus, Server } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSiteBasePath } from "@/lib/use-site-path";
import { cn } from "@/lib/utils";

export function CreateDeploymentMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const siteBase = useSiteBasePath();

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button
        className="h-9 gap-1.5"
        onClick={() => setOpen((v) => !v)}
        type="button"
        variant="secondary"
      >
        <Plus className="h-3.5 w-3.5" />
        Create
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-white/5 bg-zinc-950 p-1.5 shadow-2xl shadow-black/40">
          <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
            LXC Container
          </p>
          <Link
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-300 transition-colors hover:bg-zinc-800/60"
            href={`${siteBase}/deployments/create-container`}
            onClick={() => setOpen(false)}
          >
            <Server className="h-4 w-4 text-zinc-500" />
            <div>
              <p className="font-medium">Create container</p>
              <p className="text-[11px] text-zinc-600">Pick a base CT image and launch it</p>
            </div>
          </Link>
          <Link
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-300 transition-colors hover:bg-zinc-800/60"
            href={`${siteBase}/templates`}
            onClick={() => setOpen(false)}
          >
            <Layers3 className="h-4 w-4 text-zinc-500" />
            <div>
              <p className="font-medium">From CT template</p>
              <p className="text-[11px] text-zinc-600">Use a saved deployment template</p>
            </div>
          </Link>
          <Link
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-300 transition-colors hover:bg-zinc-800/60"
            href={`${siteBase}/templates/create`}
            onClick={() => setOpen(false)}
          >
            <Box className="h-4 w-4 text-zinc-500" />
            <div>
              <p className="font-medium">New CT template</p>
              <p className="text-[11px] text-zinc-600">Create a reusable container config</p>
            </div>
          </Link>

          <div className="my-1.5 border-t border-white/5/60" />

          <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
            Virtual Machine
          </p>
          <Link
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-300 transition-colors hover:bg-zinc-800/60"
            href={`${siteBase}/deployments/create-vm-from-template`}
            onClick={() => setOpen(false)}
          >
            <Layers3 className="h-4 w-4 text-zinc-500" />
            <div>
              <p className="font-medium">Create VM from template</p>
              <p className="text-[11px] text-zinc-600">Launch from a saved VM blueprint</p>
            </div>
          </Link>
          <Link
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-300 transition-colors hover:bg-zinc-800/60"
            href={`${siteBase}/deployments/create-vm`}
            onClick={() => setOpen(false)}
          >
            <Monitor className="h-4 w-4 text-zinc-500" />
            <div>
              <p className="font-medium">Create VM</p>
              <p className="text-[11px] text-zinc-600">Launch a QEMU/KVM virtual machine</p>
            </div>
          </Link>
          <Link
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-300 transition-colors hover:bg-zinc-800/60"
            href={`${siteBase}/templates/create-vm`}
            onClick={() => setOpen(false)}
          >
            <Box className="h-4 w-4 text-zinc-500" />
            <div>
              <p className="font-medium">New VM template</p>
              <p className="text-[11px] text-zinc-600">Save a reusable VM configuration</p>
            </div>
          </Link>
        </div>
      )}
    </div>
  );
}
