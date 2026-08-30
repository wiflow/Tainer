"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * A submit button that asks first. Drop-in for destructive actions that
 * live inside a `<form action={serverAction}>`: the click opens the
 * confirmation, and only a confirmed click submits the surrounding form.
 */
export function ConfirmSubmitButton({
  children,
  className,
  confirmLabel,
  consequences,
  description,
  disabled,
  formAction,
  pending,
  requireTypedName,
  title,
  variant = "secondary",
}: {
  children: React.ReactNode;
  className?: string;
  confirmLabel?: string;
  consequences?: React.ReactNode[];
  description: React.ReactNode;
  disabled?: boolean;
  /** For buttons that override the form's action (e.g. a "remove" next to "save"). */
  formAction?: React.ComponentProps<"button">["formAction"];
  pending?: boolean;
  requireTypedName?: string;
  title: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const [open, setOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const submitterRef = React.useRef<HTMLButtonElement>(null);

  return (
    <>
      <Button
        className={className}
        disabled={disabled}
        onClick={() => setOpen(true)}
        ref={buttonRef}
        type="button"
        variant={variant}
      >
        {children}
      </Button>

      {/* Submitting through this hidden button is what carries `formAction`
          to the form — requestSubmit() without a submitter would fall back
          to the form's own action. */}
      {formAction && (
        <button
          aria-hidden="true"
          className="hidden"
          formAction={formAction}
          formNoValidate
          ref={submitterRef}
          tabIndex={-1}
          type="submit"
        />
      )}

      <ConfirmDialog
        confirmLabel={confirmLabel}
        consequences={consequences}
        description={description}
        onConfirm={() => {
          setOpen(false);
          const form = buttonRef.current?.form;
          // requestSubmit() runs the form's own action and validation,
          // exactly as a real submit click would.
          if (formAction && submitterRef.current) {
            form?.requestSubmit(submitterRef.current);
            return;
          }
          form?.requestSubmit();
        }}
        onOpenChange={setOpen}
        open={open}
        pending={pending}
        requireTypedName={requireTypedName}
        title={title}
      />
    </>
  );
}
