import assert from "node:assert/strict";
import { test } from "node:test";
import { rfReference } from "./reference.js";

// Recompute the ISO 7064 mod-97-10 checksum the verifying way: move the leading
// "RF" and its two check digits to the end, expand letters, and a valid
// reference leaves remainder 1. This is what a bank does with the pasted value.
function isValid(reference: string): boolean {
  const rearranged = reference.slice(4) + reference.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const expanded = code >= 65 && code <= 90 ? String(code - 55) : ch;
    for (const digit of expanded) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

test("matches the canonical ISO 11649 example", () => {
  // The reference body is normally a padded order id, but the algorithm is the
  // same for any body — 539007547034 is the standard's own worked example.
  assert.equal(rfReference(539007547034), "RF18539007547034");
});

test("pads a small order id to a stable width", () => {
  assert.match(rfReference(1), /^RF\d{2}000001$/);
});

test("every generated reference passes its own check", () => {
  for (const id of [1, 2, 42, 999, 123456, 7654321]) {
    assert.ok(isValid(rfReference(id)), `invalid reference for id ${id}`);
  }
});
