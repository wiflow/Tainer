"use client";

import { useRef, useState } from "react";
import { FileUp, Loader2, ShieldCheck, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

const textareaClassName =
  "mt-1.5 w-full rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 text-[11px] font-mono text-zinc-100 outline-none transition-all duration-200 placeholder:text-zinc-600 focus:border-white/[0.15] focus:bg-white/[0.04] focus:shadow-[0_0_0_3px_rgba(255,255,255,0.03)] min-h-[80px]";

async function readCertFiles(files: FileList): Promise<string> {
  const pems: string[] = [];

  for (const file of Array.from(files)) {
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(buffer);

    if (text.includes("-----BEGIN CERTIFICATE-----")) {
      pems.push(text.trim());
    } else {
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      const b64 = btoa(binary);
      const lines: string[] = [];
      for (let i = 0; i < b64.length; i += 64) {
        lines.push(b64.slice(i, i + 64));
      }
      pems.push(
        `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`,
      );
    }
  }

  return pems.join("\n");
}

type Props = {
  id: string;
  name: string;
  defaultValue?: string;
  apiUrl?: string;
};

export function CaCertField({ id, name, defaultValue, apiUrl }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [certCount, setCertCount] = useState(() => {
    if (!defaultValue) return 0;
    return (defaultValue.match(/-----BEGIN CERTIFICATE-----/g) || []).length;
  });

  function updateCertCount(value: string) {
    setCertCount((value.match(/-----BEGIN CERTIFICATE-----/g) || []).length);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const newPem = await readCertFiles(files);
      const ta = textareaRef.current;
      if (ta) {
        const current = ta.value.trim();
        ta.value = current ? `${current}\n${newPem}` : newPem;
        updateCertCount(ta.value);
      }
    } catch {
      setFetchError("Failed to read certificate file(s).");
    }

    // Clearing the value lets the same file fire onChange again.
    e.target.value = "";
  }

  async function handleAutoDetect() {
    if (!apiUrl) return;

    setIsFetching(true);
    setFetchError(null);

    try {
      const res = await fetch(
        `/api/sites/detect-certs?url=${encodeURIComponent(apiUrl)}`,
      );
      const data = (await res.json()) as {
        ok: boolean;
        pems?: string[];
        error?: string;
        chain?: { subject: string; issuer: string }[];
      };

      if (!data.ok) {
        setFetchError(data.error || "Could not detect certificates.");
        return;
      }

      if (data.pems && data.pems.length > 0) {
        const ta = textareaRef.current;
        if (ta) {
          const current = ta.value.trim();
          const newPem = data.pems.join("\n");
          ta.value = current ? `${current}\n${newPem}` : newPem;
          updateCertCount(ta.value);
        }
      } else {
        setFetchError("No additional certificates found on the server.");
      }
    } catch {
      setFetchError("Failed to auto-detect certificates.");
    } finally {
      setIsFetching(false);
    }
  }

  function handleClear() {
    const ta = textareaRef.current;
    if (ta) {
      ta.value = "";
      setCertCount(0);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-zinc-500">
          CA certificates (PEM) for internal/corporate CAs
        </span>
        {certCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-emerald-400">
            <ShieldCheck className="h-3 w-3" />
            {certCount} cert{certCount !== 1 ? "s" : ""} loaded
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          className="gap-1.5"
          onClick={() => fileInputRef.current?.click()}
          size="sm"
          type="button"
          variant="secondary"
        >
          <FileUp className="h-3.5 w-3.5" />
          Upload .pem / .crt / .cer
        </Button>

        {apiUrl && (
          <Button
            className="gap-1.5"
            disabled={isFetching}
            onClick={handleAutoDetect}
            size="sm"
            type="button"
            variant="secondary"
          >
            {isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            {isFetching ? "Detecting..." : "Auto-detect from server"}
          </Button>
        )}

        {certCount > 0 && (
          <Button
            className="gap-1.5"
            onClick={handleClear}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>

      <input
        accept=".pem,.crt,.cer,.ca-bundle"
        className="hidden"
        multiple
        onChange={handleFileUpload}
        ref={fileInputRef}
        type="file"
      />

      <textarea
        className={textareaClassName}
        id={`${id}-ca-pem`}
        name={name}
        onChange={(e) => updateCertCount(e.target.value)}
        placeholder="Upload certificate files above, or paste PEM content here"
        ref={textareaRef}
        defaultValue={defaultValue ?? ""}
        rows={4}
      />

      {fetchError && (
        <p className="text-[11px] text-amber-400">{fetchError}</p>
      )}
    </div>
  );
}
