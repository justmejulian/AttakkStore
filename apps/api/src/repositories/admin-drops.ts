import type { Drop, DropInput, DropStatus } from "@attakk/types";
import { db } from "../db.js";

// The admin's drop reads and writes. Where the storefront catalogue returns only
// live drops (and their products), the admin sees every drop regardless of status
// — it edits drafts and archives them — so nothing here is filtered. The reads
// back the drops list and the edit form; the writes are create, edit and the
// archive control (a status flip). All SQL lives here.

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

// One drop for the edit form — any status, so a draft or archived collection is
// editable the same as a live one. The bare row, without its products (those are
// the products screen's read); undefined when there is no such drop, so the route
// 404s.
const dropByIdStmt = db.prepare(
  `SELECT ${DROP_COLUMNS} FROM drops WHERE id = ?`,
);

export function getDropForAdmin(id: number): Drop | undefined {
  return dropByIdStmt.get(id) as Drop | undefined;
}

// -------------------------------------------------------------- admin writes

// Why a drop create or edit was refused, for the reason the route turns into a
// 4xx the admin can act on rather than a 500: a slug already in use (drops.slug
// is UNIQUE). Anything else (a broken database) stays a thrown 500. A single code
// today, but the class mirrors ProductError so a later reason has a home.
export type DropErrorCode = "slug_taken";

export class DropError extends Error {
  constructor(readonly code: DropErrorCode) {
    super(code);
    this.name = "DropError";
  }
}

// The slug is the only UNIQUE column on drops, so a unique-constraint failure on
// an insert or update is always a slug clash — mapped to slug_taken rather than a
// 500. Catching the constraint (not a pre-check SELECT) avoids a check-then-write
// race and keeps the DB the single arbiter. Same shape admin-products uses.
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

const insertDropStmt = db.prepare(
  `INSERT INTO drops
     (slug, name, year, no, status, sort, tagline, body, note,
      color_primary, color_secondary, color_accent, color_text,
      display_font, theme_base)
   VALUES
     (@slug, @name, @year, @no, @status, @sort, @tagline, @body, @note,
      @color_primary, @color_secondary, @color_accent, @color_text,
      @display_font, @theme_base)`,
);

// Create a drop. A slug already taken is a slug_taken; on success the stored row
// comes back so the admin lands on its edit screen.
export function createDrop(input: DropInput): Drop {
  let id: number;
  try {
    id = Number(insertDropStmt.run(input).lastInsertRowid);
  } catch (err) {
    if (isUniqueViolation(err)) throw new DropError("slug_taken");
    throw err;
  }
  const drop = getDropForAdmin(id);
  if (!drop) throw new Error(`drop ${id} missing right after insert`);
  return drop;
}

const updateDropStmt = db.prepare(
  `UPDATE drops SET
     slug = @slug, name = @name, year = @year, no = @no, status = @status,
     sort = @sort, tagline = @tagline, body = @body, note = @note,
     color_primary = @color_primary, color_secondary = @color_secondary,
     color_accent = @color_accent, color_text = @color_text,
     display_font = @display_font, theme_base = @theme_base
   WHERE id = @id`,
);

// Update a drop's fields, status included — the archive control is just a status
// change through the same door, though the admin also has a dedicated status
// endpoint. Returns undefined when no such drop exists, so the route 404s; a slug
// taken by another drop is a slug_taken. Re-saving a drop with its own unchanged
// slug is fine — the UPDATE matches the same row, not a clash.
export function updateDrop(id: number, input: DropInput): Drop | undefined {
  if (dropByIdStmt.get(id) === undefined) return undefined;
  try {
    updateDropStmt.run({ ...input, id });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DropError("slug_taken");
    throw err;
  }
  return getDropForAdmin(id);
}

const setDropStatusStmt = db.prepare(
  `UPDATE drops SET status = @status WHERE id = @id`,
);

// Move a drop between draft, live and archived — the archive control the drops
// list saves on change, without opening the edit form. Reversible: only the
// status column changes, so archiving and un-archiving leave every other field
// (and every order for the drop) untouched. Returns undefined when no such drop
// exists, so the route 404s. No slug clash is possible, so no DropError here.
export function setDropStatus(
  id: number,
  status: DropStatus,
): Drop | undefined {
  if (dropByIdStmt.get(id) === undefined) return undefined;
  setDropStatusStmt.run({ id, status });
  return getDropForAdmin(id);
}
