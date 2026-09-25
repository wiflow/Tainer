"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  Brain,
  Cloud,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Save,
  ServerCog,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { SectionPanel } from "@/components/ui/section-panel";
import { cn } from "@/lib/utils";
import type {
  CopilotSettings,
  CopilotUsageSnapshot,
  CopilotUserUsageSummary,
  GroupToolPolicy,
} from "@/lib/copilot/store";
import {
  ANTHROPIC_MODELS,
  type AnthropicModel,
  type CopilotProvider,
} from "@/lib/copilot/types";

type GroupInfo = { id: string; name: string; isAdmin: boolean };
type UserUsageRow = CopilotUserUsageSummary & { email: string; name: string };

function estimateUsd(
  inputTokens: number,
  outputTokens: number,
  costIn: number | null,
  costOut: number | null,
): number | null {
  if (costIn === null && costOut === null) return null;
  return (
    (inputTokens / 1_000_000) * (costIn ?? 0) + (outputTokens / 1_000_000) * (costOut ?? 0)
  );
}

function formatUsd(value: number): string {
  return value < 0.01 && value > 0 ? "<$0.01" : `$${value.toFixed(2)}`;
}

const PROVIDERS: Record<
  CopilotProvider,
  { title: string; subtitle: string; keyUrl: string | null; icon: React.ReactNode }
> = {
  deepinfra: {
    title: "DeepInfra",
    subtitle: "Open models",
    keyUrl: "https://deepinfra.com/dash/api_keys",
    icon: <Cloud className="h-3.5 w-3.5" />,
  },
  openai: {
    title: "OpenAI",
    subtitle: "Your model id",
    keyUrl: "https://platform.openai.com/api-keys",
    icon: <Bot className="h-3.5 w-3.5" />,
  },
  anthropic: {
    title: "Anthropic",
    subtitle: "Claude models",
    keyUrl: "https://console.anthropic.com/settings/keys",
    icon: <Sparkles className="h-3.5 w-3.5" />,
  },
  custom: {
    title: "Custom endpoint",
    subtitle: "Self-hosted",
    keyUrl: null,
    icon: <ServerCog className="h-3.5 w-3.5" />,
  },
};

const ANTHROPIC_MODEL_LABELS: Record<AnthropicModel, string> = {
  "claude-opus-5": "Claude Opus 5 (default)",
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-haiku-4-5": "Claude Haiku 4.5",
};

