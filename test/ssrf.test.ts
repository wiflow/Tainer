import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { assertSafeWebhookUrl, isPrivateAddress } from "@/lib/import-url";

type Octets = [number, number, number, number];

const byte = fc.integer({ min: 0, max: 255 });
const word = fc.integer({ min: 0, max: 0xffff });
const octets = (first: fc.Arbitrary<number>, second: fc.Arbitrary<number> = byte) =>
  fc.tuple(first, second, byte, byte) as fc.Arbitrary<Octets>;

const privateV4 = fc.oneof(
  octets(fc.constantFrom(0, 10, 127)),
  octets(fc.constant(169), fc.constant(254)),
  octets(fc.constant(172), fc.integer({ min: 16, max: 31 })),
  octets(fc.constant(192), fc.constant(168)),
  octets(fc.constant(100), fc.integer({ min: 64, max: 127 })),
  octets(fc.constant(198), fc.constantFrom(18, 19)),
  octets(fc.integer({ min: 224, max: 255 })),
);

const toInt = ([a, b, c, d]: Octets) => ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
const publicV4 = fc.oneof(
  octets(fc.integer({ min: 1, max: 223 }).filter((a) => ![10, 100, 127, 169, 172, 192, 198, 203].includes(a))),
  octets(fc.constant(100), fc.constantFrom(63, 128)),
  octets(fc.constant(169), fc.constantFrom(253, 255)),
  octets(fc.constant(172), fc.constantFrom(15, 32)),
  octets(fc.constant(192), fc.constantFrom(167, 169)),
  octets(fc.constant(198), fc.constantFrom(17, 20)),
);

const dotted = (o: Octets) => o.join(".");
const hexPair = ([a, b, c, d]: Octets) => `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;

const embeddedPrivate = fc
  .tuple(privateV4, fc.integer({ min: 0, max: 7 }), word, fc.boolean())
  .map(([o, form, extra, upper]) => {
    const address = [
      `::ffff:${dotted(o)}`,
      `::ffff:${hexPair(o)}`,
      `0:0:0:0:0:ffff:${hexPair(o)}`,
      `::${dotted(o)}`,
      `::ffff:0:${dotted(o)}`,
      `64:ff9b::${hexPair(o)}`,
      `64:ff9b::${dotted(o)}`,
      `2002:${hexPair(o)}::${extra.toString(16)}`,
    ][form];
    return upper ? address.toUpperCase() : address;
  });

const prefixed = (mask: number, value: number) =>
  fc.tuple(word, fc.array(word, { minLength: 7, maxLength: 7 })).map(
    ([head, rest]) => [((head & ~mask) | value).toString(16), ...rest.map((w) => w.toString(16))].join(":"),
  );

const privateV6 = fc.oneof(
  fc.constantFrom("::", "::1", "0:0:0:0:0:0:0:1"),
  prefixed(0xfe00, 0xfc00),
  prefixed(0xffc0, 0xfe80),
  prefixed(0xff00, 0xff00),
  fc.tuple(word, word).map(([a, b]) => `64:ff9b:1::${a.toString(16)}:${b.toString(16)}`),
  embeddedPrivate,
);

const publicV6 = fc
  .tuple(fc.integer({ min: 0x2003, max: 0x3ffe }), fc.array(word, { minLength: 7, maxLength: 7 }))
  .map(([head, rest]) => [head, ...rest].map((w) => w.toString(16)).join(":"));

test("private IPv4 addresses are refused", () => {
  fc.assert(fc.property(privateV4, (o) => assert.ok(isPrivateAddress(dotted(o)))));
});

test("private IPv6 and IPv6 forms of private IPv4 are refused", () => {
  fc.assert(fc.property(privateV6, (address) => assert.ok(isPrivateAddress(address), address)), { numRuns: 1000 });
});

test("public addresses are accepted", () => {
  fc.assert(fc.property(publicV4, (o) => assert.ok(!isPrivateAddress(dotted(o)))));
  fc.assert(fc.property(publicV6, (address) => assert.ok(!isPrivateAddress(address), address)));
});

test("webhook URLs refuse private IP literals in any encoding and accept public ones", async () => {
  const encoded = fc.tuple(privateV4, fc.integer({ min: 0, max: 2 })).map(([o, form]) =>
    [dotted(o), String(toInt(o)), `0x${toInt(o).toString(16)}`][form],
  );
  await fc.assert(fc.asyncProperty(encoded, (host) => assert.rejects(assertSafeWebhookUrl(`http://${host}/hook`))));
  await fc.assert(
    fc.asyncProperty(privateV6, (address) => assert.rejects(assertSafeWebhookUrl(`https://[${address}]/hook`))),
  );
  await fc.assert(
    fc.asyncProperty(publicV4, async (o) => {
      assert.equal(await assertSafeWebhookUrl(`https://${dotted(o)}/hook`), `https://${dotted(o)}/hook`);
    }),
  );
});
