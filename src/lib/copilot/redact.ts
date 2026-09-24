export const REDACTED_SECRET = "[shown once]";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// Generated root passwords are shown once on the result card and must not reach the model or saved chats.
export function redactCredentials(result: unknown): unknown {
  if (!isRecord(result)) return result;
  let out = result;
  if (isRecord(result.credentials) && "value" in result.credentials) {
    out = { ...out, credentials: { ...result.credentials, value: REDACTED_SECRET } };
  }
  if (Array.isArray(result.created)) {
    out = {
      ...out,
      created: result.created.map((item: unknown) =>
        isRecord(item) && "password" in item ? { ...item, password: REDACTED_SECRET } : item,
      ),
    };
  }
  return out;
}
