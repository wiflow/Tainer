"use client";

import type { ComponentProps } from "react";
import { useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type IntentLinkProps = Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & {
  href: string;
  prefetch?: boolean;
};

export function IntentLink({
  href,
  onFocus,
  onMouseEnter,
  onTouchStart,
  prefetch = true,
  ...props
}: IntentLinkProps) {
  const router = useRouter();
  const warmedRef = useRef(false);

  function warmRoute() {
    if (!prefetch || warmedRef.current) {
      return;
    }

    warmedRef.current = true;
    router.prefetch(href);
  }

  return (
    <Link
      {...props}
      href={href}
      onFocus={(event) => {
        warmRoute();
        onFocus?.(event);
      }}
      onMouseEnter={(event) => {
        warmRoute();
        onMouseEnter?.(event);
      }}
      onTouchStart={(event) => {
        warmRoute();
        onTouchStart?.(event);
      }}
      prefetch={false}
    />
  );
}
