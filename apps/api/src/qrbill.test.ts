import assert from "node:assert/strict";
import { test } from "node:test";
import type { OrderWithItems } from "@attakk/types";
import type { Creditor } from "swissqrbill/types";
import { rfReference } from "./reference.js";
import { billData, generateQrBill } from "./qrbill.js";

// No database here: billData and generateQrBill are pure over the order and
// creditor they are handed, so the fixtures are plain objects.
const creditor: Creditor = {
  name: "ATTAKK",
  address: "Musterstrasse",
  buildingNumber: "1",
  zip: "8000",
  city: "Zürich",
  country: "CH",
  account: "CH9300762011623852957",
};

const order: OrderWithItems = {
  id: 1,
  reference: rfReference(1),
  token: "0".repeat(32),
  email: "buyer@example.com",
  phone: "",
  total_rappen: 19000,
  status: "pending",
  created_at: "2026-09-19T10:00:00.000Z",
  paid_at: null,
  note: "",
  items: [
    {
      id: 1,
      product_id: 10,
      size_id: 1,
      qty: 2,
      unit_price_rappen: 9500,
      title: "Redline Jersey",
    },
  ],
};

test("prices the bill in francs off the rappen total", () => {
  const data = billData(order, creditor);
  assert.equal(data.amount, 190); // 19000 rappen, not 19000 francs
  assert.equal(data.currency, "CHF");
});

test("carries the order's RF reference and creditor, no debtor", () => {
  const data = billData(order, creditor);
  assert.equal(data.reference, order.reference);
  assert.deepEqual(data.creditor, creditor);
  assert.equal(data.debtor, undefined); // pickup only, no payer address
});

test("renders a PDF swissqrbill accepts for our RF reference + IBAN", async () => {
  const pdf = await generateQrBill(order, creditor);
  // A real PDF, not an empty or error buffer. Reaching here at all proves the
  // standard IBAN and RF reference passed swissqrbill's constructor validation.
  assert.ok(pdf.length > 1000);
  assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
});

test("rejects, rather than throws, when the creditor data is invalid", async () => {
  const badCreditor = { ...creditor, account: "CH00INVALIDIBAN000000" };
  // The promise is passed in already invoked (not a thunk) on purpose: a
  // synchronous throw would fail on this line before assert.rejects saw it, so
  // this pins the Promise<Buffer> contract, not just that some error surfaces.
  await assert.rejects(generateQrBill(order, badCreditor), /IBAN/);
});
