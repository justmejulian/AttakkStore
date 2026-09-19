import type { Creditor } from "swissqrbill/types";
import { getSetting } from "./repositories/settings.js";

// The creditor is who the QR bill is paid to: the shop's name, address and
// IBAN. It is edited on the admin's Settings screen (a later step) and stored
// in the settings table, so filling in the real details is a form save, not a
// deploy. Until then a fresh shop falls back to placeholders — the plan's "real
// ones later" — so a bill can always be generated in dev and on staging.
//
// The IBAN here is a standard one, not a QR-IBAN, which is why the bill carries
// an RF creditor reference rather than a QR reference (see reference.ts). The
// placeholder is a checksum-valid standard CH IBAN — deliberately not one whose
// IID falls in the 30000–31999 QR-IBAN range, since a QR-IBAN would make
// swissqrbill demand a QR reference and reject our RF one. The admin screen
// checksum-validates the real IBAN before it is ever saved.

// Settings keys the Settings screen will write. Kept together so the reader and
// the future writer name the same rows.
export const CREDITOR_KEYS = {
  name: "creditor_name",
  address: "creditor_address",
  buildingNumber: "creditor_building_number",
  zip: "creditor_zip",
  city: "creditor_city",
  country: "creditor_country",
  account: "creditor_account",
} as const;

const PLACEHOLDER: Creditor = {
  name: "ATTAKK",
  address: "Musterstrasse",
  buildingNumber: "1",
  zip: "8000",
  city: "Zürich",
  country: "CH",
  account: "CH9300762011623852957",
};

// Read each field from settings, falling back per-field to the placeholder when
// it is missing or blank, so a half-configured shop still produces a valid bill
// rather than passing an empty required field to swissqrbill. `||`, not `??`: an
// empty string is a blank field, not a configured value.
export function getCreditor(): Creditor {
  return {
    name: getSetting(CREDITOR_KEYS.name) || PLACEHOLDER.name,
    address: getSetting(CREDITOR_KEYS.address) || PLACEHOLDER.address,
    buildingNumber:
      getSetting(CREDITOR_KEYS.buildingNumber) || PLACEHOLDER.buildingNumber,
    zip: getSetting(CREDITOR_KEYS.zip) || PLACEHOLDER.zip,
    city: getSetting(CREDITOR_KEYS.city) || PLACEHOLDER.city,
    country: getSetting(CREDITOR_KEYS.country) || PLACEHOLDER.country,
    account: getSetting(CREDITOR_KEYS.account) || PLACEHOLDER.account,
  };
}
