import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Settings } from "@attakk/types";
import { openTempApi } from "../test-support.js";

const { cleanup } = await openTempApi();
const { adminSettings } = await import("./admin-settings.js");

after(() => cleanup());

function put(body: unknown): Promise<Response> {
  return Promise.resolve(
    adminSettings.request("/admin/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const validSettings = {
  shop_open: true,
  creditor_name: "ATTAKK Collective",
  creditor_address: "Musterstrasse",
  creditor_building_number: "1",
  creditor_zip: "8000",
  creditor_city: "Zürich",
  creditor_country: "CH",
  creditor_account: "CH5604835012345678009",
  notify_email: "shop@attakk.example",
};

test("GET /admin/settings returns the empty defaults on a fresh table", async () => {
  const res = await adminSettings.request("/admin/settings");
  assert.equal(res.status, 200);
  const settings = (await res.json()) as Settings;
  // A fresh volume has an empty settings table: shop closed, every field blank.
  assert.equal(settings.shop_open, false);
  assert.equal(settings.creditor_name, "");
  assert.equal(settings.creditor_account, "");
});

test("PUT /admin/settings saves and reads back the stored object", async () => {
  const res = await put(validSettings);
  assert.equal(res.status, 200);
  const saved = (await res.json()) as Settings;
  assert.equal(saved.shop_open, true);
  assert.equal(saved.creditor_name, "ATTAKK Collective");
  assert.equal(saved.notify_email, "shop@attakk.example");

  // The write persists: a fresh GET reads the same object back.
  const read = (await (
    await adminSettings.request("/admin/settings")
  ).json()) as Settings;
  assert.equal(read.shop_open, true);
  assert.equal(read.creditor_account, "CH5604835012345678009");
});

test("PUT /admin/settings normalises a spaced, lower-case IBAN", async () => {
  const res = await put({
    ...validSettings,
    creditor_account: "ch56 0483 5012 3456 7800 9",
  });
  assert.equal(res.status, 200);
  const saved = (await res.json()) as Settings;
  // Stored without spaces and upper-cased, so it reaches swissqrbill clean.
  assert.equal(saved.creditor_account, "CH5604835012345678009");
});

test("PUT /admin/settings rejects a bad IBAN checksum with a 400", async () => {
  const res = await put({
    ...validSettings,
    creditor_account: "CH5604835012345678000",
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "invalid");
});

test("PUT /admin/settings rejects a checksum-valid QR-IBAN with a 400", async () => {
  // A QR-IBAN (IID 30000–31999) passes the checksum but would make swissqrbill
  // demand a QR reference and throw on our RF one, so it must not be storable.
  const res = await put({
    ...validSettings,
    creditor_account: "CH4431999123000889012",
  });
  assert.equal(res.status, 400);
});

test("PUT /admin/settings rejects a bad email with a 400", async () => {
  const res = await put({ ...validSettings, notify_email: "not-an-email" });
  assert.equal(res.status, 400);
});

test("PUT /admin/settings rejects a non-CH creditor country with a 400", async () => {
  // The creditor is the Swiss shop; a non-CH code would only fail at bill time.
  const res = await put({ ...validSettings, creditor_country: "DE" });
  assert.equal(res.status, 400);
});

test("PUT /admin/settings accepts blank creditor fields", async () => {
  // Blank means "not configured"; the bill falls back to placeholders, so a
  // half-filled form is allowed to save rather than forcing every field up front.
  const res = await put({
    shop_open: false,
    creditor_name: "",
    creditor_address: "",
    creditor_building_number: "",
    creditor_zip: "",
    creditor_city: "",
    creditor_country: "",
    creditor_account: "",
    notify_email: "",
  });
  assert.equal(res.status, 200);
  const saved = (await res.json()) as Settings;
  assert.equal(saved.shop_open, false);
  assert.equal(saved.creditor_account, "");
});

test("PUT /admin/settings rejects a non-object body with a 400", async () => {
  const res = await put(null);
  assert.equal(res.status, 400);
});
