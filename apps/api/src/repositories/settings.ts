import type { Settings } from "@attakk/types";
import { db } from "../db.js";

// The settings table is a plain key/value store the admin's Settings screen
// writes: shop open or closed, the creditor details for the bill, the
// notification address. All SQL stays in this repository, never in a caller.

// The storage keys, one per Settings field, kept here so the reader, the writer
// and the creditor (which reads a subset) all name the same rows. The keys are
// the Settings field names verbatim, so a row maps one-to-one onto the object.
export const SETTINGS_KEYS = {
  shop_open: "shop_open",
  creditor_name: "creditor_name",
  creditor_address: "creditor_address",
  creditor_building_number: "creditor_building_number",
  creditor_zip: "creditor_zip",
  creditor_city: "creditor_city",
  creditor_country: "creditor_country",
  creditor_account: "creditor_account",
  notify_email: "notify_email",
} as const;

const getStmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);

// The stored string, or undefined when the key was never set. A fresh volume
// has an empty table, so every getter needs to cope with a missing key —
// callers supply their own fallback rather than this returning ''.
export function getSetting(key: string): string | undefined {
  const row = getStmt.get(key) as { value: string } | undefined;
  return row?.value;
}

const allStmt = db.prepare(`SELECT key, value FROM settings`);

// The whole settings object the admin's Settings screen reads, in one query. A
// missing key reads as its empty default: shop closed (a fresh shop does not take
// orders until it is opened), every text field blank. Blank creditor fields are
// shown as blank — the placeholder fallback is the bill's business (see
// creditor.ts), not the form's, so the admin can see which fields are configured.
export function getAllSettings(): Settings {
  const rows = allStmt.all() as { key: string; value: string }[];
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const text = (key: string): string => stored.get(key) ?? "";
  return {
    shop_open: stored.get(SETTINGS_KEYS.shop_open) === "1",
    creditor_name: text(SETTINGS_KEYS.creditor_name),
    creditor_address: text(SETTINGS_KEYS.creditor_address),
    creditor_building_number: text(SETTINGS_KEYS.creditor_building_number),
    creditor_zip: text(SETTINGS_KEYS.creditor_zip),
    creditor_city: text(SETTINGS_KEYS.creditor_city),
    creditor_country: text(SETTINGS_KEYS.creditor_country),
    creditor_account: text(SETTINGS_KEYS.creditor_account),
    notify_email: text(SETTINGS_KEYS.notify_email),
  };
}

const upsertStmt = db.prepare(
  `INSERT INTO settings (key, value) VALUES (@key, @value)
   ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
);

// Write every field in one transaction, so a half-written settings table can
// never leave the shop with a new creditor name against an old IBAN. The whole
// object is validated (zod settingsInput) before it reaches here; shop_open is
// stored as the "1"/"0" the reader compares against.
export const saveSettings = db.transaction((settings: Settings): void => {
  upsertStmt.run({
    key: SETTINGS_KEYS.shop_open,
    value: settings.shop_open ? "1" : "0",
  });
  upsertStmt.run({
    key: SETTINGS_KEYS.creditor_name,
    value: settings.creditor_name,
  });
  upsertStmt.run({
    key: SETTINGS_KEYS.creditor_address,
    value: settings.creditor_address,
  });
  upsertStmt.run({
    key: SETTINGS_KEYS.creditor_building_number,
    value: settings.creditor_building_number,
  });
  upsertStmt.run({
    key: SETTINGS_KEYS.creditor_zip,
    value: settings.creditor_zip,
  });
  upsertStmt.run({
    key: SETTINGS_KEYS.creditor_city,
    value: settings.creditor_city,
  });
  upsertStmt.run({
    key: SETTINGS_KEYS.creditor_country,
    value: settings.creditor_country,
  });
  upsertStmt.run({
    key: SETTINGS_KEYS.creditor_account,
    value: settings.creditor_account,
  });
  upsertStmt.run({
    key: SETTINGS_KEYS.notify_email,
    value: settings.notify_email,
  });
});
