"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertTriangle, Globe, KeyRound, Radio, Trash2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CopyableText } from "@/components/copyable-text";
import { Input } from "@/components/ui/input";
import {
  clearLldpSnapshotsAction,
  issueLldpTokenAction,
  revokeLldpTokenAction,
  saveAgentEndpointAction,
  saveSnmpConfigAction,
} from "@/app/network-actions";
import {
  initialLldpIssueTokenActionState,
} from "@/app/network-action-states";
import { initialBasicActionState } from "@/lib/action-states";
import type { LldpToken } from "@/lib/lldp-types";
import type { SnmpSitePublicConfig } from "@/lib/lldp-snmp-config";

type Props = {
  siteSlug: string;
  tokens: LldpToken[];
  agentHosts: string[];
  ingestUrl: string;
  snmpIngestUrl: string;
  snmpConfig: SnmpSitePublicConfig;
  canManage: boolean;
};

export function NetworkIntegrationPanel({
  siteSlug,
  tokens,
  agentHosts,
  ingestUrl,
  snmpIngestUrl,
  snmpConfig,
  canManage,
}: Props) {
  const [issueState, issueAction, issuePending] = useActionState(
    issueLldpTokenAction,
    initialLldpIssueTokenActionState,
  );

  const [lastIssued, setLastIssued] = useState<{
    plaintext: string;
    label: string;
    snmpCommunity: string;
  } | null>(null);
  useEffect(() => {
    if (issueState.status === "success" && issueState.plaintext) {
      setLastIssued({
        plaintext: issueState.plaintext,
        label: issueState.label,
        snmpCommunity: issueState.snmpCommunity,
      });
    }
  }, [issueState]);

  const effectiveBase = ingestUrl.replace(/\/api\/internal\/lldp-ingest$/, "");

  return (
    <div className="flex flex-col gap-6">
      {lastIssued ? (
        <NewTokenPanel
          ingestUrl={ingestUrl}
          snmpIngestUrl={snmpIngestUrl}
          snmpConfig={snmpConfig}
          snmpCommunity={lastIssued.snmpCommunity}
          plaintext={lastIssued.plaintext}
          label={lastIssued.label}
          onDismiss={() => setLastIssued(null)}
        />
      ) : null}

      {canManage ? (
        <AgentEndpointSection
          siteSlug={siteSlug}
          effectiveBase={effectiveBase}
          override={snmpConfig.agentBaseUrl}
        />
      ) : null}

      {canManage ? (
        <SnmpConfigSection siteSlug={siteSlug} config={snmpConfig} />
      ) : null}

      <section className="rounded-xl border border-white/[0.06] bg-zinc-950/40">
        <header className="border-b border-white/[0.04] px-4 py-3">
          <h3 className="text-[13px] font-medium text-zinc-100">Agent tokens</h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            One token per Proxmox node. Each is shown only once at issuance. Copy it
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
  snmpIngestUrl,
  snmpConfig,
  snmpCommunity,
  onDismiss,
}: {
  plaintext: string;
  label: string;
  ingestUrl: string;
  snmpIngestUrl: string;
  snmpConfig: SnmpSitePublicConfig;
  snmpCommunity: string;
  onDismiss: () => void;
}) {
  const snippet = buildSetupSnippet({
    plaintext,
    ingestUrl,
    snmpIngestUrl,
    snmpCommunity,
    snmpEnabled: snmpConfig.hasCommunity,
    snmpPollSeconds: snmpConfig.pollIntervalSeconds,
  });
  return (
    <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04]">
      <header className="flex items-start justify-between border-b border-emerald-500/15 px-4 py-3">
        <div>
          <h3 className="text-[13px] font-medium text-emerald-200">
            Token issued for &ldquo;{label}&rdquo;
          </h3>
          <p className="mt-0.5 text-[11px] text-emerald-300/70">
            Copy this snippet and run it as root on the Proxmox node. The token is
            shown once. Closing this panel does not reveal it again.
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
  snmpIngestUrl,
  snmpCommunity,
  snmpEnabled,
  snmpPollSeconds,
}: {
  plaintext: string;
  ingestUrl: string;
  snmpIngestUrl: string;
  snmpCommunity: string;
  snmpEnabled: boolean;
  snmpPollSeconds: number;
}): string {
  const pollSeconds = Math.max(60, Math.min(3600, Math.floor(snmpPollSeconds || 300)));
  const snmpCommentBlock = snmpEnabled
    ? `# SNMP polling is enabled for this site. The agent polls each LLDP-discovered
# neighbour's MgmtIP via SNMPv2c every ${pollSeconds}s and posts the IF-MIB
# inventory to Tainer. The community string is set in /etc/tainer-snmp.env
# below. Keep that file 0600.`
    : `# SNMP polling is NOT YET ENABLED for this site. The agent ships disabled.
# Once an admin sets the SNMP community in the Tainer integrations panel,
# edit /etc/tainer-snmp.env on each node (or rerun this snippet) and the
# poller will start populating the full port inventory.`;

  return `#!/bin/sh
# Run as root on a Proxmox node.
#
# Note: curl runs with -k (skip TLS verification) because Tainer uses a
# self-signed Caddy cert by default. The agent still authenticates itself
# with the per-node bearer token below. TLS verification here would only
# matter if you've installed a public CA cert on Tainer. If you have,
# drop the -k from the ExecStart lines.
#
${snmpCommentBlock}
set -eu

apt-get install -y lldpd curl jq snmp

# --- LLDP push agent ---------------------------------------------------------

cat > /etc/tainer-lldp.env <<EOF
TAINER_LLDP_TOKEN=${plaintext}
TAINER_LLDP_INGEST=${ingestUrl}
TAINER_SNMP_INGEST=${snmpIngestUrl}
SNMP_COMMUNITY=${snmpEnabled && snmpCommunity ? snmpCommunity : ""}
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
ExecStart=/bin/sh -c '/usr/sbin/lldpcli show neighbors -f json0 | curl -fsS -k -H "Authorization: Bearer $TAINER_LLDP_TOKEN" -H "Content-Type: application/json" -H "X-Lldp-Agent: $(hostname)" --data-binary @- "$TAINER_LLDP_INGEST"'
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

# --- SNMP poll agent ---------------------------------------------------------
#
# Discovers neighbours via lldpcli, then snmpwalks each one's MgmtIP for the
# IF-MIB scalars we care about. Sends a base64-encoded walk blob per device
# to Tainer's SNMP ingest, which parses + stores it. No-ops cleanly when the
# community string is empty.

cat > /usr/local/sbin/tainer-snmp-poll.sh <<'POLL_EOF'
#!/bin/sh
# Tainer SNMP poll agent.
set -eu
. /etc/tainer-lldp.env

[ -n "\${TAINER_LLDP_TOKEN:-}" ] || exit 0
[ -n "\${TAINER_SNMP_INGEST:-}" ] || exit 0
[ -n "\${SNMP_COMMUNITY:-}" ] || exit 0

MGMT_IPS=\$(/usr/sbin/lldpcli show neighbors -f json0 2>/dev/null \\
  | jq -r '.. | objects | select(has("mgmt-ip")) | .["mgmt-ip"][]?.value // empty' \\
  | sort -u)

[ -n "\$MGMT_IPS" ] || exit 0

# We walk a focused set of IF-MIB scalars rather than the whole MIB tree.
# Each tool call shaves ~3-5x the bandwidth of a full ifTable walk and
# avoids pulling in counters we won't use.
OIDS="sysName sysDescr ifDescr ifAlias ifOperStatus ifAdminStatus ifSpeed ifHighSpeed ifType ifMtu"

snapshots=""
first=1
for ip in \$MGMT_IPS; do
  walk=""
  for oid in \$OIDS; do
    out=\$(snmpwalk -v2c -c "\$SNMP_COMMUNITY" -Oqs -t 3 -r 1 "\$ip" "\$oid" 2>/dev/null || true)
    [ -n "\$out" ] && walk="\${walk}\${out}
"
  done
  if [ -n "\$walk" ]; then
    encoded=\$(printf %s "\$walk" | base64 -w0)
    [ "\$first" -eq 0 ] && snapshots="\${snapshots},"
    snapshots="\${snapshots}{\\"mgmtIp\\":\\"\$ip\\",\\"walkBase64\\":\\"\$encoded\\"}"
    first=0
  fi
done

[ -n "\$snapshots" ] || exit 0

printf '{"agent":"%s","snapshots":[%s]}\\n' "\$(hostname)" "\$snapshots" \\
  | curl -fsS -k \\
      -H "Authorization: Bearer \$TAINER_LLDP_TOKEN" \\
      -H "Content-Type: application/json" \\
      -H "X-Lldp-Agent: \$(hostname)" \\
      --data-binary @- \\
      "\$TAINER_SNMP_INGEST"
POLL_EOF
chmod 0755 /usr/local/sbin/tainer-snmp-poll.sh

cat > /etc/systemd/system/tainer-snmp.service <<'EOF'
[Unit]
Description=Tainer SNMP poll agent (IF-MIB walk of LLDP neighbours)
After=lldpd.service network-online.target
Requires=lldpd.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/tainer-snmp-poll.sh
EOF

cat > /etc/systemd/system/tainer-snmp.timer <<EOF
[Unit]
Description=Tainer SNMP poll every ${pollSeconds}s
[Timer]
OnBootSec=45s
OnUnitActiveSec=${pollSeconds}s
[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now tainer-lldp.timer
systemctl enable --now tainer-snmp.timer`;
}

