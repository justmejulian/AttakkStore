import { settingsInput } from "@attakk/types";
import { Hono } from "hono";
import { getAllSettings, saveSettings } from "../repositories/settings.js";

// The admin's Settings screen, reached over the internal network: read the whole
// settings object for the form, and save it back. Like the other admin routes it
// carries no auth of its own; the session gate is the admin app's and the private
// network is the boundary. No SQL here; the repository owns it.
export const adminSettings = new Hono();

adminSettings.get("/admin/settings", (c) => c.json(getAllSettings()));

// Save the whole settings object. A bad body is a 400 with the zod issues (a
// mistyped IBAN, an empty required check); on success the stored settings come
// back so the form re-renders from what actually landed — the IBAN normalised,
// shop_open as the boolean the reader compares. The write is one transaction, so
// a partial save can never leave a new creditor name against an old IBAN.
adminSettings.put("/admin/settings", async (c) => {
  const parsed = settingsInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  }
  saveSettings(parsed.data);
  return c.json(getAllSettings());
});
