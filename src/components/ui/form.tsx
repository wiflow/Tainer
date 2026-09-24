"use client";

import { type ComponentProps, useTransition } from "react";

/** Form that avoids React 19's automatic field reset after a server action completes. */
export function Form({ action, children, onSubmit, ...rest }: ComponentProps<"form">) {
  const [, startTransition] = useTransition();

  if (typeof action !== "function") {
    return <form action={action} onSubmit={onSubmit} {...rest}>{children}</form>;
  }

  const fn = action;
  return (
    <form
      {...rest}
      action={fn}
      onSubmit={(e) => {
        onSubmit?.(e);
        if (e.defaultPrevented) return;
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
