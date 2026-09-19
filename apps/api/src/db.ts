import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

// The API owns the data volume: the SQLite file lives here and the uploads it
// serves the shop read-only sit under it. Ensure the tree exists before the
// database or a read-only mount expects it. Defaults to a local ./data in dev;
// compose and Dokku point DATA_DIR at the mounted volume.
export const DATA_DIR = process.env.DATA_DIR ?? "./data";
export const UPLOADS_DIR = `${DATA_DIR}/uploads`;
mkdirSync(UPLOADS_DIR, { recursive: true });

// One connection for the process. WAL lets the shop read while the admin
// writes; foreign_keys must be turned on per connection or the constraints in
// the schema are silently inert.
export const db = new Database(`${DATA_DIR}/attakk.db`);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
