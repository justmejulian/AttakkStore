import assert from "node:assert/strict";
import { after, test } from "node:test";
import { openTempApi } from "./test-support.js";

// Open the connection before importing the reader: creditor.ts pulls in the
// settings repository, which prepares its statement against the singleton at
// import time.
const { db, cleanup } = await openTempApi();
const { CREDITOR_KEYS, getCreditor } = await import("./creditor.js");

after(() => cleanup());

const setStmt = db.prepare(
  "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
);

test("falls back to placeholders when nothing is configured", () => {
  const creditor = getCreditor();
  // A fresh volume has an empty settings table, so a bill can still be built.
  assert.equal(creditor.name, "ATTAKK");
  assert.equal(creditor.country, "CH");
  assert.match(creditor.account, /^CH\d{19}$/);
});

test("reads configured fields and keeps placeholders for the rest", () => {
  setStmt.run(CREDITOR_KEYS.name, "ATTAKK Collective");
  setStmt.run(CREDITOR_KEYS.account, "CH5604835012345678009");

  const creditor = getCreditor();
  assert.equal(creditor.name, "ATTAKK Collective"); // configured
  assert.equal(creditor.account, "CH5604835012345678009"); // configured
  assert.equal(creditor.city, "Zürich"); // still the placeholder
});

test("treats a blank stored field as unset, not an empty value", () => {
  // A row saved as '' is a blank field, not a configured one; it must fall back
  // to the placeholder rather than reach swissqrbill as an empty required field.
  setStmt.run(CREDITOR_KEYS.name, "");
  assert.equal(getCreditor().name, "ATTAKK");
});
