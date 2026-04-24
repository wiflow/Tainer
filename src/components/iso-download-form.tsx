"use client";

import { useActionState, useState } from "react";
import { Download } from "lucide-react";

import { downloadIsoFromUrlAction } from "@/app/iso-actions";
import { useActionTaskFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialActionState } from "@/lib/action-states";
import type { LiveNode, LiveStoragePool } from "@/lib/proxmox";
import { useSiteBasePath } from "@/lib/use-site-path";

const inputClassName =
  "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

export function IsoDownloadForm({
  isoTargets,
  nodes,
}: {
  isoTargets: LiveStoragePool[];
  nodes: LiveNode[];
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(
    downloadIsoFromUrlAction,
    initialActionState,
  );
  useActionTaskFeedback(state, {
    errorTitle: "ISO download failed",
    successTitle: "ISO download queued",
  });

  const [url, setUrl] = useState("");

  // Auto-derive filename from URL
  const derivedFilename = url ? (url.split("/").pop()?.split("?")[0] || "") : "";

  return (
    <Card className="overflow-hidden rounded-2xl">
      <CardHeader className="border-b border-white/5">
        <CardTitle className="flex items-center gap-2">
          <Download className="h-4 w-4" />
          Download ISO from URL
        </CardTitle>
        <CardDescription>
          Download an ISO image from a direct link into your Proxmox storage. Supports HTTP and HTTPS URLs.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5">
        <Form action={formAction} className="space-y-4">
          <input name="siteSlug" type="hidden" value={siteSlug} />
          <label className="block">
            <span className="text-[12px] font-medium text-zinc-400">URL</span>
            <input
              className={inputClassName}
              name="url"
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://releases.ubuntu.com/24.04/ubuntu-24.04-live-server-amd64.iso"
              required
              type="url"
              value={url}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="text-[12px] font-medium text-zinc-400">Target node</span>
              <select className={inputClassName} name="node">
                {nodes.map((n) => (
                  <option key={n.name} value={n.name}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-zinc-400">Storage</span>
              <select className={inputClassName} name="storage">
                {isoTargets.map((t) => (
                  <option key={`${t.node}::${t.storage}`} value={t.storage}>
                    {t.shared ? `${t.storage} (${t.type})` : `${t.storage} on ${t.node}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-zinc-400">Filename (optional)</span>
              <input
                className={inputClassName}
                defaultValue=""
                name="filename"
                placeholder={derivedFilename || "auto from URL"}
                type="text"
              />
              {derivedFilename && (
                <p className="mt-1 text-[11px] text-zinc-600">
                  Auto: {derivedFilename}
                </p>
              )}
            </label>
          </div>

          <Button disabled={isPending || !url || isoTargets.length === 0} type="submit" variant="secondary">
            <Download className="h-3.5 w-3.5" />
            {isPending ? "Downloading..." : "Download ISO"}
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}