function AgentEndpointSection({
  siteSlug,
  effectiveBase,
  override,
}: {
  siteSlug: string;
  effectiveBase: string;
  override: string | null;
}) {
  const [state, action, pending] = useActionState(
    saveAgentEndpointAction,
    initialBasicActionState,
  );
  const [value, setValue] = useState("");

  const source = override
    ? "per-site override"
    : "APP_URL / TAINER_AGENT_BASE_URL";

  return (
    <section className="rounded-xl border border-white/[0.06] bg-zinc-950/40">
      <header className="border-b border-white/[0.04] px-4 py-3">
        <div className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 text-zinc-400" />
          <h3 className="text-[13px] font-medium text-zinc-100">Agent ingest URL</h3>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          The base URL Proxmox nodes POST LLDP + SNMP data to. By default Tainer
          uses its public origin (<code className="font-mono">APP_URL</code>), but
          nodes often can&apos;t resolve that (LAN box reached by IP, split DNS).
          Set an override that&apos;s reachable <em>from the nodes</em>. Tainer
          appends <code className="font-mono">/api/internal/…</code> itself.
        </p>
      </header>

      <div className="space-y-3 px-4 py-3">
        <div className="rounded-lg border border-white/[0.05] bg-black/30 px-3 py-2">
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-zinc-500">
            Currently baked into new snippets
          </div>
          <div className="mt-1 font-mono text-[12px] text-zinc-200 break-all">
            {effectiveBase}
          </div>
          <div className="mt-0.5 text-[10.5px] text-zinc-500">
            source: {source}
          </div>
        </div>

        <form action={action} className="flex flex-wrap items-end gap-2">
          <input name="siteSlug" type="hidden" value={siteSlug} />
          <div className="flex-1 min-w-[240px]">
            <label
              className="mb-1 block text-[10.5px] uppercase tracking-[0.14em] text-zinc-500"
              htmlFor="agent-base-url"
            >
              Override (scheme + host, no path)
            </label>
            <Input
              autoComplete="off"
              className="font-mono"
              id="agent-base-url"
              name="agentBaseUrl"
              placeholder={override ?? "https://192.168.100.50"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <div className="flex items-end gap-2">
            {override ? (
              <Button
                disabled={pending}
                formAction={(formData: FormData) => {
                  formData.set("clear", "1");
                  return action(formData);
                }}
                size="sm"
                type="submit"
                variant="ghost"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Clear
              </Button>
            ) : null}
            <Button disabled={pending} size="sm" type="submit" variant="primary">
              <Globe className="mr-1.5 h-3.5 w-3.5" />
              {pending ? "Saving…" : override ? "Update" : "Set override"}
            </Button>
          </div>
        </form>

        {state.status === "success" ? (
          <p className="text-[11px] text-emerald-300">{state.message}</p>
        ) : null}
        {state.status === "error" ? (
          <p className="text-[11px] text-rose-300">{state.message}</p>
        ) : null}

        <p className="text-[10.5px] text-zinc-600">
          Changing this only affects <em>newly generated</em> snippets. Existing
          nodes keep their baked-in URL until you re-issue a token or edit{" "}
          <code className="font-mono">/etc/tainer-lldp.env</code> on the node.
        </p>
      </div>
    </section>
  );
}

function SnmpConfigSection({
  siteSlug,
  config,
}: {
  siteSlug: string;
  config: SnmpSitePublicConfig;
}) {
  const [state, action, pending] = useActionState(
    saveSnmpConfigAction,
    initialBasicActionState,
  );
  const [showCommunity, setShowCommunity] = useState(false);
  const [community, setCommunity] = useState("");

  return (
    <section className="rounded-xl border border-white/[0.06] bg-zinc-950/40">
      <header className="border-b border-white/[0.04] px-4 py-3">
        <div className="flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 text-zinc-400" />
          <h3 className="text-[13px] font-medium text-zinc-100">
            SNMP polling
          </h3>
          {config.hasCommunity ? (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/[0.06] px-1.5 py-0.5 text-[10px] text-emerald-300">
              enabled
            </span>
          ) : (
            <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-zinc-400">
              disabled
            </span>
          )}
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          Each agent polls every LLDP-discovered neighbour&apos;s management IP via
          SNMPv2c on a timer, then posts the IF-MIB port inventory back to Tainer.
          That&apos;s how you get the full 48-port front panel instead of just the
          ports your Proxmox nodes plug into. The community string is stored
          encrypted (AES-256-GCM under <code className="font-mono">AUTH_SECRET</code>);
          Tainer never echoes it back to the UI.
        </p>
      </header>

      <form action={action} className="space-y-3 px-4 py-3">
        <input name="siteSlug" type="hidden" value={siteSlug} />

        <div>
          <label
            className="mb-1 block text-[10.5px] uppercase tracking-[0.14em] text-zinc-500"
            htmlFor="snmp-community"
          >
            Community string (read-only)
          </label>
          <div className="flex items-stretch gap-2">
            <Input
              autoComplete="off"
              className="font-mono"
              id="snmp-community"
              name="community"
              placeholder={
                config.hasCommunity
                  ? "•••••••• (set, type to replace)"
                  : "e.g. Tainer-RO"
              }
              type={showCommunity ? "text" : "password"}
              value={community}
              onChange={(e) => setCommunity(e.target.value)}
            />
            <Button
              onClick={() => setShowCommunity((v) => !v)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {showCommunity ? "Hide" : "Show"}
            </Button>
          </div>
          <p className="mt-1 text-[10.5px] text-zinc-500">
            Use a non-default value (not <code className="font-mono">public</code>).
            Configure your switches with{" "}
            <code className="font-mono">snmp-server community &lt;string&gt; RO</code>{" "}
            (Cisco), or the equivalent for your vendor, and use that value here.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label
              className="mb-1 block text-[10.5px] uppercase tracking-[0.14em] text-zinc-500"
              htmlFor="snmp-interval"
            >
              Poll interval (seconds)
            </label>
            <Input
              className="w-32"
              defaultValue={config.pollIntervalSeconds}
              id="snmp-interval"
              max={3600}
              min={60}
              name="pollIntervalSeconds"
              type="number"
            />
          </div>

          <div className="flex flex-1 items-end justify-end gap-2">
            {config.hasCommunity ? (
              <Button
                disabled={pending}
                formAction={(formData: FormData) => {
                  formData.set("clear", "1");
                  return action(formData);
                }}
                size="sm"
                type="submit"
                variant="ghost"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Clear
              </Button>
            ) : null}
            <Button disabled={pending} size="sm" type="submit" variant="primary">
              <KeyRound className="mr-1.5 h-3.5 w-3.5" />
              {pending ? "Saving…" : config.hasCommunity ? "Update" : "Enable"}
            </Button>
          </div>
        </div>

        {state.status === "success" ? (
          <p className="text-[11px] text-emerald-300">{state.message}</p>
        ) : null}
        {state.status === "error" ? (
          <p className="text-[11px] text-rose-300">{state.message}</p>
        ) : null}

        {config.updatedAt ? (
          <p className="text-[10.5px] text-zinc-600">
            Last updated {new Date(config.updatedAt).toLocaleString()}
            {config.updatedBy ? ` by ${config.updatedBy}` : ""}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}
