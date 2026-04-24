"use client";

import { useActionState, useCallback, useState } from "react";
import { Eye, EyeOff, Plus, RefreshCcw, Save, Trash2 } from "lucide-react";

import { updateContainerEnvAction } from "@/app/proxmox-actions";
import { useActionTaskFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialActionState } from "@/lib/action-states";
import type { LiveDeploymentDetail } from "@/lib/proxmox";
import { useSiteBasePath } from "@/lib/use-site-path";

type EnvEntry = { key: string; value: string };

const SENSITIVE_KEY_PATTERNS = [
  /_?SECRET/i,
  /_?PASSWORD/i,
  /_?PASS$/i,
  /_?TOKEN/i,
  /_?KEY$/i,
  /_?API_KEY/i,
  /^PRIVATE/i,
  /CREDENTIALS?/i,
  /^AUTH/i,
  /CONNECTION_STRING/i,
];

function parseEnvEntries(text: string): EnvEntry[] {
  if (!text.trim()) return [];

  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const sep = line.indexOf("=");
      if (sep < 1) return { key: line, value: "" };
      return { key: line.slice(0, sep), value: line.slice(sep + 1) };
    });
}

function entriesToText(entries: EnvEntry[]): string {
  return entries
    .filter((e) => e.key.trim().length > 0)
    .map((e) => `${e.key}=${e.value}`)
    .join("\n");
}

export function DeploymentEnvEditor({
  deployment,
}: {
  deployment: LiveDeploymentDetail;
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(
    updateContainerEnvAction,
    initialActionState,
  );
  useActionTaskFeedback(state, {
    errorTitle: "Env update failed",
    successTitle: "Env update queued",
  });

  const [entries, setEntries] = useState<EnvEntry[]>(() =>
    parseEnvEntries(deployment.envText),
  );
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  const isSensitiveKey = useCallback(
    (key: string) => SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key)),
    [],
  );

  const toggleReveal = useCallback((key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const inputClassName =
    "w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

  const updateValue = useCallback((index: number, value: string) => {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, value } : e)));
  }, []);

  const removeEntry = useCallback((index: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const addEntry = useCallback(() => {
    const key = newKey.trim();
    if (!key) return;

    setEntries((prev) => {
      const existing = prev.findIndex((e) => e.key === key);
      if (existing >= 0) {
        return prev.map((e, i) =>
          i === existing ? { ...e, value: newValue } : e,
        );
      }
      return [...prev, { key, value: newValue }];
    });
    setNewKey("");
    setNewValue("");
  }, [newKey, newValue]);

  const resetEntries = useCallback(() => {
    setEntries(parseEnvEntries(deployment.envText));
    setNewKey("");
    setNewValue("");
  }, [deployment.envText]);

  const envText = entriesToText(entries);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
      <Card>
        <CardHeader className="border-b border-white/5">
          <CardTitle>Environment variables</CardTitle>
          <CardDescription>
            Add, edit, or remove individual variables. Existing variables are preserved unless you explicitly remove them.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5">
          <Form action={formAction} className="space-y-4">
            <input name="siteSlug" type="hidden" value={siteSlug} />
            <input name="deploymentId" type="hidden" value={deployment.id} />
            <input name="digest" type="hidden" value={deployment.digest} />
            <input name="envText" type="hidden" value={envText} />

            {/* Existing variables */}
            {entries.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[12px] font-medium text-zinc-500">
                  Current variables ({entries.length})
                </p>
                {entries.map((entry, index) => (
                  <div
                    key={`${entry.key}-${index}`}
                    className="flex items-center gap-2"
                  >
                    <input
                      className={`${inputClassName} max-w-[180px] bg-zinc-950 font-mono text-zinc-400`}
                      readOnly
                      tabIndex={-1}
                      value={entry.key}
                    />
                    <span className="text-zinc-600">=</span>
                    <input
                      className={`${inputClassName} flex-1 font-mono`}
                      disabled={!deployment.configAccessible}
                      onChange={(e) => updateValue(index, e.target.value)}
                      type={isSensitiveKey(entry.key) && !revealedKeys.has(entry.key) ? "password" : "text"}
                      value={entry.value}
                    />
                    {isSensitiveKey(entry.key) && (
                      <button
                        className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
                        onClick={() => toggleReveal(entry.key)}
                        title={revealedKeys.has(entry.key) ? "Hide value" : "Reveal value"}
                        type="button"
                      >
                        {revealedKeys.has(entry.key)
                          ? <EyeOff className="h-3.5 w-3.5" />
                          : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    )}
                    <button
                      className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                      disabled={!deployment.configAccessible}
                      onClick={() => removeEntry(index)}
                      title={`Remove ${entry.key}`}
                      type="button"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <p className="text-[13px] text-zinc-500">
                  No environment variables are currently set on this container.
                </p>
              </div>
            )}

            {/* Add new variable */}
            {deployment.configAccessible && (
              <div className="rounded-md border border-dashed border-white/10 bg-zinc-900/20 px-4 py-3">
                <p className="mb-2 text-[12px] font-medium text-zinc-500">
                  Add variable
                </p>
                <div className="flex items-center gap-2">
                  <input
                    className={`${inputClassName} max-w-[180px] font-mono`}
                    onChange={(e) =>
                      setNewKey(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addEntry();
                      }
                    }}
                    placeholder="KEY"
                    value={newKey}
                  />
                  <span className="text-zinc-600">=</span>
                  <input
                    className={`${inputClassName} flex-1 font-mono`}
                    onChange={(e) => setNewValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addEntry();
                      }
                    }}
                    placeholder="value"
                    value={newValue}
                  />
                  <button
                    className="rounded-md border border-white/10 bg-zinc-800 p-2 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-40"
                    disabled={!newKey.trim()}
                    onClick={addEntry}
                    title="Add variable"
                    type="button"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2 border-t border-white/5 pt-4">
              <Button disabled={!deployment.configAccessible || isPending} type="submit">
                <Save className="h-3.5 w-3.5" />
                {isPending ? "Submitting..." : "Apply changes"}
              </Button>
              <Button onClick={resetEntries} type="button" variant="secondary">
                <RefreshCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader className="border-b border-white/5">
            <CardTitle>Change impact</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <p className="text-2xl font-semibold text-zinc-100">
              {entries.filter((e) => e.key.trim()).length}
            </p>
            <p className="mt-1 text-[13px] text-zinc-500">
              Variables that will be applied when you submit.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-white/5">
            <CardTitle>Container config</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="space-y-3 text-[13px]">
              <div>
                <span className="text-zinc-500">Template source: </span>
                <span className="text-zinc-300">{deployment.ostemplate}</span>
              </div>
              <div>
                <span className="text-zinc-500">Rootfs: </span>
                <span className="text-zinc-300">{deployment.rootfs}</span>
              </div>
              <div>
                <span className="text-zinc-500">Config digest: </span>
                <span className="break-all text-zinc-300">
                  {deployment.digest || "Unavailable"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {!deployment.configAccessible && (
          <Card>
            <CardHeader className="border-b border-white/5">
              <CardTitle>Access required</CardTitle>
            </CardHeader>
            <CardContent className="p-5">
              <p className="text-[13px] leading-relaxed text-zinc-500">
                The app could not read this container&apos;s config, so env editing is
                currently disabled for this view.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
