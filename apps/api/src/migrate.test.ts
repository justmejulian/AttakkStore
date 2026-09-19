import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { migrate } from "./migrate.js";

const TABLES = [
  "drops",
  "products",
  "product_sizes",
  "orders",
  "order_items",
  "admin_users",
  "settings",
  "product_images",
];

test("migrate creates every table and stamps the schema version", () => {
  const db = new Database(":memory:");
  migrate(db);

  assert.equal(db.pragma("user_version", { simple: true }), 3);
  const names = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
  for (const t of TABLES) assert.ok(names.includes(t), `missing table ${t}`);
  db.close();
});

test("migrate is idempotent", () => {
  const db = new Database(":memory:");
  migrate(db);
  assert.doesNotThrow(() => migrate(db));
  assert.equal(db.pragma("user_version", { simple: true }), 3);
  db.close();
});

test("migrates a v1 database that already holds rows", () => {
  // A production volume stopped at v1 already carries drops and products. The
  // v2 slug migration has to survive that, not just a fresh, empty database.
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE drops (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, year INTEGER NOT NULL,
      no INTEGER NOT NULL
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY, drop_id INTEGER NOT NULL, name TEXT NOT NULL,
      price_rappen INTEGER NOT NULL
    );
  `);
  db.pragma("user_version = 1");
  const drop = db.prepare(
    "INSERT INTO drops (name, year, no) VALUES (?, 2026, ?)",
  );
  drop.run("A", 1);
  drop.run("B", 2);
  const product = db.prepare(
    "INSERT INTO products (drop_id, name, price_rappen) VALUES (1, ?, 0)",
  );
  product.run("Tee");
  product.run("Cap");

  assert.doesNotThrow(() => migrate(db));
  assert.equal(db.pragma("user_version", { simple: true }), 3);

  // Every backfilled slug is non-empty and unique, so the admin can find and
  // replace them and the unique index holds in the meantime.
  for (const table of ["drops", "products"]) {
    const rows = db.prepare(`SELECT slug FROM ${table}`).all() as {
      slug: string;
    }[];
    const slugs = rows.map((r) => r.slug);
    assert.ok(
      slugs.every((s) => s.length > 0),
      `${table} has an empty slug`,
    );
    assert.equal(new Set(slugs).size, slugs.length, `${table} slugs collide`);
  }
  db.close();
});

test("the slug unique index rejects a duplicate", () => {
  const db = new Database(":memory:");
  migrate(db);
  const insert = db.prepare(
    "INSERT INTO drops (name, year, no, slug) VALUES (?, 2026, ?, ?)",
  );
  insert.run("A", 1, "dup");
  assert.throws(() => insert.run("B", 2, "dup"), /UNIQUE/);
  db.close();
});
