"use client";

import { useActionState, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Filter, Play, Power, RotateCw, Square, Trash2, Variable, Zap } from "lucide-react";

import { bulkSetEnvAction, bulkTagLifecycleAction } from "@/app/group-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialBasicActionState, initialBulkActionState } from "@/lib/action-states";
import type { LiveDeployment } from "@/lib/proxmox";
import { useSiteBasePath } from "@/lib/use-site-path";

const TAG_PREFIX = "grp-";

type ContainerTag = { id: string; name: string; slug: string };

type Condition = {
  field: "tag" | "image" | "status" | "node" | "type";
  value: string;
};

function matchesConditions(d: LiveDeployment, conditions: Condition[]): boolean {
  return conditions.every((c) => {
    switch (c.field) {
      case "tag":
        return d.tagList.includes(`${TAG_PREFIX}${c.value}`);
      case "image":
        return d.templateName === c.value;
      case "status":
        return d.rawStatus === c.value;
      case "node":
        return d.node === c.value;
      case "type":
        return d.type === c.value;
      default:
        return true;
    }
  });
}

export function BulkOperationsPanel({
  deployments,
  tags,
}: {
  deployments: LiveDeployment[];
  tags: ContainerTag[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [action, setAction] = useState<"env" | "start" | "stop" | "restart" | "shutdown">("env");
  const [envKey, setEnvKey] = useState("");
  const [envValue, setEnvValue] = useState("");
  const [existingOnly, setExistingOnly] = useState(false);

  const uniqueImages = useMemo(() => [...new Set(deployments.map((d) => d.templateName))].sort(), [deployments]);
  const uniqueNodes = useMemo(() => [...new Set(deployments.map((d) => d.node))].sort(), [deployments]);
  const uniqueStatuses = useMemo(() => [...new Set(deployments.map((d) => d.rawStatus))].sort(), [deployments]);

  const matched = useMemo(
    () => conditions.length > 0 ? deployments.filter((d) => matchesConditions(d, conditions)) : [],
    [deployments, conditions],
  );

  const addCondition = () => {
    setConditions([...conditions, { field: "tag", value: "" }]);
  };

  const updateCondition = (index: number, field: Condition["field"], value: string) => {
    const updated = [...conditions];
    updated[index] = { field, value };
    setConditions(updated);
  };

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const getOptions = (field: Condition["field"]): { label: string; value: string }[] => {
    switch (field) {
      case "tag":
        return tags.map((t) => ({ label: t.name, value: t.slug }));
      case "image":
        return uniqueImages.map((i) => ({ label: i, value: i }));
      case "status":
        return uniqueStatuses.map((s) => ({ label: s, value: s }));
      case "node":
        return uniqueNodes.map((n) => ({ label: n, value: n }));
      case "type":
        return [{ label: "LXC", value: "lxc" }, { label: "VM", value: "qemu" }];
    }
  };

  const inputClassName =
    "rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500";

  const selectClassName =
    "h-9 rounded-md border border-white/10 bg-zinc-900 px-2.5 text-[13px] text-zinc-300 outline-none focus:border-zinc-500";

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/5 bg-[#111113] py-3 text-[13px] text-zinc-500 transition-colors hover:border-white/10 hover:text-zinc-300"
        type="button"
      >
        <Zap className="h-3.5 w-3.5" />
        Bulk operations
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <Card className="overflow-hidden rounded-2xl">
      <CardHeader className="border-b border-white/5">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Bulk operations
          </CardTitle>
          <button
            onClick={() => setExpanded(false)}
            className="text-zinc-500 hover:text-zinc-300"
            type="button"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-medium uppercase tracking-wider text-zinc-500">
              <Filter className="mr-1.5 inline h-3 w-3" />
              Conditions
            </p>
            <button
              onClick={addCondition}
              className="text-[12px] text-emerald-400 hover:underline"
              type="button"
            >
              + Add condition
            </button>
          </div>

          {conditions.length === 0 && (
            <p className="text-[12px] text-zinc-600">
              Add conditions to select which deployments to target.
            </p>
          )}

          {conditions.map((condition, index) => (
            <div key={index} className="flex items-center gap-2">
              <select
                className={selectClassName}
                value={condition.field}
                onChange={(e) => updateCondition(index, e.target.value as Condition["field"], "")}
              >
                <option value="tag">Tag</option>
                <option value="image">Image</option>
                <option value="status">Status</option>
                <option value="node">Node</option>
                <option value="type">Type</option>
              </select>
              <span className="text-[12px] text-zinc-600">=</span>
              <select
                className={`${selectClassName} flex-1`}
                value={condition.value}
                onChange={(e) => updateCondition(index, condition.field, e.target.value)}
              >
                <option value="">Select...</option>
                {getOptions(condition.field).map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <button
                onClick={() => removeCondition(index)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
                type="button"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {conditions.length > 0 && (
            <div className="rounded-lg bg-zinc-800/40 px-3 py-2 text-[13px] tabular-nums text-zinc-400">
              <span className="font-medium text-zinc-200">{matched.length}</span> deployment(s) match
              {matched.length > 0 && matched.length <= 8 && (
                <span className="ml-2 text-zinc-600">
                  ({matched.map((d) => d.name).join(", ")})
                </span>
              )}
            </div>
          )}
        </div>

        {conditions.length > 0 && matched.length > 0 && (
          <div className="space-y-3 border-t border-white/5 pt-5">
            <p className="text-[12px] font-medium uppercase tracking-wider text-zinc-500">
              Action
            </p>

            <div className="flex flex-wrap gap-2">
              {(["env", "start", "stop", "restart", "shutdown"] as const).map((a) => {
                const labels: Record<string, { label: string; icon: typeof Variable }> = {
                  env: { label: "Set env var", icon: Variable },
                  start: { label: "Start", icon: Play },
                  stop: { label: "Stop", icon: Square },
                  restart: { label: "Restart", icon: RotateCw },
                  shutdown: { label: "Shutdown", icon: Power },
                };
                const { label, icon: Icon } = labels[a];
                return (
                  <button
                    key={a}
                    onClick={() => setAction(a)}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                      action === a
                        ? "bg-zinc-700 text-zinc-100"
                        : "bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                    }`}
                    type="button"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                );
              })}
            </div>

            {action === "env" && (
              <EnvActionForm
                matched={matched}
                envKey={envKey}
                envValue={envValue}
                existingOnly={existingOnly}
                onEnvKeyChange={setEnvKey}
                onEnvValueChange={setEnvValue}
                onExistingOnlyChange={setExistingOnly}
                inputClassName={inputClassName}
              />
            )}

            {action !== "env" && (
              <LifecycleActionForm matched={matched} command={action} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EnvActionForm({
  matched,
  envKey,
  envValue,
  existingOnly,
  onEnvKeyChange,
  onEnvValueChange,
  onExistingOnlyChange,
  inputClassName,
}: {
  matched: LiveDeployment[];
  envKey: string;
  envValue: string;
  existingOnly: boolean;
  onEnvKeyChange: (v: string) => void;
  onEnvValueChange: (v: string) => void;
  onExistingOnlyChange: (v: boolean) => void;
  inputClassName: string;
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(bulkSetEnvAction, initialBasicActionState);

  return (
    <Form action={formAction} className="space-y-3">
      <input name="siteSlug" type="hidden" value={siteSlug} />
      <input name="deploymentIds" type="hidden" value={matched.map((d) => d.id).join(",")} />
      <input name="existingOnly" type="hidden" value={existingOnly ? "true" : "false"} />
      <input name="tagSlug" type="hidden" value="__bulk_ids__" />

      <p className="text-[11px] text-zinc-600">Environment variables are only applied to LXC containers. VMs in the selection will be skipped.</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <input
          className={`${inputClassName} font-mono`}
          name="envKey"
          placeholder="KEY"
          required
          value={envKey}
          onChange={(e) => onEnvKeyChange(e.target.value)}
        />
        <input
          className={`${inputClassName} font-mono`}
          name="envValue"
          placeholder="value"
          value={envValue}
          onChange={(e) => onEnvValueChange(e.target.value)}
        />
      </div>

      <label className="flex items-center gap-2 text-[13px] text-zinc-400">
        <input
          type="checkbox"
          checked={existingOnly}
          onChange={(e) => onExistingOnlyChange(e.target.checked)}
        />
        Only update deployments that already have this key
      </label>

      {state.status === "success" && <p className="text-[13px] text-emerald-400">{state.message}</p>}
      {state.status === "error" && <p className="text-[13px] text-red-400">{state.message}</p>}

      <Button disabled={isPending || !envKey} type="submit" variant="secondary">
        {isPending ? "Applying..." : `Set on ${matched.length} deployment(s)`}
      </Button>
    </Form>
  );
}

function LifecycleActionForm({
  matched,
  command,
}: {
  matched: LiveDeployment[];
  command: "start" | "stop" | "restart" | "shutdown";
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(bulkTagLifecycleAction, initialBulkActionState);

  const labels = {
    start: "Start",
    stop: "Stop",
    restart: "Restart",
    shutdown: "Shutdown",
  };

  return (
    <Form action={formAction}>
      <input name="siteSlug" type="hidden" value={siteSlug} />
      <input name="deploymentIds" type="hidden" value={matched.map((d) => d.id).join(",")} />
      <input name="command" type="hidden" value={command} />
      <input name="groupSlug" type="hidden" value="__bulk_ids__" />

      {state.status === "success" && <p className="mb-2 text-[13px] text-emerald-400">{state.message}</p>}
      {state.status === "error" && <p className="mb-2 text-[13px] text-red-400">{state.message}</p>}

      <Button disabled={isPending} type="submit" variant="secondary">
        {isPending ? "Running..." : `${labels[command]} ${matched.length} deployment(s)`}
      </Button>
    </Form>
  );
}
