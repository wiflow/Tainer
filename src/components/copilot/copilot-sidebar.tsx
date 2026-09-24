"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Bot,
  Box,
  Brain,
  Check,
  ChevronDown,
  CircleAlert,
  Globe,
  History,
  Loader2,
  Plus,
  Send,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ChatMessage,
  ChatToolCall,
  ChatToolResult,
  CopilotStreamEvent,
} from "@/lib/copilot/types";
import type { ChatSummary } from "@/lib/copilot/chat-store";
import { redactCredentials } from "@/lib/copilot/redact";

import { CopilotMarkdown } from "./copilot-markdown";
import { PlanView, type ToolCallView } from "./copilot-plan";
import {
  CopilotSuggestions,
  generateSuggestions,
} from "./copilot-suggestions";

type AssistantTurn = {
  role: "assistant";
  text: string;
  reasoning?: string;
  toolCalls: ToolCallView[];
};
type UserTurn = { role: "user"; text: string };
type ErrorTurn = { role: "error"; text: string };
type Turn = UserTurn | AssistantTurn | ErrorTurn;

function extractSiteSlug(pathname: string): string | null {
  const match = pathname.match(/^\/sites\/([^/]+)/);
  return match?.[1] ?? null;
}

function extractDeploymentId(pathname: string): string | null {
  const match = pathname.match(/^\/sites\/[^/]+\/deployments\/([^/]+)$/);
  return match?.[1] ?? null;
}

function decodeDeploymentBadge(id: string): { label: string; node: string } | null {
  try {
    const json = JSON.parse(atob(id.replace(/-/g, "+").replace(/_/g, "/"))) as {
      node?: unknown;
      vmid?: unknown;
      type?: unknown;
    };
    const vmid = Number(json.vmid);
    if (!Number.isInteger(vmid) || vmid <= 0) return null;
    return {
      label: `${json.type === "qemu" ? "VM" : "CT"} ${vmid}`,
      node: typeof json.node === "string" ? json.node : "",
    };
  } catch {
    return null;
  }
}

function emptyAssistantTurn(): AssistantTurn {
  return { role: "assistant", text: "", reasoning: "", toolCalls: [] };
}

function replaceToolCall(
  turns: Turn[],
  turnIndex: number,
  toolCallId: string,
  update: (tc: ToolCallView) => ToolCallView,
): Turn[] {
  const next = turns.slice();
  const target = next[turnIndex];
  if (!target || target.role !== "assistant") return turns;
  next[turnIndex] = {
    ...target,
    toolCalls: target.toolCalls.map((c) => (c.id === toolCallId ? update(c) : c)),
  };
  return next;
}

type CopilotSite = { slug: string; name: string; countryCode: string | null };

