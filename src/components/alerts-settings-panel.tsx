"use client";

import { useActionState } from "react";
import { BellRing, Play, Save, Send } from "lucide-react";

import {
  runAlertCheckNowAction,
  sendTestAlertAction,
  updateAlertSettingsAction,
} from "@/app/alert-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialActionState } from "@/lib/action-states";
import type { AlertSettings } from "@/lib/alert-settings";

const fieldClassName =
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
    <label className="flex items-start justify-between gap-4 rounded-md border border-white/5 bg-[#111113] px-4 py-3">
      <div>
        <p className="text-[13px] font-medium text-zinc-200">{label}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{description}</p>
      </div>
      <input
        className="mt-1 h-4 w-4 rounded border-white/10 bg-zinc-900 text-sky-400"
        defaultChecked={defaultChecked}
        name={name}
        type="checkbox"
      />
    </label>
  );
}

export function AlertsSettingsPanel({
  settings,
  siteSlug,
}: {
  settings: AlertSettings;
  siteSlug: string;
}) {
  const [saveState, saveAction, isSavePending] = useActionState(
    updateAlertSettingsAction,
    initialActionState,
  );
  const [testState, testAction, isTestPending] = useActionState(
    sendTestAlertAction,
    initialActionState,
  );
  const [checkState, checkAction, isCheckPending] = useActionState(
    runAlertCheckNowAction,
    initialActionState,
  );

  useActionFlashFeedback(saveState, {
    errorTitle: "Alert settings failed",
    successTitle: "Alert settings saved",
  });
  useActionFlashFeedback(testState, {
    errorTitle: "Test alert failed",
    successTitle: "Test alert sent",
  });
  useActionFlashFeedback(checkState, {
    errorTitle: "Alert check failed",
    successTitle: "Alert check finished",
  });

  return (
    <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
      <Card>
        <CardHeader className="border-b border-white/5">
          <CardTitle>Global settings</CardTitle>
          <CardDescription>
            Master toggle, default webhook, and reminder cadence. Individual policies inherit these unless overridden.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5">
          <Form action={saveAction} className="space-y-5">
            <input name="siteSlug" type="hidden" value={siteSlug} />
            <div className="grid gap-3 lg:grid-cols-2">
              <ToggleField
                defaultChecked={settings.enabled}
                description="Master switch for the alert engine. When off, no policies are evaluated and no webhooks fire."
                label="Enable alerts"
                name="enabled"
              />
              <ToggleField
                defaultChecked={settings.resolveNotificationsEnabled}
                description="Default for new policies. Send a follow-up when an alerting condition clears."
                label="Notify on recovery"
                name="resolveNotificationsEnabled"
              />
            </div>

            <div className="rounded-xl border border-white/5 bg-[#111113] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium text-zinc-200">Default delivery</p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Policies without their own webhook override will use this destination.
                  </p>
                </div>
                <Badge variant={settings.webhookUrl ? "success" : "neutral"}>
                  {settings.webhookUrl ? "Webhook configured" : "No webhook"}
                </Badge>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_12rem]">
                <label className="block">
                  <span className="text-[12px] font-medium text-zinc-400">Webhook URL</span>
                  <input
                    className={fieldClassName}
                    defaultValue={settings.webhookUrl}
                    name="webhookUrl"
                    placeholder="https://..."
                    type="url"
                  />
                </label>

                <label className="block">
                  <span className="text-[12px] font-medium text-zinc-400">Format</span>
                  <select className={fieldClassName} defaultValue={settings.webhookKind} name="webhookKind">
                    <option value="auto">Auto-detect</option>
                    <option value="teams">Microsoft Teams</option>
                    <option value="slack">Slack</option>
                    <option value="discord">Discord</option>
                    <option value="generic">Generic JSON</option>
                  </select>
                </label>
              </div>

              <label className="mt-4 block">
                <span className="text-[12px] font-medium text-zinc-400">Default mention recipients (UPN/email)</span>
                <textarea
                  className={`${fieldClassName} min-h-20 resize-y`}
                  defaultValue={settings.mentionUserUpns.join("\n")}
                  name="mentionUserUpns"
                  placeholder={"user@company.com"}
                />
                <p className="mt-2 text-[11px] text-zinc-500">
                  Comma or newline separated. Policies without their own recipients use these.
                </p>
              </label>
            </div>

            <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Default reminder interval (minutes)</span>
              <input
                className={fieldClassName}
                defaultValue={settings.reminderIntervalMinutes}
                min="5"
                name="reminderIntervalMinutes"
                type="number"
              />
              <p className="mt-2 text-[11px] text-zinc-500">
                Fallback for policies that don&apos;t set their own reminder cadence.
              </p>
            </label>

            <div className="flex flex-wrap gap-2 border-t border-white/5 pt-4">
              <Button disabled={isSavePending} type="submit">
                <Save className="h-3.5 w-3.5" />
                {isSavePending ? "Saving..." : "Save global settings"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader className="border-b border-white/5">
            <CardTitle>Run and test</CardTitle>
            <CardDescription>
              Verify the destination and run the engine on demand without waiting for the scheduler.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-5">
            <Form action={testAction}>
              <input name="siteSlug" type="hidden" value={siteSlug} />
              <Button
                className="w-full justify-center"
                disabled={isTestPending || !settings.webhookUrl}
                type="submit"
                variant="secondary"
              >
                <Send className="h-3.5 w-3.5" />
                {isTestPending ? "Sending test..." : "Send test alert"}
              </Button>
            </Form>

            <Form action={checkAction}>
              <input name="siteSlug" type="hidden" value={siteSlug} />
              <Button
                className="w-full justify-center"
                disabled={isCheckPending}
                type="submit"
                variant="secondary"
              >
                <Play className="h-3.5 w-3.5" />
                {isCheckPending ? "Running check..." : "Run alert check now"}
              </Button>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-white/5">
            <CardTitle>Scheduler</CardTitle>
            <CardDescription>
              Built-in alert scheduler runs automatically inside the Tainer process.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-5 text-[12px] text-zinc-400">
            <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <div className="flex items-center gap-2">
                <BellRing className="h-3.5 w-3.5 text-zinc-500" />
                <p className="text-[12px] font-medium text-zinc-300">Automatic</p>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                The scheduler ticks every 30 seconds and evaluates each policy when its check interval is due. No external cron job required.
              </p>
            </div>
            <p>
              The external endpoint{" "}
              <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">
                GET /api/alerts/check
              </code>{" "}
              is still available if you prefer an external trigger.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
