"use client";

import { type ComponentProps, useTransition } from "react";

/**
 * Drop-in `<form>` replacement that prevents React 19's automatic field
 * reset after server-action completion, preserving values on validation errors.
 *
 * Uses the native form `action` attribute to maintain Next.js CSRF protection
 * while suppressing the default reset behavior by managing submission via
 * `useTransition`.
 */
export function Form({ action, children, ...rest }: ComponentProps<"form">) {
  const [, startTransition] = useTransition();

  if (typeof action !== "function") {
    return <form action={action} {...rest}>{children}</form>;
  }

  const fn = action;
  return (
    <form
      {...rest}
      action={fn}
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(() => {
          fn(new FormData(e.currentTarget));
        });
      }}
    >
      {children}
    </form>
  );
}
