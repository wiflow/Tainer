export function logText(value) {
  return String(value).replace(/[\r\n\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu, "");
}
