"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2, Save, Sparkles, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionPanel } from "@/components/ui/section-panel";
import { cn } from "@/lib/utils";
import type { CopilotSettings, CopilotUsageSnapshot } from "@/lib/copilot/store";

const inputClassName =
  "mt-1.5 w-full rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 text-[13px] text-zinc-200 outline-none transition-all duration-200 placeholder:text-zinc-600 focus:border-white/[0.15] focus:bg-white/[0.04] focus:shadow-[0_0_0_3px_rgba(255,255,255,0.03)]";

export function CopilotSettingsPanel() {
  const [settings, setSettings] = useState<CopilotSettings | null>(null);
  const [usage, setUsage] = useState<CopilotUsageSnapshot | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState<"fast" | "smart">("smart");
  const [tokenBudget, setTokenBudget] = useState(500_000);
  const [toolBudget, setToolBudget] = useState(200);
  const [enabled, setEnabled] = useState(true);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/copilot/settings", { cache: "no-store" });
      const json = (await res.json()) as {
        settings: CopilotSettings;
        usage: CopilotUsageSnapshot;
        isAdmin: boolean;
      };
      setSettings(json.settings);
      setUsage(json.usage);
      setIsAdmin(json.isAdmin);
      setModel(json.settings.model);
      setTokenBudget(json.settings.dailyTokenBudget);
      setToolBudget(json.settings.dailyToolCallBudget);
      setEnabled(json.settings.enabled);
    } catch {
      setFeedback({ kind: "error", text: "Failed to load copilot settings." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (extra: Partial<{ apiKey: string | null }> = {}) => {
      setSaving(true);
      setFeedback(null);
      try {
        const res = await fetch("/api/copilot/settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...extra,
            model,
            dailyTokenBudget: tokenBudget,
            dailyToolCallBudget: toolBudget,
            enabled,
          }),
        });
        const json = (await res.json()) as { settings?: CopilotSettings; error?: string };
        if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
        if (json.settings) setSettings(json.settings);
        setApiKey("");
        setFeedback({ kind: "success", text: "Saved." });
      } catch (err) {
        setFeedback({
          kind: "error",
          text: err instanceof Error ? err.message : "Save failed.",
        });
      } finally {
        setSaving(false);
      }
    },
    [model, tokenBudget, toolBudget, enabled],
  );

  const removeKey = useCallback(async () => {
    await save({ apiKey: null });
  }, [save]);

  const saveAll = useCallback(async () => {
    await save(apiKey ? { apiKey } : {});
  }, [save, apiKey]);

  if (loading || !settings || !usage) {
    return (
      <SectionPanel title="Tainy" description="Loading…">
        <div className="flex items-center gap-2 text-[13px] text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading copilot settings
        </div>
      </SectionPanel>
    );
  }

  const tokenPct = Math.min(
    100,
    Math.round(
      ((usage.inputTokens + usage.outputTokens) / Math.max(1, usage.tokenBudget)) * 100,
    ),
  );
  const toolPct = Math.min(
    100,
    Math.round((usage.toolCalls / Math.max(1, usage.toolCallBudget)) * 100),
  );

  return (
    <div className="space-y-4">
      <SectionPanel
        title="Tainy"
        description="AI assistant for diagnosing and managing your Proxmox cluster. Runs on a single site-wide DeepInfra API key — every action still runs through each user's own permissions."
        headerRight={
          isAdmin ? (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-[12px] text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-3.5 w-3.5 accent-emerald-500"
                />
                {enabled ? "Enabled" : "Disabled"}
              </label>
            </div>
          ) : (
            <span className="text-[12px] text-zinc-500">
              {settings.enabled ? "Enabled" : "Disabled"}
            </span>
          )
        }
      >
        <div className="grid gap-4">
          {/* API key */}
          <div>
            <label className="text-[12px] font-medium text-zinc-300 flex items-center gap-1.5">
              <KeyRound className="h-3 w-3" />
              DeepInfra API key (site-wide)
            </label>
            <p className="text-[11.5px] text-zinc-500 mt-0.5">
              One key for the whole site, managed by admins. Get a key at{" "}
              <a
                href="https://deepinfra.com/dash/api_keys"
                target="_blank"
                rel="noreferrer"
                className="text-zinc-300 hover:text-white underline underline-offset-2"
              >
                deepinfra.com
              </a>
              . Stored AES-256-GCM encrypted under your Tainer AUTH_SECRET.
            </p>
            {settings.hasKey ? (
              <div className="mt-2 flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="text-[12px] text-zinc-300">
                    Key on file — ending in <code className="text-zinc-100">…{settings.keyHint}</code>
                  </span>
                </div>
                {isAdmin && (
                  <button
                    className="text-[11.5px] text-zinc-400 hover:text-rose-300 transition-colors"
                    onClick={removeKey}
                    disabled={saving}
                  >
                    Remove
                  </button>
                )}
              </div>
            ) : (
              <div className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 text-[11.5px] text-amber-200">
                No key configured. Tainy is disabled until an admin adds one.
              </div>
            )}
            {isAdmin && (
              <div className="mt-2 relative">
                <input
                  className={cn(inputClassName, "pr-10")}
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={settings.hasKey ? "Paste new key to replace…" : "DeepInfra API key…"}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
                  title={showKey ? "Hide" : "Show"}
                >
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            )}
          </div>

          {/* Model */}
          <div>
            <label className="text-[12px] font-medium text-zinc-300">Model</label>
            <p className="text-[11.5px] text-zinc-500 mt-0.5">
              Fast = Gemma 4 26B A4B (MoE — cheap, great for triage). Smart = Gemma 4 31B (best
              for multi-step reasoning). Both served by DeepInfra.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <ModelTile
                active={model === "fast"}
                onClick={isAdmin ? () => setModel("fast") : undefined}
                title="Fast"
                subtitle="Gemma 4 26B A4B"
                icon={<Zap className="h-3.5 w-3.5" />}
              />
              <ModelTile
                active={model === "smart"}
                onClick={isAdmin ? () => setModel("smart") : undefined}
                title="Smart"
                subtitle="Gemma 4 31B"
                icon={<Sparkles className="h-3.5 w-3.5" />}
              />
            </div>
          </div>

          {/* Budgets */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-medium text-zinc-300">
                Daily token budget (per user)
              </label>
              <p className="text-[11.5px] text-zinc-500 mt-0.5">
                Total input + output tokens per user per day. Resets at 00:00 UTC.
              </p>
              {isAdmin ? (
                <input
                  className={inputClassName}
                  type="number"
                  min={1000}
                  step={10000}
                  value={tokenBudget}
                  onChange={(e) => setTokenBudget(parseInt(e.target.value, 10) || 0)}
                />
              ) : null}
              <UsageBar
                pct={tokenPct}
                label={`${(usage.inputTokens + usage.outputTokens).toLocaleString()} / ${usage.tokenBudget.toLocaleString()} (you, today)`}
              />
            </div>
            <div>
              <label className="text-[12px] font-medium text-zinc-300">
                Daily tool-call budget (per user)
              </label>
              <p className="text-[11.5px] text-zinc-500 mt-0.5">
                Caps how many tools the agent can run per user per day.
              </p>
              {isAdmin ? (
                <input
                  className={inputClassName}
                  type="number"
                  min={1}
                  step={10}
                  value={toolBudget}
                  onChange={(e) => setToolBudget(parseInt(e.target.value, 10) || 0)}
                />
              ) : null}
              <UsageBar pct={toolPct} label={`${usage.toolCalls} / ${usage.toolCallBudget} (you, today)`} />
            </div>
          </div>

          {feedback && (
            <div
              className={cn(
                "rounded-md px-3 py-2 text-[12px]",
                feedback.kind === "success"
                  ? "border border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-200"
                  : "border border-rose-500/20 bg-rose-500/[0.06] text-rose-200",
              )}
            >
              {feedback.text}
            </div>
          )}

          {isAdmin && (
            <div className="flex items-center justify-end gap-2">
              <Button onClick={saveAll} disabled={saving} variant="accent">
                {saving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Saving…
                  </>
                ) : (
                  <>
                    <Save className="h-3.5 w-3.5 mr-1.5" /> Save
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </SectionPanel>

      <SectionPanel
        title="Permissions & safety"
        description="The copilot uses your existing Tainer permissions. It cannot see or change anything you can't."
      >
        <ul className="space-y-1.5 text-[12px] text-zinc-400">
          <li>• Every tool call goes through the same permission and site-access checks as the UI.</li>
          <li>• Read tools (list, get, metrics) auto-run without prompting.</li>
          <li>• Write tools (start/stop/restart, resource updates) require a click to approve in the sidebar.</li>
          <li>• Destructive tools (delete) require typing the deployment name to confirm.</li>
          <li>• Every approved or denied action is recorded in the admin audit log.</li>
          <li>• The site API key is encrypted at rest with the same AES-256-GCM helpers Tainer uses for 2FA secrets.</li>
        </ul>
      </SectionPanel>
    </div>
  );
}

function ModelTile({
  active,
  onClick,
  title,
  subtitle,
  icon,
}: {
  active: boolean;
  onClick?: () => void;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      disabled={!onClick}
      className={cn(
        "rounded-xl border px-3 py-2.5 text-left transition-colors",
        active
          ? "border-white/20 bg-white/[0.06]"
          : "border-white/[0.06] bg-white/[0.02]",
        onClick && !active && "hover:bg-white/[0.04]",
        !onClick && "cursor-default",
      )}
    >
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-white">
        {icon} {title}
      </div>
      <div className="text-[11px] text-zinc-500 mt-0.5">{subtitle}</div>
    </button>
  );
}

function UsageBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="mt-1.5">
      <div className="h-1 rounded-full bg-white/[0.05] overflow-hidden">
        <div
          className={cn(
            "h-full transition-all",
            pct >= 90 ? "bg-rose-400" : pct >= 70 ? "bg-amber-400" : "bg-emerald-400",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 text-[10.5px] text-zinc-500">{label}</div>
    </div>
  );
}
