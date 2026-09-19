import type { Database } from "better-sqlite3";

// Migrations are plain SQL carried in the compiled output — no .sql files to
// copy into the image — and applied in order. `user_version`, SQLite's own
// per-database counter, records how far a database has been migrated, so a
// fresh volume and one already in production converge on the same schema.
interface Migration {
  version: number;
  name: string;
  up: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "init",
    up: `
      -- A collection. Carries its own colours and display font as data so a
      -- new drop can look like itself without a CSS change or a deploy.
      CREATE TABLE drops (
        id            INTEGER PRIMARY KEY,
        name          TEXT    NOT NULL,
        year          INTEGER NOT NULL,
        no            INTEGER NOT NULL,
        status        TEXT    NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'live', 'archived')),
        sort          INTEGER NOT NULL DEFAULT 0,
        tagline       TEXT    NOT NULL DEFAULT '',
        body          TEXT    NOT NULL DEFAULT '',
        note          TEXT    NOT NULL DEFAULT '',
        color_primary   TEXT  NOT NULL DEFAULT '',
        color_secondary TEXT  NOT NULL DEFAULT '',
        color_accent    TEXT  NOT NULL DEFAULT '',
        color_text      TEXT  NOT NULL DEFAULT '',
        display_font  TEXT    NOT NULL DEFAULT 'Antonio',
        theme_base    TEXT    NOT NULL DEFAULT 'light'
                              CHECK (theme_base IN ('light', 'dark'))
      );

      -- One row per cut and per colourway; there is no variant matrix. Prices
      -- are integer rappen, entered and stored the same way they reach the QR
      -- bill, so nothing is ever converted.
      CREATE TABLE products (
        id           INTEGER PRIMARY KEY,
        drop_id      INTEGER NOT NULL REFERENCES drops (id),
        name         TEXT    NOT NULL,
        description  TEXT    NOT NULL DEFAULT '',
        price_rappen INTEGER NOT NULL CHECK (price_rappen >= 0),
        fit          TEXT    NOT NULL DEFAULT '',
        fit_url      TEXT    NOT NULL DEFAULT '',
        min_orders   INTEGER NOT NULL DEFAULT 1 CHECK (min_orders > 0),
        status       TEXT    NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'live', 'hidden')),
        sort         INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX products_drop_id ON products (drop_id);

      -- Free-text size labels so 'S–M' and 'One Size' both work. The
      -- (id, product_id) unique key is what lets order_items reference a size
      -- and its product as a pair, so a line can never point at a size that
      -- belongs to a different product.
      CREATE TABLE product_sizes (
        id         INTEGER PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
        label      TEXT    NOT NULL,
        sort       INTEGER NOT NULL DEFAULT 0,
        UNIQUE (product_id, label),
        UNIQUE (id, product_id)
      );

      -- reference is the RF creditor reference shown on the bill and matched by
      -- eye against the bank export; token guards the receipt URL against a
      -- guessed neighbouring number.
      CREATE TABLE orders (
        id           INTEGER PRIMARY KEY,
        reference    TEXT    NOT NULL UNIQUE,
        token        TEXT    NOT NULL,
        email        TEXT    NOT NULL,
        phone        TEXT    NOT NULL DEFAULT '',
        total_rappen INTEGER NOT NULL CHECK (total_rappen >= 0),
        status       TEXT    NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'paid', 'cancelled')),
        created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        paid_at      TEXT,
        note         TEXT    NOT NULL DEFAULT ''
      );

      -- Price and title are copied in at order time, not looked up, so renaming
      -- or repricing a product later never rewrites an existing order.
      CREATE TABLE order_items (
        id               INTEGER PRIMARY KEY,
        order_id         INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
        product_id       INTEGER NOT NULL REFERENCES products (id),
        size_id          INTEGER,
        qty              INTEGER NOT NULL CHECK (qty > 0),
        unit_price_rappen INTEGER NOT NULL CHECK (unit_price_rappen >= 0),
        title            TEXT    NOT NULL,
        -- size and product are checked as a pair: a chosen size must belong to
        -- the line's own product. A null size_id is allowed for a product with
        -- no size options.
        FOREIGN KEY (size_id, product_id) REFERENCES product_sizes (id, product_id)
      );
      CREATE INDEX order_items_order_id ON order_items (order_id);
      CREATE INDEX order_items_product_id ON order_items (product_id);

      -- Hashes only, never passwords. active is a flag, not a delete, so who did
      -- what stays readable after someone is deactivated.
      CREATE TABLE admin_users (
        id            INTEGER PRIMARY KEY,
        username      TEXT    NOT NULL UNIQUE,
        password_hash TEXT    NOT NULL,
        active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        last_login_at TEXT
      );

      -- Shop open or closed, creditor details, notification address.
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: "slugs",
    // URLs are slugs, not ids — /drops/redline, /products/redline-jersey — and
    // they must survive a rename, so the slug is stored rather than derived
    // from the name. SQLite cannot add a UNIQUE column with ALTER TABLE, so the
    // uniqueness is a separate index. The '' default only exists because a
    // NOT NULL column needs one; the admin always sets a real, unique slug.
    up: `
      ALTER TABLE drops ADD COLUMN slug TEXT NOT NULL DEFAULT '';
      CREATE UNIQUE INDEX drops_slug ON drops (slug);

      ALTER TABLE products ADD COLUMN slug TEXT NOT NULL DEFAULT '';
      CREATE UNIQUE INDEX products_slug ON products (slug);
    `,
  },
];

export function migrate(database: Database): void {
  const current = database.pragma("user_version", { simple: true }) as number;
  const pending = migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version);

  for (const m of pending) {
    // DDL is transactional in SQLite, and user_version rolls back with it, so a
    // migration that throws part-way leaves the database untouched.
    database.transaction(() => {
      database.exec(m.up);
      database.pragma(`user_version = ${m.version}`);
    })();
    console.log(`migrated to ${m.version} (${m.name})`);
  }
}
