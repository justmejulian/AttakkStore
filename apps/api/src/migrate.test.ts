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
];

test("migrate creates every table and stamps the schema version", () => {
  const db = new Database(":memory:");
  migrate(db);

  assert.equal(db.pragma("user_version", { simple: true }), 2);
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
  assert.equal(db.pragma("user_version", { simple: true }), 2);
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
