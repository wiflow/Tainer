"use client";

import { useActionState, useState } from "react";
import { Eraser, Pencil, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteLldpAnnotationAction,
  upsertLldpAnnotationAction,
} from "@/app/network-actions";
import { initialBasicActionState } from "@/lib/action-states";
import type { LldpDeviceAnnotation } from "@/lib/lldp-types";

type Props = {
  siteSlug: string;
  chassisId: string;
  annotation: LldpDeviceAnnotation | null;
  canEdit: boolean;
};

export function NetworkDeviceAnnotationForm({
  siteSlug,
  chassisId,
  annotation,
  canEdit,
}: Props) {
  const [editing, setEditing] = useState(annotation == null);
  const [saveState, saveAction, savePending] = useActionState(
    upsertLldpAnnotationAction,
    initialBasicActionState,
  );
  const [clearState, clearAction, clearPending] = useActionState(
    deleteLldpAnnotationAction,
    initialBasicActionState,
  );

  if (!canEdit && annotation == null) {
    return null;
  }

  if (!editing && annotation) {
    return (
      <section className="rounded-xl border border-white/[0.06] bg-zinc-950/40">
        <header className="flex items-center justify-between border-b border-white/[0.04] px-4 py-2.5">
          <h3 className="text-[12.5px] font-medium text-zinc-100">Operator notes</h3>
          {canEdit ? (
            <Button onClick={() => setEditing(true)} size="sm" variant="ghost">
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </Button>
          ) : null}
        </header>
        <dl className="grid grid-cols-1 gap-3 px-4 py-3 text-[12px] sm:grid-cols-3">
          {annotation.friendlyName ? (
            <div>
              <dt className="text-[10.5px] uppercase tracking-[0.14em] text-zinc-500">
                Friendly name
              </dt>
              <dd className="mt-0.5 text-zinc-200">{annotation.friendlyName}</dd>
            </div>
          ) : null}
          {annotation.portCountOverride ? (
            <div>
              <dt className="text-[10.5px] uppercase tracking-[0.14em] text-zinc-500">
                Port count
              </dt>
              <dd className="mt-0.5 text-zinc-200">
                {annotation.portCountOverride}{" "}
                <span className="text-zinc-500">(manual)</span>
              </dd>
            </div>
          ) : null}
          {annotation.notes ? (
            <div className="sm:col-span-3">
              <dt className="text-[10.5px] uppercase tracking-[0.14em] text-zinc-500">
                Notes
              </dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-zinc-300">
                {annotation.notes}
              </dd>
            </div>
          ) : null}
          <div className="sm:col-span-3 text-[10.5px] text-zinc-500">
            Last updated {formatDate(annotation.updatedAt)} by {annotation.updatedBy}
          </div>
        </dl>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-white/[0.06] bg-zinc-950/40">
      <header className="border-b border-white/[0.04] px-4 py-2.5">
        <h3 className="text-[12.5px] font-medium text-zinc-100">Operator notes</h3>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          Override LLDP-advertised values (e.g. when the chassis reports an unhelpful name
          or the front-panel inference looks wrong). Leave fields blank to fall back to
          the LLDP values.
        </p>
      </header>
      <form action={saveAction} className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-3">
        <input name="siteSlug" type="hidden" value={siteSlug} />
        <input name="chassisId" type="hidden" value={chassisId} />
        <div className="sm:col-span-2">
          <label
            className="mb-1 block text-[10.5px] uppercase tracking-[0.14em] text-zinc-500"
            htmlFor="lldp-annotation-name"
          >
            Friendly name
          </label>
          <Input
            id="lldp-annotation-name"
            name="friendlyName"
            placeholder="e.g. Rack-3 ToR"
            defaultValue={annotation?.friendlyName ?? ""}
            className="bg-white/[0.03] text-zinc-100"
          />
        </div>
        <div>
          <label
            className="mb-1 block text-[10.5px] uppercase tracking-[0.14em] text-zinc-500"
            htmlFor="lldp-annotation-portcount"
          >
            Port count override
          </label>
          <Input
            id="lldp-annotation-portcount"
            name="portCountOverride"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="auto"
            defaultValue={annotation?.portCountOverride?.toString() ?? ""}
            className="bg-white/[0.03] text-zinc-100"
          />
        </div>
        <div className="sm:col-span-3">
          <label
            className="mb-1 block text-[10.5px] uppercase tracking-[0.14em] text-zinc-500"
            htmlFor="lldp-annotation-notes"
          >
            Notes
          </label>
          <Textarea
            id="lldp-annotation-notes"
            name="notes"
            rows={3}
            defaultValue={annotation?.notes ?? ""}
            placeholder="Free-form notes shown on this device detail page."
            className="bg-white/[0.03] text-zinc-100"
          />
        </div>
        <div className="sm:col-span-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.04] pt-3">
          <div className="text-[11px]">
            {saveState.status === "success" ? (
              <span className="text-emerald-300">{saveState.message}</span>
            ) : saveState.status === "error" ? (
              <span className="text-rose-300">{saveState.message}</span>
            ) : clearState.status !== "idle" ? (
              <span
                className={
                  clearState.status === "error"
                    ? "text-rose-300"
                    : "text-emerald-300"
                }
              >
                {clearState.message}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {annotation ? (
              <Button
                disabled={clearPending}
                formAction={clearAction}
                size="sm"
                type="submit"
                variant="ghost"
              >
                <Eraser className="mr-1.5 h-3.5 w-3.5" />
                {clearPending ? "Clearing…" : "Clear"}
              </Button>
            ) : null}
            <Button onClick={() => setEditing(false)} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
            <Button disabled={savePending} size="sm" type="submit" variant="accent">
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {savePending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
