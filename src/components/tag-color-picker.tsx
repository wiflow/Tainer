"use client";

import { useState } from "react";

import { TAG_COLOR_OPTIONS } from "@/lib/tag-utils";
import { cn } from "@/lib/utils";

export function TagColorPicker({
  defaultValue = "zinc",
  name = "color",
}: {
  defaultValue?: string;
  name?: string;
}) {
  const [selected, setSelected] = useState(defaultValue);

  return (
    <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
      <span className="text-[13px] font-medium text-zinc-200">Color</span>
      <input name={name} type="hidden" value={selected} />
      <div className="mt-2 flex flex-wrap gap-2.5">
        {TAG_COLOR_OPTIONS.map((color) => (
          <button
            key={color.value}
            type="button"
            onClick={() => setSelected(color.value)}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-all",
              selected === color.value
                ? `border-zinc-600 bg-zinc-800 text-zinc-100 ring-2 ring-offset-1 ring-offset-zinc-950 ${color.ring}`
                : "border-white/5 bg-[#111113] text-zinc-400 hover:border-white/10 hover:text-zinc-300",
            )}
          >
            <span className={cn("h-3 w-3 rounded-full", color.swatch)} />
            {color.label}
          </button>
        ))}
      </div>
    </div>
  );
}
