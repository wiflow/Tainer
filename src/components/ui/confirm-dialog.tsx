"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * Confirmation for destructive actions, replacing `window.confirm`.
 *
 * Beyond looking like the rest of the app, this can do what the native
 * dialog can't: spell out the blast radius, and — for anything that
 * destroys data we can't get back — demand the resource's name typed out,
 * so a reflexive Enter can't delete something.
 */
export function ConfirmDialog({
  confirmLabel = "Delete",
  consequences,
  description,
  onConfirm,
  onOpenChange,
  open,
  pending,
  requireTypedName,
  title,
}: {
  confirmLabel?: string;
  /** Bullet list of what will happen; shown above the confirm button. */
  consequences?: React.ReactNode[];
  description: React.ReactNode;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pending?: boolean;
  /** When set, the button unlocks only once this exact string is typed. */
  requireTypedName?: string;
  title: string;
}) {
  const [typed, setTyped] = React.useState("");

  // Reset the challenge whenever the dialog is dismissed, so reopening it
  // never starts pre-armed.
  React.useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const unlocked = !requireTypedName || typed.trim() === requireTypedName;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-rose-500/10 text-rose-300">
              <AlertTriangle className="size-4" />
            </span>
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {consequences && consequences.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-white/5 bg-black/30 px-3 py-2.5">
            {consequences.map((item, index) => (
              <li className="flex gap-2 text-[12px] text-zinc-400" key={index}>
                <span aria-hidden="true" className="text-zinc-600">
                  •
                </span>
                {item}
              </li>
            ))}
          </ul>
        )}

        {requireTypedName && (
          <div>
            <label className="text-[12px] text-zinc-400" htmlFor="confirm-typed-name">
              Type <span className="font-medium text-zinc-200">{requireTypedName}</span> to confirm
            </label>
            <Input
              autoComplete="off"
              className="mt-1.5"
              id="confirm-typed-name"
              onChange={(event) => setTyped(event.target.value)}
              value={typed}
            />
          </div>
        )}

        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            size="sm"
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={!unlocked || pending}
            onClick={onConfirm}
            size="sm"
            type="button"
            variant="danger"
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
