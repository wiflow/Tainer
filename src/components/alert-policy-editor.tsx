"use client";

import { useActionState, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Save, Trash2, X } from "lucide-react";

import {
  createAlertPolicyAction,
  deleteAlertPolicyAction,
  duplicateAlertPolicyAction,
  updateAlertPolicyAction,
} from "@/app/alert-policy-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import type { AlertPolicy, AlertRuleConfig } from "@/lib/alert-policies";
import type { ContainerTag } from "@/lib/container-groups";
import { getTagPillClass, getTagSelectedPillClass } from "@/lib/tag-utils";
import { useSiteBasePath } from "@/lib/use-site-path";

const ALERT_RULE_TYPES = [
  "deployment-offline",
  "deployment-high-cpu",
  "deployment-high-memory",
  "deployment-high-disk",
  "storage-unhealthy",
  "storage-low-space",
  "backup-stale",
  "node-high-cpu",
  "node-high-memory",
] as const;

type AlertRuleType = (typeof ALERT_RULE_TYPES)[number];

const RULE_META: Record<
  AlertRuleType,
  {
    category: "deployment" | "infrastructure";
    description: string;
    hasThresholdHours: boolean;
    hasThresholdPercent: boolean;
    label: string;
  }
> = {
  "backup-stale": {
    category: "infrastructure",
    description: "Alert when the latest backup age exceeds a threshold.",
    hasThresholdHours: true,
    hasThresholdPercent: false,
    label: "Backup stale",
  },
  "deployment-high-cpu": {
    category: "deployment",
    description: "Alert when a workload CPU usage exceeds a percentage threshold.",
    hasThresholdHours: false,
    hasThresholdPercent: true,
    label: "High CPU",
  },
  "deployment-high-disk": {
    category: "deployment",
    description: "Alert when a workload disk usage exceeds a percentage threshold.",
    hasThresholdHours: false,
    hasThresholdPercent: true,
    label: "High disk",
  },
  "deployment-high-memory": {
    category: "deployment",
    description: "Alert when a workload memory usage exceeds a percentage threshold.",
    hasThresholdHours: false,
    hasThresholdPercent: true,
    label: "High memory",
  },
  "deployment-offline": {
    category: "deployment",
    description: "Alert when a CT or VM is stopped, paused, or otherwise not running.",
    hasThresholdHours: false,
    hasThresholdPercent: false,
    label: "Workload offline",
  },
  "node-high-cpu": {
    category: "infrastructure",
    description: "Alert when a Proxmox node CPU usage exceeds a percentage threshold.",
    hasThresholdHours: false,
    hasThresholdPercent: true,
    label: "Node high CPU",
  },
  "node-high-memory": {
    category: "infrastructure",
    description: "Alert when a Proxmox node memory usage exceeds a percentage threshold.",
    hasThresholdHours: false,
    hasThresholdPercent: true,
    label: "Node high memory",
  },
  "storage-low-space": {
    category: "infrastructure",
    description: "Alert before a backup storage pool fills up completely.",
    hasThresholdHours: false,
    hasThresholdPercent: true,
    label: "Storage low space",
  },
  "storage-unhealthy": {
    category: "infrastructure",
    description: "Alert when a backup storage target is inaccessible or reporting issues.",
    hasThresholdHours: false,
    hasThresholdPercent: false,
    label: "Storage unhealthy",
  },
};

const fieldClassName =
  "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

const smallFieldClassName =
  "w-full rounded-md border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-[12px] text-zinc-200 outline-none transition-colors focus:border-zinc-500";

