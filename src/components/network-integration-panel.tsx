"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertTriangle, KeyRound, Trash2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CopyableText } from "@/components/copyable-text";
import { Input } from "@/components/ui/input";
import {
  clearLldpSnapshotsAction,
  issueLldpTokenAction,
  revokeLldpTokenAction,
} from "@/app/network-actions";
import {
  initialLldpIssueTokenActionState,
} from "@/app/network-action-states";
import { initialBasicActionState } from "@/lib/action-states";
import type { LldpToken } from "@/lib/lldp-types";

type Props = {
  siteSlug: string;
  tokens: LldpToken[];
  agentHosts: string[];
  ingestUrl: string;
  canManage: boolean;
};

export function NetworkIntegrationPanel({
  siteSlug,
  tokens,
  agentHosts,
  ingestUrl,
  canManage,
}: Props) {
  const [issueState, issueAction, issuePending] = useActionState(
    issueLldpTokenAction,
    initialLldpIssueTokenActionState,
  );

  // Hold the just-issued plaintext locally until the operator dismisses it.
  // The server action's success state would otherwise vanish on the next
  // revalidation.
  const [lastIssued, setLastIssued] = useState<{ plaintext: string; label: string } | null>(null);
  useEffect(() => {
    if (issueState.status === "success" && issueState.plaintext) {
      setLastIssued({ plaintext: issueState.plaintext, label: issueState.label });
    }
  }, [issueState]);

  return (
    <div className="flex flex-col gap-6">
      {lastIssued ? (
        <NewTokenPanel
          ingestUrl={ingestUrl}
          plaintext={lastIssued.plaintext}
          label={lastIssued.label}
          onDismiss={() => setLastIssued(null)}
        />
      ) : null}

      <section className="rounded-xl border border-white/[0.06] bg-zinc-950/40">
        <header className="border-b border-white/[0.04] px-4 py-3">
          <h3 className="text-[13px] font-medium text-zinc-100">Agent tokens</h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            One token per Proxmox node. Each is shown only once at issuance — copy it
            immediately. Tokens are scoped to this site and authenticate pushes to{" "}
            <code className="font-mono text-zinc-400">{ingestUrl}</code>.
          </p>
        </header>

        <div className="divide-y divide-white/[0.04]">
          {tokens.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12px] text-zinc-500">
              No tokens issued yet.
            </div>
          ) : (
            tokens.map((t) => (
              <TokenRow
                key={t.id}
                token={t}
                siteSlug={siteSlug}
                agentSeen={agentHosts.includes(t.label)}
                canManage={canManage}
              />
            ))
          )}
        </div>

        {canManage ? (
          <form
            action={issueAction}
            className="flex flex-wrap items-end gap-2 border-t border-white/[0.04] px-4 py-3"
          >
            <input name="siteSlug" type="hidden" value={siteSlug} />
            <div className="flex-1 min-w-[200px]">
              <label
                className="mb-1 block text-[10.5px] uppercase tracking-[0.14em] text-zinc-500"
                htmlFor="lldp-token-label"
              >
                Token label
              </label>
              <Input
                id="lldp-token-label"
                name="label"
                placeholder="e.g. pve-01"
                required
                className="h-9 bg-white/[0.03] text-zinc-100"
              />
            </div>
            <Button disabled={issuePending} type="submit" variant="accent" size="sm">
              <KeyRound className="mr-1.5 h-3.5 w-3.5" />
              {issuePending ? "Issuing…" : "Issue token"}
            </Button>
          </form>
        ) : (
          <div className="border-t border-white/[0.04] px-4 py-3 text-[11px] text-zinc-500">
            You need <code className="font-mono">manage-security</code> on this site to issue tokens.
          </div>
        )}

        {issueState.status === "error" ? (
          <div className="border-t border-white/[0.04] bg-rose-500/[0.05] px-4 py-2 text-[11.5px] text-rose-300">
            {issueState.message}
          </div>
        ) : null}
      </section>

      {canManage ? <DangerZone siteSlug={siteSlug} /> : null}
    </div>
  );
}

