import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  adminCredentials,
  adminDrops,
  adminUser,
  adminUserDeactivated,
  adminUsers,
  allDrops,
  createdOrder,
  duplicateVariantRejection,
  jerseyProduct,
  liveDrops,
  orderRequest,
  originsDrop,
  redlineDrop,
  settings,
  unavailableProductRejection,
  type OrderRejection,
} from "@attakk/mocks";
import type { Database } from "better-sqlite3";
import { hashPassword } from "./password.js";
import { openTempApi } from "./test-support.js";

// The contract test @attakk/mocks describes: replay every fixture through the
// real routes and assert the response matches, byte for byte, what the handlers
// hand the shop. @attakk/types already fails the build on a changed shape; this
// catches a changed value or status code, the drift mocks are prone to. The
// fixtures are the seed too — each is inserted verbatim and read straight back,
// so the catalogue rows the shop mocks are exactly rows the API can produce.

const { db, cleanup } = await openTempApi();
seedFromFixtures(db);
seedAdminUser(db);
seedSettings(db);
const { catalog } = await import("./routes/catalog.js");
const { orders } = await import("./routes/orders.js");
const { admin } = await import("./routes/admin.js");
const { adminProducts } = await import("./routes/admin-products.js");
const { adminDrops: adminDropsRoute } = await import("./routes/admin-drops.js");
const { adminSettings } = await import("./routes/admin-settings.js");
const { adminUsers: adminUsersRoute } = await import("./routes/admin-users.js");

after(() => cleanup());

// Insert the fixture drops, products, sizes and images with their fixed ids, so
// the SELECTs behind the routes return the same objects the handlers do.
function seedFromFixtures(database: Database): void {
  const insertDrop = database.prepare(
    `INSERT INTO drops
       (id, slug, name, year, no, status, sort, tagline, body, note,
        color_primary, color_secondary, color_accent, color_text,
        display_font, theme_base)
     VALUES
       (@id, @slug, @name, @year, @no, @status, @sort, @tagline, @body, @note,
        @color_primary, @color_secondary, @color_accent, @color_text,
        @display_font, @theme_base)`,
  );
  const insertProduct = database.prepare(
    `INSERT INTO products
       (id, drop_id, slug, name, description, price_rappen, fit, fit_url,
        min_orders, status, sort)
     VALUES
       (@id, @drop_id, @slug, @name, @description, @price_rappen, @fit,
        @fit_url, @min_orders, @status, @sort)`,
  );
  const insertSize = database.prepare(
    `INSERT INTO product_sizes (id, product_id, label, sort)
     VALUES (@id, @product_id, @label, @sort)`,
  );
  const insertImage = database.prepare(
    `INSERT INTO product_images
       (id, product_id, hash, ext, alt, placeholder, width, height, sort)
     VALUES
       (@id, @product_id, @hash, @ext, @alt, @placeholder, @width, @height,
        @sort)`,
  );

  const seed = database.transaction(() => {
    for (const drop of allDrops) {
      const { products, ...dropRow } = drop;
      insertDrop.run(dropRow);
      for (const product of products) {
        const { sizes, images, ...productRow } = product;
        insertProduct.run(productRow);
        for (const size of sizes) {
          insertSize.run({ ...size, product_id: product.id });
        }
        for (const image of images) {
          insertImage.run({ ...image, product_id: product.id });
        }
      }
    }
  });
  seed();
}

// Seed the admin fixtures as real rows: their public fields verbatim, plus a
// scrypt hash. adminUser's hash is a fresh one of the fixture password — the hash
// is generated here rather than fixed because it carries a random salt, and what
// login must match is the password, which the real verify checks against it. The
// deactivated user's password is never verified, so any hash does. Seeding both
// lets GET /admin/users prove its list against the adminUsers fixture.
function seedAdminUser(database: Database): void {
  const insert = database.prepare(
    `INSERT INTO admin_users
       (id, username, password_hash, active, created_at, last_login_at)
     VALUES (@id, @username, @password_hash, @active, @created_at, @last_login_at)`,
  );
  insert.run({
    ...adminUser,
    password_hash: hashPassword(adminCredentials.password),
  });
  insert.run({
    ...adminUserDeactivated,
    password_hash: hashPassword("unused-fixture-password"),
  });
}

