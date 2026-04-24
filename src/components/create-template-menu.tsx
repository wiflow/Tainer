"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Box, ChevronDown, Monitor, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSiteBasePath } from "@/lib/use-site-path";
import { cn } from "@/lib/utils";

export function CreateTemplateMenu() {
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
        className="h-8 gap-1.5"
        onClick={() => setOpen((v) => !v)}
        size="sm"
        type="button"
        variant="secondary"
      >
        <Plus className="h-3.5 w-3.5" />
        Create template
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 rounded-xl border border-white/5 bg-zinc-950 p-1.5 shadow-2xl shadow-black/40">
          <Link
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-300 transition-colors hover:bg-zinc-800/60"
            href={`${siteBase}/templates/create`}
            onClick={() => setOpen(false)}
          >
            <Box className="h-4 w-4 text-zinc-500" />
            <div>
              <p className="font-medium">CT template</p>
              <p className="text-[11px] text-zinc-600">From a base container image</p>
            </div>
          </Link>
          <Link
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-300 transition-colors hover:bg-zinc-800/60"
            href={`${siteBase}/templates/create-vm`}
            onClick={() => setOpen(false)}
          >
            <Monitor className="h-4 w-4 text-zinc-500" />
            <div>
              <p className="font-medium">VM template</p>
              <p className="text-[11px] text-zinc-600">QEMU/KVM virtual machine config</p>
            </div>
          </Link>
        </div>
      )}
    </div>
  );
}
