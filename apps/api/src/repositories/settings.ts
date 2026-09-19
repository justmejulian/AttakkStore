import { db } from "../db.js";

// The settings table is a plain key/value store the admin's Settings screen
// writes: shop open or closed, the creditor details for the bill, the
// notification address. Only reads live here for now — the write path is the
// admin (a later step). All SQL stays in this repository, never in a caller.

const getStmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);

// The stored string, or undefined when the key was never set. A fresh volume
// has an empty table, so every getter needs to cope with a missing key —
// callers supply their own fallback rather than this returning ''.
export function getSetting(key: string): string | undefined {
  const row = getStmt.get(key) as { value: string } | undefined;
  return row?.value;
}