function RuleRow({
  meta,
  rule,
}: {
  meta: (typeof RULE_META)[keyof typeof RULE_META];
  rule: AlertRuleConfig;
}) {
  const [enabled, setEnabled] = useState(rule.enabled);

  return (
    <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <label className="flex items-start gap-3 cursor-pointer flex-1 min-w-0">
          <input
            checked={enabled}
            className="mt-0.5 h-4 w-4 rounded border-white/10 bg-zinc-900 text-sky-400"
            name={`rule_${rule.type}_enabled`}
            onChange={(e) => setEnabled(e.target.checked)}
            type="checkbox"
          />
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-zinc-200">{meta.label}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
              {meta.description}
            </p>
          </div>
        </label>
        <Badge variant={meta.category === "deployment" ? "info" : "neutral"}>
          {meta.category}
        </Badge>
      </div>

      {enabled && (
        <div className="mt-3 flex flex-wrap items-end gap-3 pl-7">
          <label className="block w-28">
            <span className="text-[11px] font-medium text-zinc-400">Grace (min)</span>
            <input
              className={smallFieldClassName}
              defaultValue={rule.graceMinutes}
              min="0"
              name={`rule_${rule.type}_grace`}
              type="number"
            />
          </label>

          {meta.hasThresholdPercent && (
            <label className="block w-28">
              <span className="text-[11px] font-medium text-zinc-400">Threshold (%)</span>
              <input
                className={smallFieldClassName}
                defaultValue={rule.thresholdPercent ?? 90}
                max="99"
                min="1"
                name={`rule_${rule.type}_threshold_percent`}
                type="number"
              />
            </label>
          )}

          {meta.hasThresholdHours && (
            <label className="block w-28">
              <span className="text-[11px] font-medium text-zinc-400">Threshold (hrs)</span>
              <input
                className={smallFieldClassName}
                defaultValue={rule.thresholdHours ?? 24}
                min="1"
                name={`rule_${rule.type}_threshold_hours`}
                type="number"
              />
            </label>
          )}
        </div>
      )}

      {!enabled && (
        <>
          <input name={`rule_${rule.type}_grace`} type="hidden" value={rule.graceMinutes} />
          {meta.hasThresholdPercent && (
            <input
              name={`rule_${rule.type}_threshold_percent`}
              type="hidden"
              value={rule.thresholdPercent ?? 90}
            />
          )}
          {meta.hasThresholdHours && (
            <input
              name={`rule_${rule.type}_threshold_hours`}
              type="hidden"
              value={rule.thresholdHours ?? 24}
            />
          )}
        </>
      )}
    </div>
  );
}

