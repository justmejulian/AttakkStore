import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { migrate } from "./migrate.js";

// The API owns the data volume: the SQLite file lives here and the uploads it
// serves the shop read-only sit under it. Ensure the tree exists before the
// database or a read-only mount expects it. Defaults to a local ./data in dev;
// compose and Dokku point DATA_DIR at the mounted volume.
export const DATA_DIR = process.env.DATA_DIR ?? "./data";

// Only the webp derivatives the browser is meant to fetch live under uploads/ —
// that is the directory mounted read-only into the shop. The untouched
// originals sit beside it in originals/, kept so a size or format can be
// regenerated later but deliberately NOT on the shop's mount: an original still
// carries the EXIF the derivatives strip (a phone photo's GPS), and the browser
// only ever references the derivatives.
export const UPLOADS_DIR = `${DATA_DIR}/uploads`;
export const ORIGINALS_DIR = `${DATA_DIR}/originals`;
mkdirSync(UPLOADS_DIR, { recursive: true });
mkdirSync(ORIGINALS_DIR, { recursive: true });

// One connection for the process. WAL lets the shop read while the admin
// writes; foreign_keys must be turned on per connection or the constraints in
// the schema are silently inert.
export const db = new Database(`${DATA_DIR}/attakk.db`);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Bring the schema up to date as part of opening the connection, so every
// importer — the server, the admin's seed CLI, a one-off script — gets a
// migrated database rather than having to remember to run it. On a fresh
// volume this creates every table; on one already migrated it is a no-op. It
// also means repository modules can prepare statements at import time without
// racing an unmigrated schema.
migrate(db);
