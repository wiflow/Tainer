"use client";

import { useCallback, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

function copyToClipboard(text: string): Promise<void> {
  // navigator.clipboard requires HTTPS or localhost
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback for plain HTTP
  return new Promise((resolve, reject) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      resolve();
    } catch {
      reject(new Error("Copy failed"));
    } finally {
      document.body.removeChild(textarea);
    }
  });
}

export function CopyableText({
  className,
  copyText,
  text,
}: {
  className?: string;
  copyText?: string;
  text: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const resolvedCopyText = copyText ?? text;

  const doCopy = useCallback(() => {
    copyToClipboard(resolvedCopyText).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    });
  }, [resolvedCopyText]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      doCopy();
    },
    [doCopy],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        doCopy();
      }
    },
    [doCopy],
  );

  return (
    <span
      className={cn(
        "group/copy inline-flex cursor-pointer items-center gap-1.5 font-mono transition-colors hover:text-zinc-100",
        className,
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      title="Click to copy"
    >
      {text}
      {copied ? (
        <Check className="h-3 w-3 shrink-0 text-emerald-400" />
      ) : (
        <Copy className="h-3 w-3 shrink-0 text-zinc-600 transition-opacity group-hover/copy:text-zinc-400" />
      )}
    </span>
  );
}
