import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { detectWebhookKind } from "@/lib/webhook-dispatch";

const detect = (url: string) => detectWebhookKind(url, "auto");

test("detectWebhookKind recognises the real service hosts", () => {
  assert.equal(detect("https://contoso.webhook.office.com/webhookb2/abc"), "teams");
  assert.equal(detect("https://outlook.office.com/webhook/abc"), "teams");
  assert.equal(detect("https://prod-01.westeurope.logic.azure.com/workflows/abc"), "teams");
  assert.equal(detect("https://example.com/IncomingWebhook/abc"), "teams");
  assert.equal(detect("https://hooks.slack.com/services/T0/B0/x"), "slack");
  assert.equal(detect("https://discord.com/api/webhooks/1/x"), "discord");
  assert.equal(detect("https://canary.discord.com/api/webhooks/1/x"), "discord");
  assert.equal(detect("https://discordapp.com/api/webhooks/1/x"), "discord");
  assert.equal(detect("https://discord.com/channels/1"), "generic");
  assert.equal(detect("not a url"), "generic");
  assert.equal(detect("https://HOOKS.SLACK.COM/services/x"), "slack");
});

test("detectWebhookKind honours an explicit kind", () => {
  assert.equal(detectWebhookKind("https://hooks.slack.com/services/x", "discord"), "discord");
});

const label = fc.stringMatching(/^[a-z0-9]{1,12}$/);
const services = [
  { domain: "office.com", kind: "teams" },
  { domain: "logic.azure.com", kind: "teams" },
  { domain: "hooks.slack.com", kind: "slack" },
  { domain: "discord.com", kind: "discord" },
  { domain: "discordapp.com", kind: "discord" },
] as const;

test("a host that only contains a service domain never matches that service", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...services),
      label,
      fc.array(label, { minLength: 1, maxLength: 3 }),
      fc.boolean(),
      ({ domain, kind }, prefix, suffix, asPrefix) => {
        const host = `${asPrefix ? prefix : ""}${domain}.${suffix.join(".")}.example`;
        assert.notEqual(detect(`https://${host}/api/webhooks/1/x`), kind);
        assert.notEqual(detect(`https://${prefix}${domain}/api/webhooks/1/x`), kind);
      },
    ),
  );
});

test("hooks.slack.com.evil.example is not treated as Slack", () => {
  assert.equal(detect("https://hooks.slack.com.evil.example/services/x"), "generic");
  assert.equal(detect("https://evil.example/?hooks.slack.com"), "generic");
});
