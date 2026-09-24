import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { isAcceptableLoginEmail } from "@/lib/auth";
import { isEmailAllowed as idpEmailAllowed } from "@/lib/idp-providers";
import { isEmailAllowed as ldapEmailAllowed } from "@/lib/ldap-config";
import { oidcFlowCookieHelpers, type OidcFlowState } from "@/lib/oidc";

process.env.AUTH_SECRET = "property-test-secret";

const domain = fc.domain().map((d) => d.toLowerCase());

for (const [name, isEmailAllowed] of [["idp", idpEmailAllowed], ["ldap", ldapEmailAllowed]] as const) {
  test(`${name} domain allowlist only matches the part after the last @`, () => {
    fc.assert(
      fc.property(fc.string(), fc.uniqueArray(domain, { minLength: 1, maxLength: 3 }), domain, (local, allowed, other) => {
        const list = allowed.join(", ");
        assert.ok(isEmailAllowed(`${local}@${allowed[0].toUpperCase()}`, list));
        assert.equal(isEmailAllowed(`${local}@${allowed[0]}@${other}`, list), allowed.includes(other));
      }),
    );
  });
}

test("accepted login emails have one @ and no whitespace or control characters", () => {
  const noise = fc.string({ unit: fc.constantFrom("@", " ", "\n", "\0", ".", "a") });
  const candidate = fc.oneof(
    fc.string({ unit: "binary" }),
    fc.tuple(fc.emailAddress(), noise, fc.nat()).map(([e, n, at]) => e.slice(0, at % 40) + n + e.slice(at % 40)),
  );
  fc.assert(
    fc.property(candidate, (raw) => {
      if (!isAcceptableLoginEmail(raw)) return;
      const email = raw.trim();
      assert.ok(email.length <= 254);
      assert.equal(email.split("@").length, 2);
      assert.doesNotMatch(email, /[\s\u0000-\u001f\u007f]/);
    }),
    { numRuns: 1000 },
  );
  fc.assert(
    fc.property(fc.emailAddress().filter((e) => e.length <= 254), (email) => assert.ok(isAcceptableLoginEmail(email))),
  );
});

const flowState = fc.record({
  providerId: fc.string(),
  state: fc.string(),
  nonce: fc.string(),
  codeVerifier: fc.string(),
  returnTo: fc.string({ unit: "binary" }),
});

test("OIDC flow cookie round-trips and rejects forged payloads", async () => {
  await fc.assert(
    fc.asyncProperty(flowState, fc.nat(), fc.string({ minLength: 1, maxLength: 1 }), async (raw, at, ch) => {
      const state: OidcFlowState = { ...raw, issuedAt: Date.now() };
      const cookie = await oidcFlowCookieHelpers.sign(state);
      assert.deepEqual(await oidcFlowCookieHelpers.verify(cookie), state);
      const i = at % cookie.length;
      const tampered = cookie.slice(0, i) + ch + cookie.slice(i + 1);
      const verified = await oidcFlowCookieHelpers.verify(tampered);
      if (verified !== null) assert.deepEqual(verified, state);
    }),
  );
});
