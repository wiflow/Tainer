"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

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

      {/* requestSubmit needs this submitter to use formAction instead of the form's action. */}
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
