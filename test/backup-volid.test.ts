import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { validateBackupVolid } from "@/lib/proxmox";

const storage = fc.stringMatching(/^[a-zA-Z0-9._-]{1,63}$/);
const segment = fc.stringMatching(/^[a-zA-Z0-9._:-]{1,20}$/).filter((s) => s !== "." && s !== "..");
const segments = fc.array(segment, { minLength: 1, maxLength: 5 });

const accepts = (volid: string, store: string) => {
  try {
    validateBackupVolid(volid, store);
    return true;
  } catch {
    return false;
  }
};

test("well-formed backup volids are accepted", () => {
  fc.assert(
    fc.property(storage, segments, (store, parts) => {
      const volid = `${store}:backup/${parts.join("/")}`;
      assert.equal(validateBackupVolid(volid, store), volid);
    }),
  );
});

test("dot segments, other storages and stray separators are rejected", () => {
  const tampered = fc
    .tuple(storage, segments, fc.nat(), fc.integer({ min: 0, max: 5 }), storage)
    .map(([store, parts, at, kind, other]) => {
      const i = at % (parts.length + 1);
      const insert = (value: string) => [...parts.slice(0, i), value, ...parts.slice(i)].join("/");
      const volid = [
        `${store}:backup/${insert("..")}`,
        `${store}:backup/${insert(".")}`,
        `${store}:backup/${insert("")}`,
        `${store}:backup/${insert("a\\..")}`,
        `${store}:dump/${parts.join("/")}`,
        `${other}:backup/${parts.join("/")}`,
      ][kind];
      return { volid, store: kind === 5 && other === store ? `${store}x` : store };
    });
  fc.assert(fc.property(tampered, ({ volid, store }) => assert.ok(!accepts(volid, store), volid)));
});

test("any accepted volid stays inside storage:backup/", () => {
  const tail = fc.string({ unit: fc.constantFrom("a", "b", "0", "-", ":", "/", ".", "\\", " ", "%") });
  const raw = fc.oneof(
    fc.string({ unit: "binary" }),
    tail.map((s) => `local:${s}`),
    tail.map((s) => `local:backup/${s}`),
    tail.map((s) => ` local:backup${s}`),
  );
  fc.assert(
    fc.property(raw, (volid) => {
      if (!accepts(volid, "local")) return;
      const path = volid.trim().slice("local:backup/".length);
      assert.ok(volid.trim().startsWith("local:backup/"));
      assert.ok(!path.includes("\\"));
      assert.ok(path.split("/").every((s) => s !== "" && s !== "." && s !== ".."));
    }),
    { numRuns: 2000 },
  );
});