export function AlertPolicyEditor({
  availableTags,
  onClose,
  policy,
}: {
  availableTags: ContainerTag[];
  onClose?: () => void;
  policy?: AlertPolicy;
}) {
  const isNew = !policy;
  const action = isNew ? createAlertPolicyAction : updateAlertPolicyAction;

  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(action, initialBasicActionState);
  const [deleteState, deleteAction, isDeleting] = useActionState(
    deleteAlertPolicyAction,
    initialBasicActionState,
  );
  const [dupState, dupAction, isDuplicating] = useActionState(
    duplicateAlertPolicyAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(state, {
    errorTitle: isNew ? "Create policy failed" : "Update policy failed",
    successTitle: isNew ? "Policy created" : "Policy saved",
  });
  useActionFlashFeedback(deleteState, {
    errorTitle: "Delete failed",
    successTitle: "Policy deleted",
  });
  useActionFlashFeedback(dupState, {
    errorTitle: "Duplicate failed",
    successTitle: "Policy duplicated",
  });

  const [scope, setScope] = useState<"all" | "tagged">(policy?.scope ?? "all");
  const [selectedTags, setSelectedTags] = useState<string[]>(policy?.tagSlugs ?? []);
  const [showDeliveryOverride, setShowDeliveryOverride] = useState(
    Boolean(policy?.webhookUrl),
  );
  const [rulesExpanded, setRulesExpanded] = useState(true);

  const rules: AlertRuleConfig[] = policy?.rules ?? ALERT_RULE_TYPES.map((type) => {
    const meta = RULE_META[type];
    return {
      enabled: type === "deployment-offline",
      graceMinutes: 10,
      ...(meta.hasThresholdPercent && { thresholdPercent: 90 }),
      ...(meta.hasThresholdHours && { thresholdHours: 24 }),
      type,
    };
  });

  const ruleMap = new Map(rules.map((r) => [r.type, r]));

  function handleTagToggle(slug: string) {
    setSelectedTags((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );
  }

  // Close on successful create/delete
  const lastStatus = state.status;
  const lastDeleteStatus = deleteState.status;
  useEffect(() => {
    if ((isNew && lastStatus === "success" && onClose) ||
        (lastDeleteStatus === "success" && onClose)) {
      const timer = setTimeout(() => onClose(), 100);
      return () => clearTimeout(timer);
    }
  }, [isNew, lastStatus, lastDeleteStatus, onClose]);

  return (
    <Card className="border-sky-900/40">
      <CardHeader className="border-b border-white/5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[15px]">
            {isNew ? "Create alert policy" : `Edit: ${policy.name}`}
          </CardTitle>
          {onClose && (
            <button
              className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              onClick={onClose}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-5">
        <Form action={formAction} className="space-y-5">
          <input name="siteSlug" type="hidden" value={siteSlug} />
          {!isNew && <input name="policyId" type="hidden" value={policy.id} />}

          {/* Basics */}
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block">
              <span className="text-[12px] font-medium text-zinc-400">Policy name</span>
              <input
                className={fieldClassName}
                defaultValue={policy?.name ?? ""}
                name="name"
                placeholder="e.g. Production workloads"
                required
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-zinc-400">Description</span>
              <input
                className={fieldClassName}
                defaultValue={policy?.description ?? ""}
                name="description"
                placeholder="Optional description"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                className="h-4 w-4 rounded border-white/10 bg-zinc-900 text-sky-400"
                defaultChecked={policy?.enabled ?? true}
                name="enabled"
                type="checkbox"
              />
              <span className="text-[13px] font-medium text-zinc-200">Enabled</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                className="h-4 w-4 rounded border-white/10 bg-zinc-900 text-sky-400"
                defaultChecked={policy?.resolveNotificationsEnabled ?? true}
                name="resolveNotificationsEnabled"
                type="checkbox"
              />
              <span className="text-[13px] font-medium text-zinc-200">Notify on recovery</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                className="h-4 w-4 rounded border-white/10 bg-zinc-900 text-sky-400"
                defaultChecked={policy?.notifyOnce ?? false}
                name="notifyOnce"
                type="checkbox"
              />
              <span className="text-[13px] font-medium text-zinc-200">Notify once per alert (no reminders)</span>
            </label>
          </div>

          {/* Timing */}
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">
                Check interval (minutes)
              </span>
              <input
                className={fieldClassName}
                defaultValue={policy?.checkIntervalMinutes ?? 5}
                min="1"
                name="checkIntervalMinutes"
                type="number"
              />
              <p className="mt-1.5 text-[11px] text-zinc-500">
                How often this policy evaluates. The cron endpoint must run at least this often.
              </p>
            </label>

            <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">
                Reminder interval (minutes)
              </span>
              <input
                className={fieldClassName}
                defaultValue={policy?.reminderIntervalMinutes ?? 240}
                min="5"
                name="reminderIntervalMinutes"
                type="number"
              />
              <p className="mt-1.5 text-[11px] text-zinc-500">
                Re-notify after this many minutes if the condition persists.
              </p>
            </label>
          </div>

          {/* Scope */}
          <div className="rounded-xl border border-white/5 bg-zinc-900/20 p-4 space-y-3">
            <div>
              <p className="text-[13px] font-medium text-zinc-200">Scope</p>
              <p className="mt-1 text-[11px] text-zinc-500">
                Choose which workloads this policy monitors. Infrastructure rules (storage, nodes)
                always apply cluster-wide.
              </p>
            </div>

            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  checked={scope === "all"}
                  className="h-4 w-4 border-white/10 bg-zinc-900 text-sky-400"
                  name="scope"
                  onChange={() => setScope("all")}
                  type="radio"
                  value="all"
                />
                <span className="text-[13px] text-zinc-200">All workloads</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  checked={scope === "tagged"}
                  className="h-4 w-4 border-white/10 bg-zinc-900 text-sky-400"
                  name="scope"
                  onChange={() => setScope("tagged")}
                  type="radio"
                  value="tagged"
                />
                <span className="text-[13px] text-zinc-200">By tag</span>
              </label>
            </div>

            {scope === "tagged" && (
              <div>
                <input name="tagSlugs" type="hidden" value={selectedTags.join(",")} />
                {availableTags.length === 0 ? (
                  <p className="text-[12px] text-zinc-500">
                    No tags defined yet. Create tags in the Tags page first.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {availableTags.map((tag) => (
                      <button
                        className={`rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                          selectedTags.includes(tag.slug)
                            ? getTagSelectedPillClass(tag.color)
                            : getTagPillClass(tag.color)
                        }`}
                        key={tag.slug}
                        onClick={() => handleTagToggle(tag.slug)}
                        type="button"
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Rules */}
          <div className="rounded-xl border border-white/5 bg-zinc-900/20 p-4 space-y-3">
            <button
              className="flex w-full items-center gap-2 text-left"
              onClick={() => setRulesExpanded(!rulesExpanded)}
              type="button"
            >
              {rulesExpanded ? (
                <ChevronDown className="h-4 w-4 text-zinc-500" />
              ) : (
                <ChevronRight className="h-4 w-4 text-zinc-500" />
              )}
              <div>
                <p className="text-[13px] font-medium text-zinc-200">Alert rules</p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {rules.filter((r) => r.enabled).length} of {rules.length} rules enabled
                </p>
              </div>
            </button>

            {rulesExpanded && (
              <div className="space-y-2">
                {ALERT_RULE_TYPES.map((type) => {
                  const rule = ruleMap.get(type) ?? {
                    enabled: false,
                    graceMinutes: 10,
                    type,
                  };
                  return (
                    <RuleRow key={type} meta={RULE_META[type]} rule={rule} />
                  );
                })}
              </div>
            )}
          </div>

          {/* Delivery override */}
          <div className="rounded-xl border border-white/5 bg-zinc-900/20 p-4 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                checked={showDeliveryOverride}
                className="h-4 w-4 rounded border-white/10 bg-zinc-900 text-sky-400"
                onChange={(e) => setShowDeliveryOverride(e.target.checked)}
                type="checkbox"
              />
              <div>
                <p className="text-[13px] font-medium text-zinc-200">
                  Override delivery settings
                </p>
                <p className="text-[11px] text-zinc-500">
                  Send this policy&apos;s alerts to a different webhook than the global default.
                </p>
              </div>
            </label>

            {showDeliveryOverride ? (
              <div className="space-y-3 pl-6">
                <div className="grid gap-3 lg:grid-cols-[1fr_10rem]">
                  <label className="block">
                    <span className="text-[11px] font-medium text-zinc-400">Webhook URL</span>
                    <input
                      className={fieldClassName}
                      defaultValue={policy?.webhookUrl ?? ""}
                      name="webhookUrl"
                      placeholder="https://..."
                      type="url"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-medium text-zinc-400">Format</span>
                    <select
                      className={fieldClassName}
                      defaultValue={policy?.webhookKind ?? "auto"}
                      name="webhookKind"
                    >
                      <option value="auto">Auto-detect</option>
                      <option value="teams">Microsoft Teams</option>
                      <option value="generic">Generic JSON</option>
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className="text-[11px] font-medium text-zinc-400">
                    Mention recipients (UPN/email)
                  </span>
                  <textarea
                    className={`${fieldClassName} min-h-16 resize-y`}
                    defaultValue={policy?.mentionUserUpns.join("\n") ?? ""}
                    name="mentionUserUpns"
                    placeholder={"user@company.com"}
                  />
                </label>
              </div>
            ) : (
              <>
                <input name="webhookUrl" type="hidden" value="" />
                <input name="webhookKind" type="hidden" value="auto" />
                <input name="mentionUserUpns" type="hidden" value="" />
              </>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-4">
            <Button disabled={isPending} type="submit">
              <Save className="h-3.5 w-3.5" />
              {isPending ? "Saving..." : isNew ? "Create policy" : "Save policy"}
            </Button>

            {!isNew && (
              <>
                <Form action={dupAction}>
                  <input name="siteSlug" type="hidden" value={siteSlug} />
                  <input name="policyId" type="hidden" value={policy.id} />
                  <Button disabled={isDuplicating} type="submit" variant="secondary">
                    <Copy className="h-3.5 w-3.5" />
                    {isDuplicating ? "Duplicating..." : "Duplicate"}
                  </Button>
                </Form>

                <Form action={deleteAction}>
                  <input name="siteSlug" type="hidden" value={siteSlug} />
                  <input name="policyId" type="hidden" value={policy.id} />
                  <ConfirmSubmitButton
                    consequences={[
                      "The conditions this policy watches will stop being evaluated.",
                      "Any alert it currently has firing is cleared.",
                    ]}
                    description={`Delete the alert policy "${policy.name}"?`}
                    disabled={isDeleting}
                    pending={isDeleting}
                    title="Delete alert policy"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {isDeleting ? "Deleting..." : "Delete"}
                  </ConfirmSubmitButton>
                </Form>
              </>
            )}

            {onClose && (
              <Button onClick={onClose} type="button" variant="secondary">
                Cancel
              </Button>
            )}
          </div>
        </Form>
      </CardContent>
    </Card>
  );
}
