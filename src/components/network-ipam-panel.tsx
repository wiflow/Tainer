"use client";

import { useState } from "react";

import { IpamForm } from "@/app/integrations/ipam-form";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/integrations-section";
import { SectionPanel } from "@/components/ui/section-panel";
import type { PhpIpamIntegrationPublic } from "@/lib/integrations";

export function NetworkIpamPanel({
  canManage,
  ipam,
}: {
  canManage: boolean;
  ipam: PhpIpamIntegrationPublic | null;
}) {
  const [editing, setEditing] = useState(false);
  const configured = Boolean(ipam?.enabled && ipam?.hasToken);

  return (
    <SectionPanel
      description="Tainer reads subnet reservations from phpIPAM when sizing IP pools so static deployments don't collide with addresses already in use elsewhere."
      headerRight={<StatusBadge status={configured ? "configured" : "available"} />}
      title="phpIPAM"
    >
      {editing && canManage ? (
        <IpamForm
          initial={ipam}
          onCancel={() => setEditing(false)}
          onDeleted={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[12.5px] text-zinc-400">
            {ipam ? (
              <>
                <span className="font-mono text-zinc-200">{ipam.serverUrl}</span>
                {ipam.enabled ? null : <span className="ml-2 text-zinc-500">(disabled)</span>}
              </>
            ) : (
              "Not connected."
            )}
          </div>
          {canManage ? (
            <Button onClick={() => setEditing(true)} type="button" variant="secondary">
              {ipam ? "Edit connection" : "Connect phpIPAM"}
            </Button>
          ) : (
            <p className="text-[12px] text-zinc-500">Ask an admin to change this integration.</p>
          )}
        </div>
      )}
    </SectionPanel>
  );
}
