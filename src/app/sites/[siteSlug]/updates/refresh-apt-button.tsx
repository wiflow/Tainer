"use client";

import { useActionState, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpCircle, ExternalLink, RefreshCcw } from "lucide-react";

import { refreshAptIndexAction } from "@/app/update-actions";
import { useActionTaskFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { initialActionState } from "@/lib/action-states";

function extractSiteSlug(pathname: string): string {
  const match = pathname.match(/^\/sites\/([^/]+)/);
  return match?.[1] ?? "";
}

export function RefreshAptButton({ node }: { node: string }) {
  const pathname = usePathname();
  const siteSlug = extractSiteSlug(pathname);

  const [state, action, isPending] = useActionState(refreshAptIndexAction, initialActionState);
  useActionTaskFeedback(state, {
    errorTitle: "Refresh failed",
    successTitle: "Package index refreshed",
  });

  return (
    <Form action={action}>
      <input name="siteSlug" type="hidden" value={siteSlug} />
      <input name="node" type="hidden" value={node} />
      <Button disabled={isPending} size="sm" type="submit" variant="secondary">
        <RefreshCcw className="h-3.5 w-3.5" />
        {isPending ? "Refreshing..." : "Refresh index"}
      </Button>
    </Form>
  );
}

export function UpgradeNodeButton({
  node,
  proxmoxBaseUrl,
}: {
  node: string;
  proxmoxBaseUrl: string;
}) {
  const shellUrl = `${proxmoxBaseUrl}/#v1:0:=node%2F${encodeURIComponent(node)}:4:::::`;

  return (
    <Button
      asChild
      size="sm"
      variant="accent"
    >
      <a href={shellUrl} rel="noopener noreferrer" target="_blank">
        <ArrowUpCircle className="h-3.5 w-3.5" />
        Upgrade system
        <ExternalLink className="h-3 w-3 opacity-50" />
      </a>
    </Button>
  );
}

export function CheckForUpdatesButton() {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();

  function handleClick() {
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <Button
      disabled={isRefreshing}
      onClick={handleClick}
      variant="secondary"
    >
      <RefreshCcw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
      {isRefreshing ? "Checking..." : "Check for updates"}
    </Button>
  );
}
