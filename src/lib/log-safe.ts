import { inspect } from "node:util";

export function logSafe(value: unknown): string {
  const text = typeof value === "string" ? value : inspect(value);
  return text.replace(/[\t\n\r\p{Zl}\p{Zp}]+/gu, " ").replace(/[\n\r\p{Cc}]/gu, "");
}