function TokenRow({
  token,
  siteSlug,
  agentSeen,
  canManage,
}: {
  token: LldpToken;
  siteSlug: string;
  agentSeen: boolean;
  canManage: boolean;
}) {
  const [revokeState, revokeAction, revokePending] = useActionState(
    revokeLldpTokenAction,
    initialBasicActionState,
  );
  const isRevoked = Boolean(token.revokedAt);

  return (
    <div className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-[12px]">
      <div className="col-span-3 min-w-0">
        <div className="flex items-center gap-2">
          <span
            aria-label={isRevoked ? "revoked" : agentSeen ? "active" : "issued, never used"}
            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
              isRevoked
                ? "bg-zinc-600"
                : agentSeen
                  ? "bg-emerald-500"
                  : "bg-amber-500"
            }`}
          />
          <span className="truncate font-medium text-zinc-100">{token.label}</span>
        </div>
        <div className="ml-3.5 text-[10.5px] text-zinc-500">
          {isRevoked
            ? `revoked ${formatAge(Date.now() - Date.parse(token.revokedAt!))}`
            : agentSeen
              ? "agent active"
              : "awaiting first push"}
        </div>
      </div>
      <div className="col-span-3 text-zinc-400">
        <div className="text-[10.5px] uppercase tracking-wide text-zinc-500">Created</div>
        <div>{formatAge(Date.now() - Date.parse(token.createdAt))} by {token.createdBy}</div>
      </div>
      <div className="col-span-3 text-zinc-400">
        <div className="text-[10.5px] uppercase tracking-wide text-zinc-500">Last push</div>
        <div>
          {token.lastUsedAt ? (
            <>
              {formatAge(Date.now() - Date.parse(token.lastUsedAt))}
              {token.lastUsedIp ? (
                <span className="ml-1 font-mono text-[10.5px] text-zinc-500">
                  ({token.lastUsedIp})
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-zinc-600">—</span>
          )}
        </div>
      </div>
      <div className="col-span-3 flex justify-end">
        {!isRevoked && canManage ? (
          <form action={revokeAction}>
            <input name="siteSlug" type="hidden" value={siteSlug} />
            <input name="tokenId" type="hidden" value={token.id} />
            <Button
              disabled={revokePending}
              size="sm"
              type="submit"
              variant="ghost"
              title="Revoke this token immediately"
            >
              <XCircle className="mr-1.5 h-3.5 w-3.5" />
              {revokePending ? "Revoking…" : "Revoke"}
            </Button>
          </form>
        ) : null}
      </div>
      {revokeState.status === "error" ? (
        <div className="col-span-12 -mb-1 text-[11px] text-rose-400">{revokeState.message}</div>
      ) : null}
    </div>
  );
}

function NewTokenPanel({
  plaintext,
  label,
  ingestUrl,
  onDismiss,
}: {
  plaintext: string;
  label: string;
  ingestUrl: string;
  onDismiss: () => void;
}) {
  const snippet = buildSetupSnippet({ plaintext, ingestUrl });
  return (
    <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04]">
      <header className="flex items-start justify-between border-b border-emerald-500/15 px-4 py-3">
        <div>
          <h3 className="text-[13px] font-medium text-emerald-200">
            Token issued for &ldquo;{label}&rdquo;
          </h3>
          <p className="mt-0.5 text-[11px] text-emerald-300/70">
            Copy this snippet and run it as root on the Proxmox node. The token is
            shown once — closing this panel does not reveal it again.
          </p>
        </div>
        <button
          aria-label="Dismiss"
          className="ml-3 text-emerald-300/60 hover:text-emerald-200"
          onClick={onDismiss}
          type="button"
        >
          <XCircle className="h-4 w-4" />
        </button>
      </header>
      <div className="space-y-3 px-4 py-3">
        <div>
          <div className="mb-1 text-[10.5px] uppercase tracking-[0.14em] text-emerald-300/70">
            Bearer token
          </div>
          <div className="rounded-md bg-black/40 px-3 py-2">
            <CopyableText
              text={plaintext}
              className="break-all text-[11.5px] text-emerald-100"
            />
          </div>
        </div>
        <div>
          <div className="mb-1 text-[10.5px] uppercase tracking-[0.14em] text-emerald-300/70">
            Setup snippet
          </div>
          <div className="rounded-md bg-black/40">
            <pre className="overflow-x-auto px-3 py-2 text-[11px] leading-relaxed text-emerald-100 font-mono">
              {snippet}
            </pre>
            <div className="border-t border-emerald-500/15 px-3 py-1.5">
              <CopyableText
                text="Copy snippet"
                copyText={snippet}
                className="text-[10.5px] text-emerald-200/70"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DangerZone({ siteSlug }: { siteSlug: string }) {
  const [state, action, pending] = useActionState(
    clearLldpSnapshotsAction,
    initialBasicActionState,
  );

  return (
    <section className="rounded-xl border border-rose-500/15 bg-rose-500/[0.03]">
      <div className="flex items-start gap-3 px-4 py-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
        <div className="flex-1">
          <h3 className="text-[13px] font-medium text-rose-200">Clear discovered devices</h3>
          <p className="mt-0.5 text-[11px] text-rose-300/70">
            Removes every cached neighbour snapshot for this site. Active agents will
            repopulate on their next push. Tokens are unaffected. Use this when nodes
            move racks or are decommissioned and stale entries linger.
          </p>
          {state.status === "success" ? (
            <p className="mt-2 text-[11px] text-emerald-300">{state.message}</p>
          ) : null}
          {state.status === "error" ? (
            <p className="mt-2 text-[11px] text-rose-300">{state.message}</p>
          ) : null}
        </div>
        <form action={action}>
          <input name="siteSlug" type="hidden" value={siteSlug} />
          <Button disabled={pending} size="sm" type="submit" variant="ghost">
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            {pending ? "Clearing…" : "Clear"}
          </Button>
        </form>
      </div>
    </section>
  );
}

function buildSetupSnippet({
  plaintext,
  ingestUrl,
}: {
  plaintext: string;
  ingestUrl: string;
}): string {
  return `#!/bin/sh
# Run as root on a Proxmox node.

apt-get install -y lldpd curl

cat > /etc/tainer-lldp.env <<EOF
TAINER_LLDP_TOKEN=${plaintext}
TAINER_LLDP_INGEST=${ingestUrl}
EOF
chmod 600 /etc/tainer-lldp.env

cat > /etc/systemd/system/tainer-lldp.service <<'EOF'
[Unit]
Description=Tainer LLDP push agent
After=lldpd.service network-online.target
Requires=lldpd.service
[Service]
Type=oneshot
EnvironmentFile=/etc/tainer-lldp.env
ExecStart=/bin/sh -c '/usr/sbin/lldpcli show neighbors -f json0 | curl -fsS -H "Authorization: Bearer $TAINER_LLDP_TOKEN" -H "Content-Type: application/json" -H "X-Lldp-Agent: $(hostname)" --data-binary @- "$TAINER_LLDP_INGEST"'
EOF

cat > /etc/systemd/system/tainer-lldp.timer <<'EOF'
[Unit]
Description=Tainer LLDP push every 60s
[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now tainer-lldp.timer`;
}

function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}