const MODEL_TIPS: Record<CopilotProvider, React.ReactNode> = {
  deepinfra:
    "Fast = Gemma 4 26B A4B (MoE, cheap, great for triage). Smart = Gemma 4 31B (best for multi-step reasoning). Kimi = Kimi K3 (Moonshot's frontier MoE, strongest at agentic tool use). All served by DeepInfra.",
  openai: "The model id to call, exactly as your OpenAI account lists it.",
  anthropic:
    "Pick a Claude model, or enter another model id to use instead. Tainy shows a summary of the model's reasoning under Thought process.",
  custom: (
    <>
      Any OpenAI-compatible server (vLLM, Ollama, LM Studio, or a corporate gateway). Use the base
      URL up to (not including) <code className="text-zinc-200">/chat/completions</code>, e.g.{" "}
      <code className="text-zinc-200">https://vllm.example.com/v1</code>. https is required; the
      API key is optional.
    </>
  ),
};

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
  const [provider, setProvider] = useState<CopilotProvider>("deepinfra");
  const [model, setModel] = useState<"fast" | "smart" | "kimi">("smart");
  const [anthropicModel, setAnthropicModel] = useState<AnthropicModel>("claude-opus-5");
  const [tokenBudget, setTokenBudget] = useState(500_000);
  const [toolBudget, setToolBudget] = useState(200);
  const [enabled, setEnabled] = useState(true);
  const [baseUrl, setBaseUrl] = useState("");
  const [customModelId, setCustomModelId] = useState("");
  const [operatorNotes, setOperatorNotes] = useState("");
  const [costIn, setCostIn] = useState("");
  const [costOut, setCostOut] = useState("");
  const [groupPolicies, setGroupPolicies] = useState<Record<string, GroupToolPolicy>>({});
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [userUsage, setUserUsage] = useState<UserUsageRow[]>([]);
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
        groups?: GroupInfo[];
        userUsage?: UserUsageRow[];
      };
      setSettings(json.settings);
      setUsage(json.usage);
      setIsAdmin(json.isAdmin);
      setProvider(json.settings.provider);
      setModel(json.settings.model);
      setAnthropicModel(json.settings.anthropicModel);
      setTokenBudget(json.settings.dailyTokenBudget);
      setToolBudget(json.settings.dailyToolCallBudget);
      setEnabled(json.settings.enabled);
      setBaseUrl(json.settings.baseUrl ?? "");
      setCustomModelId(json.settings.customModelId ?? "");
      setOperatorNotes(json.settings.operatorNotes ?? "");
      setCostIn(json.settings.costPerMInputUsd?.toString() ?? "");
      setCostOut(json.settings.costPerMOutputUsd?.toString() ?? "");
      setGroupPolicies(json.settings.groupPolicies ?? {});
      setGroups(json.groups ?? []);
      setUserUsage(json.userUsage ?? []);
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
            provider,
            model,
            anthropicModel,
            dailyTokenBudget: tokenBudget,
            dailyToolCallBudget: toolBudget,
            enabled,
            baseUrl: provider === "custom" ? baseUrl.trim() || null : null,
            customModelId: customModelId.trim() || null,
            operatorNotes,
            groupPolicies,
            costPerMInputUsd: costIn.trim() === "" ? null : Number(costIn),
            costPerMOutputUsd: costOut.trim() === "" ? null : Number(costOut),
          }),
        });
        const json = (await res.json()) as { settings?: CopilotSettings; error?: string };
        if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
        const keyCleared =
          settings?.hasKey && json.settings && !json.settings.hasKey && extra.apiKey !== null;
        if (json.settings) setSettings(json.settings);
        setApiKey("");
        setFeedback({
          kind: "success",
          text: keyCleared
            ? "Saved. The provider or endpoint changed, so enter the API key again."
            : "Saved.",
        });
      } catch (err) {
        setFeedback({
          kind: "error",
          text: err instanceof Error ? err.message : "Save failed.",
        });
      } finally {
        setSaving(false);
      }
    },
    [
      settings?.hasKey,
      provider,
      model,
      anthropicModel,
      tokenBudget,
      toolBudget,
      enabled,
      baseUrl,
      customModelId,
      operatorNotes,
      groupPolicies,
      costIn,
      costOut,
    ],
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

  const keyUrl = PROVIDERS[provider].keyUrl;
  const chooseProvider = (next: CopilotProvider) => {
    setProvider(next);
    setApiKey("");
    setCustomModelId(next === settings.provider ? (settings.customModelId ?? "") : "");
  };
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
        description="AI assistant for diagnosing and managing your Proxmox cluster. Runs on one site-wide API key from the provider you pick. Every action still runs through each user's own permissions."
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
          <div>
            <span className="flex items-center gap-1.5">
              <label className="text-[12px] font-medium text-zinc-300">Provider</label>
              <InfoTip label="Provider" side="right">
                Where Tainy sends its requests. Switching provider or endpoint removes the stored
                key, so enter the key again when you switch.
              </InfoTip>
            </span>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(PROVIDERS) as CopilotProvider[]).map((id) => (
                <ModelTile
                  key={id}
                  active={provider === id}
                  onClick={isAdmin ? () => chooseProvider(id) : undefined}
                  title={PROVIDERS[id].title}
                  subtitle={PROVIDERS[id].subtitle}
                  icon={PROVIDERS[id].icon}
                />
              ))}
            </div>
            {isAdmin && settings.hasKey && provider !== settings.provider && !apiKey.trim() && (
              <p className="text-[11px] text-amber-200/80 mt-1.5">
                Saving removes the stored key. Enter a {PROVIDERS[provider].title} key below.
              </p>
            )}
          </div>

          <div>
            <span className="flex items-center gap-1.5">
              <label className="text-[12px] font-medium text-zinc-300 flex items-center gap-1.5">
                <KeyRound className="h-3 w-3" />
                API key (site-wide)
              </label>
              <InfoTip label="API key" side="right">
                One key for the whole site, managed by admins. Stored AES-256-GCM encrypted under
                your Tainer AUTH_SECRET.
              </InfoTip>
            </span>
            <p className="text-[11.5px] text-zinc-500 mt-0.5">
              {keyUrl ? (
                <>
                  Get a key at{" "}
                  <a
                    href={keyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-zinc-300 hover:text-white underline underline-offset-2"
                  >
                    {new URL(keyUrl).hostname}
                  </a>
                  .
                </>
              ) : (
                "Optional for endpoints that don't need one."
              )}
            </p>
            {settings.hasKey ? (
              <div className="mt-2 flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="text-[12px] text-zinc-300">
                    Key on file, ending in <code className="text-zinc-100">…{settings.keyHint}</code>
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
                {settings.provider === "custom"
                  ? "No key configured. Tainy sends requests to the custom endpoint without one."
                  : "No key configured. Tainy is disabled until an admin adds one."}
              </div>
            )}
            {isAdmin && (
              <div className="mt-2 relative">
                <input
                  className={cn(inputClassName, "pr-10")}
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    settings.hasKey
                      ? "Paste new key to replace…"
                      : `${PROVIDERS[provider].title} API key…`
                  }
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

          <div>
            <span className="flex items-center gap-1.5">
              <label className="text-[12px] font-medium text-zinc-300">Model</label>
              <InfoTip label="Model" side="right">
                {MODEL_TIPS[provider]}
              </InfoTip>
            </span>
            {provider === "deepinfra" && (
              <div className="mt-2 grid grid-cols-3 gap-2">
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
                <ModelTile
                  active={model === "kimi"}
                  onClick={isAdmin ? () => setModel("kimi") : undefined}
                  title="Kimi"
                  subtitle="Kimi K3"
                  icon={<Brain className="h-3.5 w-3.5" />}
                />
              </div>
            )}
            {isAdmin && provider === "anthropic" && (
              <div className="mt-1 grid grid-cols-2 gap-2">
                <select
                  className={inputClassName}
                  value={anthropicModel}
                  onChange={(e) => setAnthropicModel(e.target.value as AnthropicModel)}
                >
                  {ANTHROPIC_MODELS.map((id) => (
                    <option key={id} value={id}>
                      {ANTHROPIC_MODEL_LABELS[id]}
                    </option>
                  ))}
                </select>
                <input
                  className={inputClassName}
                  type="text"
                  value={customModelId}
                  onChange={(e) => setCustomModelId(e.target.value)}
                  placeholder="Other model id (optional)"
                  autoComplete="off"
                />
              </div>
            )}
            {isAdmin && provider === "openai" && (
              <input
                className={inputClassName}
                type="text"
                value={customModelId}
                onChange={(e) => setCustomModelId(e.target.value)}
                placeholder="Model id from your OpenAI account"
                autoComplete="off"
              />
            )}
            {isAdmin && provider === "custom" && (
              <div className="mt-1 grid grid-cols-[2fr_1fr] gap-2">
                <input
                  className={inputClassName}
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://vllm.example.com/v1"
                  autoComplete="off"
                />
                <input
                  className={inputClassName}
                  type="text"
                  value={customModelId}
                  onChange={(e) => setCustomModelId(e.target.value)}
                  placeholder="Model id, e.g. qwen3-32b"
                  autoComplete="off"
                />
              </div>
            )}
            {!isAdmin && settings.provider !== "deepinfra" && (
              <p className="text-[11.5px] text-zinc-400 mt-1">
                Using <code>{settings.modelId}</code>
                {settings.baseUrl && (
                  <>
                    {" "}at <code>{settings.baseUrl}</code>
                  </>
                )}
                .
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="flex items-center gap-1.5">
                <label className="text-[12px] font-medium text-zinc-300">
                  Daily token budget (per user)
                </label>
                <InfoTip label="Daily token budget" side="top">
                  Total input + output tokens per user per day. Resets at 00:00 UTC.
                </InfoTip>
              </span>
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
                label={`${(usage.inputTokens + usage.outputTokens).toLocaleString()} / ${usage.tokenBudget.toLocaleString()} (you, today)${(() => {
                  const cost = estimateUsd(
                    usage.inputTokens,
                    usage.outputTokens,
                    settings.costPerMInputUsd,
                    settings.costPerMOutputUsd,
                  );
                  return cost !== null ? ` · ~${formatUsd(cost)}` : "";
                })()}`}
              />
            </div>
            <div>
              <span className="flex items-center gap-1.5">
                <label className="text-[12px] font-medium text-zinc-300">
                  Daily tool-call budget (per user)
                </label>
                <InfoTip label="Daily tool-call budget" side="top">
                  Caps how many tools the agent can run per user per day.
                </InfoTip>
              </span>
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

          {(isAdmin || settings.costPerMInputUsd !== null || settings.costPerMOutputUsd !== null) && (
            <div>
              <span className="flex items-center gap-1.5">
                <label className="text-[12px] font-medium text-zinc-300">
                  Cost estimation (optional)
                </label>
                <InfoTip label="Cost estimation" side="right">
                  USD per million tokens for your provider/model. Purely informational. It turns
                  token counts in the usage displays into a dollar estimate. Leave empty to hide
                  costs.
                </InfoTip>
              </span>
              {isAdmin && (
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <input
                    className={inputClassName}
                    type="number"
                    min={0}
                    step={0.01}
                    value={costIn}
                    onChange={(e) => setCostIn(e.target.value)}
                    placeholder="Input $/1M tokens"
                  />
                  <input
                    className={inputClassName}
                    type="number"
                    min={0}
                    step={0.01}
                    value={costOut}
                    onChange={(e) => setCostOut(e.target.value)}
                    placeholder="Output $/1M tokens"
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <span className="flex items-center gap-1.5">
              <label className="text-[12px] font-medium text-zinc-300">Operator notes</label>
              <InfoTip label="Operator notes" side="right">
                Site-specific guidance injected into Tainy&apos;s instructions, for example runbook rules like
                &quot;never restart CT 105 during business hours&quot; or &quot;prefer the servers
                IP pool for new containers&quot;. Visible to every user via the copilot&apos;s
                behaviour; max 4,000 characters.
              </InfoTip>
            </span>
            {isAdmin ? (
              <textarea
                className={cn(inputClassName, "min-h-[84px] resize-y")}
                value={operatorNotes}
                onChange={(e) => setOperatorNotes(e.target.value.slice(0, 4000))}
                placeholder="e.g. Production containers are tagged 'prod'. Always suggest a snapshot before touching them."
              />
            ) : operatorNotes.trim() ? (
              <pre className="mt-1.5 whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[12px] text-zinc-400 font-sans">
                {operatorNotes}
              </pre>
            ) : (
              <p className="text-[11.5px] text-zinc-600 mt-1">None set.</p>
            )}
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

      {isAdmin && groups.length > 0 && (
        <SectionPanel
          title="Group tool policy"
          description="Restrict which classes of copilot tools each group may use. Changes apply on Save above."
        >
          <div className="divide-y divide-white/[0.04]">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 pb-1.5 text-[10.5px] uppercase tracking-wide text-zinc-600">
              <span>Group</span>
              <span className="inline-flex items-center gap-1.5">
                Write & admin
                <InfoTip className="normal-case" label="Write and admin tools" side="top">
                  Unchecking hides these tools from the model and blocks them server-side. Read
                  tools (list, get, metrics) are always available. Admin groups are exempt.
                </InfoTip>
              </span>
              <span className="inline-flex items-center gap-1.5">
                Destructive
                <InfoTip className="normal-case" label="Destructive tools" side="top">
                  Unchecking hides these tools from the model and blocks them server-side. Admin
                  groups are exempt.
                </InfoTip>
              </span>
            </div>
            {groups.map((group) => {
              const policy = groupPolicies[group.id] ?? {
                allowWrite: true,
                allowDestructive: true,
              };
              const setPolicy = (patch: Partial<GroupToolPolicy>) =>
                setGroupPolicies((prev) => ({
                  ...prev,
                  [group.id]: { ...policy, ...patch },
                }));
              return (
                <div
                  key={group.id}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 py-1.5"
                >
                  <span className="text-[12px] text-zinc-200 truncate">
                    {group.name}
                    {group.isAdmin && (
                      <span className="ml-1.5 text-[10px] text-violet-300/80">
                        admin group (exempt)
                      </span>
                    )}
                  </span>
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-emerald-500 justify-self-center"
                    checked={policy.allowWrite}
                    disabled={group.isAdmin}
                    onChange={(e) => setPolicy({ allowWrite: e.target.checked })}
                  />
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-emerald-500 justify-self-center"
                    checked={policy.allowDestructive}
                    disabled={group.isAdmin}
                    onChange={(e) => setPolicy({ allowDestructive: e.target.checked })}
                  />
                </div>
              );
            })}
          </div>
        </SectionPanel>
      )}

      {isAdmin && (
        <SectionPanel
          title="Usage by user"
          description="Token and tool-call spend per user, today and over the rolling 30-day window the usage log keeps."
        >
          {userUsage.length === 0 ? (
            <div className="flex items-center gap-2 text-[12px] text-zinc-500">
              <Users className="h-3.5 w-3.5" /> No copilot usage recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wide text-zinc-600">
                    <th className="pb-1.5 pr-4 font-medium">User</th>
                    <th className="pb-1.5 pr-4 font-medium text-right">Tokens today</th>
                    <th className="pb-1.5 pr-4 font-medium text-right">Tools today</th>
                    <th className="pb-1.5 pr-4 font-medium text-right">Tokens 30d</th>
                    <th className="pb-1.5 pr-4 font-medium text-right">Tools 30d</th>
                    {(settings.costPerMInputUsd !== null ||
                      settings.costPerMOutputUsd !== null) && (
                      <th className="pb-1.5 font-medium text-right">Est. cost 30d</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {userUsage.map((row) => {
                    const cost = estimateUsd(
                      row.monthInputTokens,
                      row.monthOutputTokens,
                      settings.costPerMInputUsd,
                      settings.costPerMOutputUsd,
                    );
                    return (
                      <tr key={row.userId}>
                        <td className="py-1.5 pr-4">
                          <span className="text-zinc-200">{row.name}</span>
                          <span className="ml-1.5 text-[10.5px] text-zinc-600">
                            {row.email}
                          </span>
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums text-zinc-300">
                          {(row.todayInputTokens + row.todayOutputTokens).toLocaleString()}
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums text-zinc-300">
                          {row.todayToolCalls.toLocaleString()}
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums text-zinc-400">
                          {(row.monthInputTokens + row.monthOutputTokens).toLocaleString()}
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums text-zinc-400">
                          {row.monthToolCalls.toLocaleString()}
                        </td>
                        {cost !== null && (
                          <td className="py-1.5 text-right tabular-nums text-zinc-300">
                            ~{formatUsd(cost)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionPanel>
      )}

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