// Seed the settings table from the fixture, one row per Settings field, so the
// real GET /admin/settings reconstructs the same object the mock hands back.
function seedSettings(database: Database): void {
  const insert = database.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)`,
  );
  insert.run("shop_open", settings.shop_open ? "1" : "0");
  insert.run("creditor_name", settings.creditor_name);
  insert.run("creditor_address", settings.creditor_address);
  insert.run("creditor_building_number", settings.creditor_building_number);
  insert.run("creditor_zip", settings.creditor_zip);
  insert.run("creditor_city", settings.creditor_city);
  insert.run("creditor_country", settings.creditor_country);
  insert.run("creditor_account", settings.creditor_account);
  insert.run("notify_email", settings.notify_email);
}

test("GET /drops returns the live-collections fixture verbatim", async () => {
  const res = await catalog.request("/drops");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), liveDrops);
});

test("GET /drops/:slug returns the live and archived drop fixtures verbatim", async () => {
  const live = await catalog.request("/drops/redline");
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), redlineDrop);

  const archived = await catalog.request("/drops/origins");
  assert.equal(archived.status, 200);
  assert.deepEqual(await archived.json(), originsDrop);
});

test("GET /drops/:slug is 404 for an unknown slug", async () => {
  const res = await catalog.request("/drops/nope");
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not_found" });
});

test("GET /products/:slug returns the product fixture verbatim", async () => {
  const res = await catalog.request("/products/redline-jersey");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), jerseyProduct);
});

test("POST /orders returns the created-order fixture, bar the generated fields", async () => {
  const res = await postOrder(orderRequest);
  assert.equal(res.status, 201);
  const body = (await res.json()) as typeof createdOrder;

  // token and created_at are generated per order and cannot be fixed; the rest
  // must match the fixture exactly, id 1 and RF74000001 included.
  assert.match(body.token, /^[0-9a-f]{32}$/);
  assert.match(body.created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.deepEqual(
    { ...body, token: createdOrder.token, created_at: createdOrder.created_at },
    createdOrder,
  );
});

test("POST /orders rejects the fixture carts with the fixture status and code", async () => {
  for (const rejection of [
    duplicateVariantRejection,
    unavailableProductRejection,
  ] satisfies OrderRejection[]) {
    const res = await postOrder(rejection.request);
    assert.equal(res.status, rejection.status);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, rejection.error);
  }
});

test("GET /admin/users returns the admin users fixture verbatim", async () => {
  // Both admin rows are seeded above, so the real list — public shape (no hash),
  // ordered by username — must match the adminUsers fixture the mock hands back.
  // The login test (which may run either side of this one) stamps adminUser's
  // last_login_at on the shared seeded row, so that one field is normalised back
  // to the fixture's null before comparing; every other field, and editor (id 2)
  // whole, is asserted byte for byte.
  const res = await adminUsersRoute.request("/admin/users");
  assert.equal(res.status, 200);
  const users = (await res.json()) as typeof adminUsers;
  assert.deepEqual(
    users.map((u) => (u.id === 1 ? { ...u, last_login_at: null } : u)),
    adminUsers,
  );
});

test("POST /admin/login returns the user fixture on the right credentials", async () => {
  const res = await postJson(admin, "/admin/login", adminCredentials);
  assert.equal(res.status, 200);
  // Verbatim, last_login_at included: the fixture is null and the route returns
  // the row as it read it, before stamping this login.
  assert.deepEqual(await res.json(), adminUser);
});

test("POST /admin/login is 401 on a wrong password and an unknown user", async () => {
  const wrong = await postJson(admin, "/admin/login", {
    username: adminCredentials.username,
    password: "nope",
  });
  assert.equal(wrong.status, 401);
  assert.deepEqual(await wrong.json(), { error: "invalid_credentials" });

  const unknown = await postJson(admin, "/admin/login", {
    username: "ghost",
    password: adminCredentials.password,
  });
  assert.equal(unknown.status, 401);
});

test("POST /admin/login is 400 with the mock's body on a malformed request", async () => {
  // Pins the 400 shape the mock returns to the API's, so the mock cannot drift to
  // a different code or add fields the shop never sees.
  const res = await postJson(admin, "/admin/login", { username: "x" });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "invalid" });
});

test("GET /admin/drops returns the admin drops fixture verbatim", async () => {
  // Every drop, any status, ordered as they sort — independent of orders, so the
  // bytes are pinnable here (unlike the product list's ordered_count).
  const res = await adminDropsRoute.request("/admin/drops");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), adminDrops);
});

test("GET /admin/drops/:id returns one drop fixture verbatim", async () => {
  // The edit-form read is the bare Drop row, any status. Drop 1 is the redline
  // collection; its detail must match the admin-drops list's first row byte for
  // byte (the same products-stripped shape).
  const res = await adminDropsRoute.request("/admin/drops/1");
  assert.equal(res.status, 200);
  assert.deepEqual(
    await res.json(),
    adminDrops.find((d) => d.id === 1),
  );
});

test("GET /admin/products/:id returns the product fixture verbatim", async () => {
  // The admin's edit-form read is the same ProductWithSizes shape the catalogue
  // serves, but for any status. Product 10 is live, so its detail must match the
  // jersey fixture byte for byte, sizes and images included. (The list's
  // ordered_count depends on which orders are seeded, so byte-parity there is not
  // meaningful — the route test pins the tally instead.)
  const res = await adminProducts.request("/admin/products/10");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), jerseyProduct);
});

test("GET /admin/settings reconstructs the settings fixture verbatim", async () => {
  // The rows seeded above are the mock's settings object, so the real route's
  // read (shop_open as a boolean, every field as stored) must match it exactly.
  const res = await adminSettings.request("/admin/settings");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), settings);
});

function postOrder(body: unknown): Promise<Response> {
  return postJson(orders, "/orders", body);
}

function postJson(
  app: {
    request: (path: string, init: RequestInit) => Response | Promise<Response>;
  },
  path: string,
  body: unknown,
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
