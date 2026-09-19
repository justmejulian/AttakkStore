import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "better-sqlite3";

// Opens the API against a throwaway data directory and hands back the migrated
// singleton connection. DATA_DIR has to be set before ./db is first imported —
// db.ts opens and migrates the database as an import side effect — so the
// import is dynamic and callers must await this before importing any module
// that reaches the connection (a repository, a router).
export async function openTempApi(): Promise<{
  db: Database;
  cleanup: () => void;
}> {
  const dir = mkdtempSync(join(tmpdir(), "attakk-api-test-"));
  process.env.DATA_DIR = dir;
  const { db } = await import("./db.js");
  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// One fixture covering every visibility case the catalogue reads care about: a
// live drop holding a live product, a hidden product and out-of-order sizes; an
// archived drop with a live product; and a draft drop that must stay invisible.
export function seedCatalog(db: Database): void {
  db.exec(`
    INSERT INTO drops (id, slug, name, year, no, status, sort) VALUES
      (1, 'redline', 'Redline', 2026, 1, 'live',     0),
      (2, 'origins', 'Origins', 2025, 0, 'archived', 1),
      (3, 'secret',  'Secret',  2026, 2, 'draft',    2);

    INSERT INTO products (id, drop_id, slug, name, price_rappen, status, sort) VALUES
      (10, 1, 'redline-jersey', 'Redline Jersey', 9500, 'live',   0),
      (11, 1, 'redline-hidden', 'Hidden One',     9500, 'hidden', 1),
      (12, 2, 'origins-tee',    'Origins Tee',    6500, 'live',   0),
      (13, 3, 'secret-prod',    'Secret Prod',     100, 'live',   0);

    INSERT INTO product_sizes (product_id, label, sort) VALUES
      (10, 'M', 1), (10, 'S', 0), (10, 'L', 2);
  `);
}
