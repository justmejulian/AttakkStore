import assert from "node:assert/strict";
import { test } from "node:test";
import type { OrderListRow } from "@attakk/types";
import { ordersToCsv } from "./csv.js";

function row(overrides: Partial<OrderListRow>): OrderListRow {
  return {
    id: 1,
    reference: "RF74000001",
    email: "buyer@example.com",
    phone: "",
    total_rappen: 9500,
    status: "pending",
    created_at: "2026-01-01T00:00:00.000Z",
    paid_at: null,
    note: "",
    ...overrides,
  };
}

test("the header row leads and is not mangled", () => {
  const csv = ordersToCsv([]);
  assert.equal(csv, "reference,email,status,total_chf,created_at,paid_at,note");
});

test("a formula-triggering email or note is neutralised with a leading apostrophe", () => {
  // A customer email may begin with = or + (both valid in a local part); a note
  // is free text. Either would run as a formula in Excel/Sheets without this.
  const csv = ordersToCsv([row({ email: "=1+1@evil.com", note: "+cmd|calc" })]);
  const line = csv.split("\r\n")[1];
  assert.match(line, /,'=1\+1@evil\.com,/);
  assert.match(line, /,'\+cmd\|calc$/);
});

test("commas and quotes are still quoted per RFC 4180, after neutralising", () => {
  const csv = ordersToCsv([row({ note: '=a,"b"' })]);
  const line = csv.split("\r\n")[1];
  // Leading = -> apostrophe, then the comma forces quoting and the " is doubled.
  assert.match(line, /"'=a,""b"""$/);
});

test("a benign value is passed through untouched", () => {
  const csv = ordersToCsv([row({ email: "buyer@example.com" })]);
  assert.match(csv.split("\r\n")[1], /,buyer@example\.com,/);
});
