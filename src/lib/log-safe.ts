import { inspect } from "node:util";

import { logText } from "@/lib/log-text.mjs";

export function logSafe(value: unknown): string {
  const text = typeof value === "string" ? value : inspect(value);
  return logText(text.replace(/[\t\n\r\p{Zl}\p{Zp}]+/gu, " "));
}