export function CopilotSidebar({
  initiallyOpen = false,
  sites = [],
}: {
  initiallyOpen?: boolean;
  sites?: CopilotSite[];
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [siteOverride, setSiteOverride] = useState<string | null | undefined>(
    undefined,
  );

  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const urlSiteSlug = useMemo(() => extractSiteSlug(pathname), [pathname]);
  const deploymentId = useMemo(() => extractDeploymentId(pathname), [pathname]);
  const deploymentBadge = useMemo(
    () => (deploymentId ? decodeDeploymentBadge(deploymentId) : null),
    [deploymentId],
  );

  const [includeDeployment, setIncludeDeployment] = useState(true);
  useEffect(() => {
    setIncludeDeployment(true);
  }, [deploymentId]);
  const effectiveDeploymentId = includeDeployment ? deploymentId : null;

  const [chatId, setChatId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyChats, setHistoryChats] = useState<ChatSummary[] | null>(null);

  const siteSlug: string | null =
    siteOverride === undefined ? urlSiteSlug : siteOverride;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape" && open) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns, streaming]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open]);

  const buildHistoryForApi = useCallback((override?: Turn[]): ChatMessage[] => {
    const src = override ?? turns;
    const messages: ChatMessage[] = [];
    for (const turn of src) {
      if (turn.role === "user") {
        messages.push({ role: "user", content: turn.text });
      } else if (turn.role === "assistant") {
        // The model API rejects a tool_use without a matching tool_result, even for denied tools.
        const toolCalls: ChatToolCall[] = turn.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          args: tc.args,
        }));
        messages.push({
          role: "assistant",
          content: turn.text,
          toolCalls: toolCalls.length ? toolCalls : undefined,
        });
        const results: ChatToolResult[] = turn.toolCalls
          .filter((tc) => tc.status !== "awaiting-approval")
          .map<ChatToolResult>((tc) => {
            if (tc.status === "denied") {
              return {
                toolCallId: tc.id,
                content: { error: "User denied the tool call." },
                isError: true,
              };
            }
            return {
              toolCallId: tc.id,
              content: redactCredentials(tc.result) ?? null,
              isError: tc.status === "error",
            };
          });
        if (results.length) messages.push({ role: "tool", results });
      }
    }
    return messages;
  }, [turns]);

  const streamTurn = useCallback(
    async (history: ChatMessage[]) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      setError(null);

      setTurns((prev) => [...prev, emptyAssistantTurn()]);

      const updateActive = (mut: (turn: AssistantTurn) => AssistantTurn) => {
        setTurns((prev) => {
          const next = prev.slice();
          const idx = next.length - 1;
          if (idx >= 0 && next[idx].role === "assistant") {
            next[idx] = mut(next[idx] as AssistantTurn);
          }
          return next;
        });
      };

      try {
        const response = await fetch("/api/copilot/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            messages: history,
            context: { pathname, siteSlug, deploymentId: effectiveDeploymentId },
          }),
        });
        if (!response.ok || !response.body) {
          const text = await response.text().catch(() => "");
          throw new Error(text || `Request failed (${response.status})`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            const json = dataLine.slice(6);
            let event: CopilotStreamEvent;
            try {
              event = JSON.parse(json);
            } catch {
              continue;
            }
            handleEvent(event, updateActive);
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          const message = err instanceof Error ? err.message : "Stream failed";
          setError(message);
          setTurns((prev) => [...prev, { role: "error", text: message }]);
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [pathname, siteSlug, effectiveDeploymentId],
  );

  function handleEvent(
    event: CopilotStreamEvent,
    updateActive: (mut: (turn: AssistantTurn) => AssistantTurn) => void,
  ) {
    switch (event.type) {
      case "text":
        updateActive((turn) => ({ ...turn, text: turn.text + event.text }));
        break;
      case "reasoning":
        updateActive((turn) => ({
          ...turn,
          reasoning: (turn.reasoning ?? "") + event.text,
        }));
        break;
      case "tool_call_started":
        updateActive((turn) => ({
          ...turn,
          toolCalls: [
            ...turn.toolCalls,
            {
              id: event.toolCallId,
              name: event.name,
              args: event.args,
              status: "running",
            },
          ],
        }));
        break;
      case "tool_result": {
        const nav =
          event.content && typeof event.content === "object"
            ? (event.content as { navigate?: unknown }).navigate
            : null;
        if (typeof nav === "string" && nav.startsWith("/") && !nav.startsWith("//")) {
          router.push(nav);
        }
        updateActive((turn) => ({
          ...turn,
          toolCalls: turn.toolCalls.map((tc) =>
            tc.id === event.toolCallId
              ? {
                  ...tc,
                  status: event.isError ? "error" : "done",
                  result: event.content,
                  durationMs: event.durationMs,
                }
              : tc,
          ),
        }));
        break;
      }
      case "approval_required":
        updateActive((turn) => ({
          ...turn,
          toolCalls: [
            ...turn.toolCalls,
            {
              id: event.toolCallId,
              name: event.name,
              category: event.category,
              klass: event.klass,
              args: event.args,
              status: "awaiting-approval",
              describe: event.describe,
              confirmString: event.confirmString,
              plan: event.plan ?? null,
              token: event.token,
              afterExternalContent: event.afterExternalContent,
            },
          ],
        }));
        break;
      case "turn_end":
        break;
      case "error":
        setError(event.message);
        setTurns((prev) => [...prev, { role: "error", text: event.message }]);
        break;
    }
  }

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      setDraft("");
      setTurns((prev) => [...prev, { role: "user", text: trimmed }]);
      const prior = buildHistoryForApi();
      const history: ChatMessage[] = [...prior, { role: "user", content: trimmed }];
      await streamTurn(history);
    },
    [streaming, buildHistoryForApi, streamTurn],
  );

  const onApprove = useCallback(
    async (turnIndex: number, toolCallId: string) => {
      const turn = turns[turnIndex];
      if (!turn || turn.role !== "assistant") return;
      const tc = turn.toolCalls.find((c) => c.id === toolCallId);
      if (!tc?.token) return;

      setTurns((prev) =>
        replaceToolCall(prev, turnIndex, toolCallId, (c) => ({ ...c, status: "running" })),
      );

      try {
        const response = await fetch("/api/copilot/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: tc.token, decision: "approve" }),
        });
        const json = (await response.json()) as {
          result?: unknown;
          isError?: boolean;
          error?: string;
        };
        if (!response.ok) throw new Error(json.error || `Request failed (${response.status})`);

        const nextTurns = replaceToolCall(turns, turnIndex, toolCallId, (c) => ({
          ...c,
          status: json.isError ? "error" : "done",
          result: json.result,
          token: undefined,
        }));
        setTurns(nextTurns);

        await streamTurn(buildHistoryForApi(nextTurns));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Approval failed";
        setError(message);
        setTurns((prev) =>
          replaceToolCall(prev, turnIndex, toolCallId, (c) => ({
            ...c,
            status: "error",
            result: { error: message },
          })),
        );
      }
    },
    [turns, buildHistoryForApi, streamTurn],
  );

  const onDeny = useCallback(
    async (turnIndex: number, toolCallId: string) => {
      const turn = turns[turnIndex];
      if (!turn || turn.role !== "assistant") return;
      const tc = turn.toolCalls.find((c) => c.id === toolCallId);
      if (!tc?.token) return;
      try {
        await fetch("/api/copilot/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: tc.token, decision: "deny" }),
        });
      } catch {
      }
      const nextTurns = replaceToolCall(turns, turnIndex, toolCallId, (c) => ({
        ...c,
        status: "denied",
        token: undefined,
      }));
      setTurns(nextTurns);
      await streamTurn(buildHistoryForApi(nextTurns));
    },
    [turns, buildHistoryForApi, streamTurn],
  );

  const chatIdRef = useRef<string | null>(null);
  chatIdRef.current = chatId;
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    const justFinished = prevStreamingRef.current && !streaming;
    prevStreamingRef.current = streaming;
    if (!justFinished || !turns.some((t) => t.role === "user")) return;
    void (async () => {
      try {
        const res = await fetch("/api/copilot/chats", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: chatIdRef.current, turns }),
        });
        const json = (await res.json()) as { chat?: ChatSummary };
        if (res.ok && json.chat) {
          setChatId(json.chat.id);
          setHistoryChats((prev) =>
            prev
              ? [json.chat!, ...prev.filter((c) => c.id !== json.chat!.id)]
              : prev,
          );
        }
      } catch {
      }
    })();
  }, [streaming, turns]);

  const toggleHistory = useCallback(async () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && historyChats === null) {
      try {
        const res = await fetch("/api/copilot/chats", { cache: "no-store" });
        const json = (await res.json()) as { chats?: ChatSummary[] };
        setHistoryChats(json.chats ?? []);
      } catch {
        setHistoryChats([]);
      }
    }
  }, [historyOpen, historyChats]);

  const openChat = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/copilot/chats?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as { chat?: { id: string; turns: Turn[] } };
      if (!res.ok || !json.chat) return;
      if (abortRef.current) abortRef.current.abort();
      setTurns(json.chat.turns);
      setChatId(json.chat.id);
      setError(null);
      setHistoryOpen(false);
    } catch {
    }
  }, []);

  const removeChat = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/copilot/chats?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      } catch {
      }
      setHistoryChats((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
      if (chatId === id) setChatId(null);
    },
    [chatId],
  );

  const onClear = () => {
    if (streaming) abortRef.current?.abort();
    setTurns([]);
    setError(null);
    setChatId(null);
  };

  const suggestions = useMemo(
    () => generateSuggestions(turns, pathname, siteSlug),
    [turns, pathname, siteSlug],
  );

  return (
    <>
      <CopilotTrigger onClick={() => setOpen((o) => !o)} open={open} />
      <div
        aria-hidden={!open}
        className={cn(
          "fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] transition-opacity",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        onClick={() => setOpen(false)}
      />
      <aside
        aria-label="Tainy"
        className={cn(
          "fixed right-0 top-0 z-50 flex h-screen w-full max-w-[460px] flex-col border-l border-white/5 bg-[#0a0a0c] shadow-2xl transition-transform",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <header className="border-b border-white/[0.06]">
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-white/[0.06] border border-white/10">
                <Sparkles className="h-3.5 w-3.5 text-zinc-200" />
              </div>
              <div className="text-[13px] font-medium text-white">Tainy</div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => void toggleHistory()}
                className={cn(
                  "p-1.5 rounded-md transition-colors",
                  historyOpen
                    ? "text-zinc-100 bg-white/[0.08]"
                    : "text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05]",
                )}
                title="Previous chats"
              >
                <History className="h-4 w-4" />
              </button>
              <Link
                href="/settings/copilot"
                className="text-zinc-500 hover:text-zinc-200 p-1.5 rounded-md hover:bg-white/[0.05] transition-colors"
                title="Tainy settings"
              >
                <Settings className="h-4 w-4" />
              </Link>
              <button
                onClick={onClear}
                className="text-zinc-500 hover:text-zinc-200 p-1.5 rounded-md hover:bg-white/[0.05] transition-colors"
                title="New chat"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="text-zinc-500 hover:text-zinc-200 p-1.5 rounded-md hover:bg-white/[0.05] transition-colors"
                title="Close (Esc)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="px-3 pb-2 space-y-1.5">
            <SiteContextPicker
              sites={sites}
              effectiveSlug={siteSlug}
              urlSlug={urlSiteSlug}
              isOverridden={siteOverride !== undefined}
              onPick={(slug) => setSiteOverride(slug)}
              onClear={() => setSiteOverride(undefined)}
            />
            {deploymentBadge && (
              <button
                onClick={() => setIncludeDeployment((v) => !v)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors",
                  includeDeployment
                    ? "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-200"
                    : "border-white/[0.06] bg-white/[0.02] text-zinc-500",
                )}
                title={
                  includeDeployment
                    ? "The copilot treats this page's deployment as \"this container\". Click to detach."
                    : "Page context detached — questions won't assume this deployment. Click to re-attach."
                }
              >
                <Box className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">
                  {deploymentBadge.label}
                  {deploymentBadge.node ? ` · ${deploymentBadge.node}` : ""}
                </span>
                <span className="ml-auto flex-shrink-0 text-[10px] opacity-80">
                  {includeDeployment ? "context on" : "context off"}
                </span>
              </button>
            )}
          </div>
        </header>

        {historyOpen && (
          <ChatHistoryPanel
            chats={historyChats}
            activeChatId={chatId}
            onOpen={(id) => void openChat(id)}
            onDelete={(id) => void removeChat(id)}
          />
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {turns.length === 0 && !streaming && <EmptyState siteSlug={siteSlug} />}
          <AnimatePresence initial={false}>
            {turns.map((turn, idx) => (
              <TurnView
                key={idx}
                turn={turn}
                onApprove={(toolCallId) => onApprove(idx, toolCallId)}
                onDeny={(toolCallId) => onDeny(idx, toolCallId)}
              />
            ))}
          </AnimatePresence>
          {streaming &&
            !(
              turns[turns.length - 1]?.role === "assistant" &&
              (turns[turns.length - 1] as AssistantTurn).toolCalls.some(
                (tc) => tc.status === "running",
              )
            ) && (
              <div className="flex items-center gap-2 text-[12px] text-zinc-500 px-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
              </div>
            )}
        </div>

        {error && (
          <div className="mx-3 mb-1.5 flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/[0.08] px-3 py-2 text-[12px] text-rose-200">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <div className="flex-1">{error}</div>
            <button
              onClick={() => setError(null)}
              className="text-rose-300 hover:text-rose-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <CopilotSuggestions
          suggestions={suggestions}
          onPick={(text) => {
            if (streaming) {
              setDraft(text);
              inputRef.current?.focus();
            } else {
              void send(text);
            }
          }}
          disabled={streaming}
        />

        <footer className="border-t border-white/[0.06] p-2.5">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] focus-within:border-white/[0.15] transition-colors">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              placeholder={
                siteSlug
                  ? `Ask about ${siteSlug}… (Enter to send · Shift+Enter newline)`
                  : "Ask anything…"
              }
              rows={2}
              className="block w-full resize-none bg-transparent px-3 py-2.5 text-[13px] text-zinc-100 placeholder:text-zinc-600 outline-none"
              disabled={streaming}
            />
            <div className="flex items-center justify-between px-2 pb-1.5">
              <div className="text-[10px] text-zinc-600 flex items-center gap-1.5">
                <kbd className="rounded border border-white/[0.06] bg-white/[0.03] px-1 py-px text-[9.5px]">
                  ⌘J
                </kbd>
                <span>· BYOK · audited</span>
              </div>
              <Button
                onClick={() => void send(draft)}
                disabled={streaming || !draft.trim()}
                size="sm"
                variant="accent"
              >
                {streaming ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5 mr-1.5" />
                    Send
                  </>
                )}
              </Button>
            </div>
          </div>
        </footer>
      </aside>
    </>
  );
}

function SiteContextPicker({
  sites,
  effectiveSlug,
  urlSlug,
  isOverridden,
  onPick,
  onClear,
}: {
  sites: CopilotSite[];
  effectiveSlug: string | null;
  urlSlug: string | null;
  isOverridden: boolean;
  onPick: (slug: string | null) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const currentSite = effectiveSlug ? sites.find((s) => s.slug === effectiveSlug) : null;
  const label = effectiveSlug ? (currentSite?.name ?? effectiveSlug) : "All sites";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.025] px-2.5 py-1.5 text-left hover:border-white/15 hover:bg-white/[0.04] transition-colors"
      >
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-sm bg-white/[0.06] overflow-hidden">
          {effectiveSlug ? (
            currentSite?.countryCode ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`https://flagcdn.com/${currentSite.countryCode.toLowerCase()}.svg`}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <Globe className="h-3 w-3 text-zinc-300" />
            )
          ) : (
            <Globe className="h-3 w-3 text-zinc-300" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11.5px] font-medium text-zinc-100 truncate">{label}</div>
          <div className="text-[10px] text-zinc-500 truncate">
            {effectiveSlug ? "Scope: this site only" : "Scope: any site"}
            {isOverridden && urlSlug && urlSlug !== effectiveSlug && (
              <span className="text-amber-300/80"> · overrides page</span>
            )}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-3 w-3 text-zinc-500 transition-transform flex-shrink-0",
            open && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-white/10 bg-[#0f0f12] shadow-xl overflow-hidden max-h-72 overflow-y-auto"
          >
            <PickerOption
              icon={<Globe className="h-3 w-3 text-zinc-300" />}
              label="All sites"
              hint="Model can work across or ask which site"
              selected={effectiveSlug === null}
              onClick={() => {
                onPick(null);
                setOpen(false);
              }}
            />
            {sites.length > 0 && (
              <div className="border-t border-white/[0.04] my-0.5" />
            )}
            {sites.map((s) => (
              <PickerOption
                key={s.slug}
                icon={
                  s.countryCode ? (
                    <span className="block h-3 w-4 overflow-hidden rounded-sm">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://flagcdn.com/${s.countryCode.toLowerCase()}.svg`}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </span>
                  ) : (
                    <Globe className="h-3 w-3 text-zinc-300" />
                  )
                }
                label={s.name}
                hint={s.slug === urlSlug ? "Current page" : s.slug}
                selected={effectiveSlug === s.slug}
                onClick={() => {
                  onPick(s.slug);
                  setOpen(false);
                }}
              />
            ))}
            {urlSlug && (
              <>
                <div className="border-t border-white/[0.04] my-0.5" />
                <button
                  type="button"
                  onClick={() => {
                    onClear();
                    setOpen(false);
                  }}
                  className="block w-full text-left px-3 py-1.5 text-[10.5px] text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04] transition-colors"
                >
                  Follow current page ({urlSlug})
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PickerOption({
  icon,
  label,
  hint,
  selected,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors",
        selected ? "bg-white/[0.04]" : "hover:bg-white/[0.03]",
      )}
    >
      <span className="flex h-4 w-4 items-center justify-center flex-shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[12px] text-zinc-100 truncate">{label}</span>
        {hint && <span className="block text-[10px] text-zinc-500 truncate">{hint}</span>}
      </span>
      {selected && <Check className="h-3 w-3 text-emerald-400 flex-shrink-0" />}
    </button>
  );
}

function CopilotTrigger({ onClick, open }: { onClick: () => void; open: boolean }) {
  if (open) return null;
  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full border border-white/10 bg-[#111113]/95 backdrop-blur px-4 py-2.5 shadow-xl hover:bg-white/[0.06] transition-colors"
      title="Open Tainy (Cmd+J)"
    >
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white/[0.08]">
        <Sparkles className="h-3 w-3 text-zinc-200" />
      </div>
      <span className="text-[12px] font-medium text-zinc-200">Tainy</span>
      <kbd className="hidden sm:inline-flex items-center rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-500">
        ⌘J
      </kbd>
    </motion.button>
  );
}

function EmptyState({ siteSlug }: { siteSlug: string | null }) {
  return (
    <div className="flex flex-col items-center text-center py-6 gap-1.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
        <Bot className="h-4 w-4 text-zinc-300" />
      </div>
      <div className="text-[13px] font-medium text-white">Tainy</div>
      <div className="text-[11.5px] text-zinc-500 max-w-[300px]">
        Ask about cluster state, deployments, or templates. I can also run actions — you&apos;ll
        see an approval card before anything destructive.
      </div>
      {siteSlug && (
        <div className="mt-1 text-[10.5px] text-zinc-600">
          Working in site <code className="text-zinc-400">{siteSlug}</code>
        </div>
      )}
    </div>
  );
}

function TurnView({
  turn,
  onApprove,
  onDeny,
}: {
  turn: Turn;
  onApprove: (toolCallId: string) => void;
  onDeny: (toolCallId: string) => void;
}) {
  if (turn.role === "user") {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18 }}
        className="flex justify-end"
      >
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-white/[0.08] border border-white/[0.06] px-3 py-2 text-[13px] text-zinc-100 whitespace-pre-wrap">
          {turn.text}
        </div>
      </motion.div>
    );
  }
  if (turn.role === "error") {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18 }}
        className="flex items-start gap-2 rounded-md border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2 text-[12px] text-rose-200"
      >
        <CircleAlert className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
        <div>{turn.text}</div>
      </motion.div>
    );
  }
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2 }}
      className="space-y-2"
    >
      {turn.reasoning && (
        <details className="group px-1">
          <summary className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-zinc-600 transition-colors hover:text-zinc-400">
            <Brain className="h-3 w-3 flex-shrink-0" />
            <span>Thought process</span>
            <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-white/[0.04] bg-white/[0.015] px-2.5 py-2 text-[11.5px] leading-relaxed text-zinc-500">
            {turn.reasoning}
          </div>
        </details>
      )}
      {turn.toolCalls.length > 0 && (
        <PlanView
          toolCalls={turn.toolCalls}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      )}
      {turn.text && (
        <div className="px-1">
          <CopilotMarkdown text={turn.text} />
        </div>
      )}
    </motion.div>
  );
}

function chatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function ChatHistoryPanel({
  chats,
  activeChatId,
  onOpen,
  onDelete,
}: {
  chats: ChatSummary[] | null;
  activeChatId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="border-b border-white/[0.06] bg-white/[0.015] max-h-56 overflow-y-auto">
      {chats === null ? (
        <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading chats…
        </div>
      ) : chats.length === 0 ? (
        <div className="px-4 py-3 text-[12px] text-zinc-500">
          No saved chats yet — conversations save automatically after each reply.
        </div>
      ) : (
        <ul className="py-1">
          {chats.map((chat) => (
            <li key={chat.id} className="group flex items-center gap-1 px-2">
              <button
                onClick={() => onOpen(chat.id)}
                className={cn(
                  "flex-1 min-w-0 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05]",
                  chat.id === activeChatId && "bg-white/[0.04]",
                )}
              >
                <div className="truncate text-[12px] text-zinc-200">{chat.title}</div>
                <div className="text-[10px] text-zinc-600">
                  {chatTimeAgo(chat.updatedAt)} · {chat.turnCount} turns
                </div>
              </button>
              <button
                onClick={() => onDelete(chat.id)}
                className="flex-shrink-0 rounded-md p-1.5 text-zinc-600 opacity-0 transition-all group-hover:opacity-100 hover:text-rose-300 hover:bg-white/[0.05]"
                title="Delete chat"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
