import type { Drop } from "@attakk/types";
import { db } from "../db.js";

// The admin's drop reads. Where the storefront catalogue returns only live drops
// (and their products), the admin sees every drop regardless of status — it edits
// drafts and archives them — so nothing here is filtered. This is the read the
// product create form needs to offer a drop to create into; drop editing and the
// archive control land in the drops step. All SQL lives here.

// Explicit column list (not SELECT *) so the response shape is a deliberate
// contract. A copy of the catalogue's list, but without the p-prefix and status
// filter — two small copies is fine.
const DROP_COLUMNS = `
  id, slug, name, year, no, status, sort, tagline, body, note,
  color_primary, color_secondary, color_accent, color_text,
  display_font, theme_base
`;

const listDropsStmt = db.prepare(
  `SELECT ${DROP_COLUMNS} FROM drops ORDER BY sort, id`,
);

export function listDropsForAdmin(): Drop[] {
  return listDropsStmt.all() as Drop[];
}
