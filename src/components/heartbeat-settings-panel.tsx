"use client";

import { useActionState } from "react";

import {
  runHeartbeatCheckNowAction,
  saveHeartbeatSettingsAction,
  sendTestHeartbeatWebhookAction,
} from "@/app/heartbeat-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import type { HeartbeatSettings } from "@/lib/heartbeat-settings";

const inputClassName =
  "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

function ToggleField({
  defaultChecked,
  description,
  label,
  name,
}: {
  defaultChecked: boolean;
  description: string;
  label: string;
  name: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-white/5 bg-[#111113] px-4 py-3 transition-colors hover:border-white/10">
      <div>
        <p className="text-[13px] font-medium text-zinc-200">{label}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{description}</p>
      </div>
      <input
        className="mt-1 h-4 w-4 rounded border-white/10 bg-zinc-900 text-white accent-white"
        defaultChecked={defaultChecked}
        name={name}
        type="checkbox"
        value="true"
      />
    </label>
  );
}

export function HeartbeatSettingsPanel({
  settings,
}: {
  settings: HeartbeatSettings;
}) {
  const [saveState, saveAction, isSavePending] = useActionState(
    saveHeartbeatSettingsAction,
    initialBasicActionState,
  );
  const [testState, testAction, isTestPending] = useActionState(
    sendTestHeartbeatWebhookAction,
    initialBasicActionState,
  );
  const [checkState, checkAction, isCheckPending] = useActionState(
    runHeartbeatCheckNowAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(saveState, {
    errorTitle: "Heartbeat settings failed",
    successTitle: "Heartbeat settings saved",
  });
  useActionFlashFeedback(testState, {
    errorTitle: "Test webhook failed",
    successTitle: "Test webhook sent",
  });
  useActionFlashFeedback(checkState, {
    errorTitle: "Heartbeat check failed",
    successTitle: "Heartbeat check complete",
  });

  return (
    <Card>
      <CardHeader className="border-b border-white/5">
        <CardTitle>Heartbeat Settings</CardTitle>
        <CardDescription>
          Configure how Tainer monitors site connectivity and cluster health.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5 space-y-6">
        <Form action={saveAction} className="space-y-5">
          <ToggleField
            defaultChecked={settings.enabled}
            description="Enable automatic heartbeat monitoring for all sites."
            label="Enable heartbeat monitoring"
            name="enabled"
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block rounded-lg border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Check interval (seconds)</span>
              <input
                className={inputClassName}
                defaultValue={settings.checkIntervalSeconds}
                max={3600}
                min={10}
                name="checkIntervalSeconds"
                type="number"
              />
            </label>

            <label className="block rounded-lg border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Staleness threshold (minutes)</span>
              <input
                className={inputClassName}
                defaultValue={settings.stalenessThresholdMinutes}
                max={60}
                min={1}
                name="stalenessThresholdMinutes"
                type="number"
              />
              <p className="mt-1 text-[11px] text-zinc-500">Alert if last successful check exceeds this.</p>
            </label>

            <label className="block rounded-lg border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Node CPU threshold (%)</span>
              <input
                className={inputClassName}
                defaultValue={settings.nodeHighCpuThreshold}
                max={100}
                min={1}
                name="nodeHighCpuThreshold"
                type="number"
              />
            </label>

            <label className="block rounded-lg border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Node memory threshold (%)</span>
              <input
                className={inputClassName}
                defaultValue={settings.nodeHighMemoryThreshold}
                max={100}
                min={1}
                name="nodeHighMemoryThreshold"
                type="number"
              />
            </label>

            <label className="block rounded-lg border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Grace period (minutes)</span>
              <input
                className={inputClassName}
                defaultValue={settings.graceMinutes}
                max={60}
                min={1}
                name="graceMinutes"
                type="number"
              />
              <p className="mt-1 text-[11px] text-zinc-500">Wait this long before sending the first notification.</p>
            </label>

            <label className="block rounded-lg border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Reminder interval (minutes)</span>
              <input
                className={inputClassName}
                defaultValue={settings.reminderIntervalMinutes}
                max={10080}
                min={5}
                name="reminderIntervalMinutes"
                type="number"
              />
              <p className="mt-1 text-[11px] text-zinc-500">Min time between repeat notifications for the same alert.</p>
            </label>
          </div>

          <ToggleField
            defaultChecked={settings.resolveNotificationsEnabled}
            description="Send a notification when a heartbeat alert is resolved."
            label="Resolve notifications"
            name="resolveNotificationsEnabled"
          />

          <div className="border-t border-white/5 pt-5">
            <p className="mb-3 text-[13px] font-medium text-zinc-200">Webhook</p>

            <div className="grid gap-4 lg:grid-cols-2">
              <label className="block rounded-lg border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">Webhook URL</span>
                <input
                  className={inputClassName}
                  defaultValue={settings.webhookUrl}
                  name="webhookUrl"
                  placeholder="https://hooks.slack.com/..."
                  type="url"
                />
              </label>

              <label className="block rounded-lg border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">Webhook type</span>
                <select className={inputClassName} defaultValue={settings.webhookKind} name="webhookKind">
                  <option value="auto">Auto-detect</option>
                  <option value="slack">Slack</option>
                  <option value="teams">Teams</option>
                  <option value="discord">Discord</option>
                  <option value="generic">Generic JSON</option>
                </select>
              </label>
            </div>

            <label className="mt-4 block rounded-lg border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Mention users (comma-separated UPNs)</span>
              <input
                className={inputClassName}
                defaultValue={settings.mentionUserUpns.join(", ")}
                name="mentionUserUpns"
                placeholder="user@example.com, admin@example.com"
                type="text"
              />
            </label>
          </div>

          <div className="flex gap-2 border-t border-white/5 pt-4">
            <Button disabled={isSavePending} type="submit">
              {isSavePending ? "Saving..." : "Save settings"}
            </Button>
          </div>
        </Form>

        <div className="flex gap-2 border-t border-white/5 pt-4">
          <Form action={testAction}>
            <input name="webhookUrl" type="hidden" value={settings.webhookUrl} />
            <input name="webhookKind" type="hidden" value={settings.webhookKind} />
            <Button disabled={isTestPending} type="submit" variant="secondary">
              {isTestPending ? "Sending..." : "Test webhook"}
            </Button>
          </Form>
          <Form action={checkAction}>
            <Button disabled={isCheckPending} type="submit" variant="secondary">
              {isCheckPending ? "Checking..." : "Check now"}
            </Button>
          </Form>
        </div>
      </CardContent>
    </Card>
  );
}
