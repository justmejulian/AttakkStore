import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { setupServer } from "msw/node";
import {
  adminCredentials,
  adminDrops,
  adminProducts,
  adminUser,
  adminUsers,
  archivedDrops,
  createdOrder,
  cartQuote,
  orderRequest,
  jerseyProduct,
  jerseyProductDetail,
  liveDrops,
  orderListRows,
  paidOrder,
  settings,
  uploadedImage,
} from "./fixtures.js";
import { handlers } from "./handlers.js";

// The mock's own side of the contract: that the handlers actually intercept
// (the `*` wildcard patterns bind to whatever host a consumer points at) and
// return the fixtures with the statuses the API's contract test proves its real
// routes return. Between this and apps/api's contract test, both sides are
// pinned to the same values, which is what keeps the mock from drifting.

const server = setupServer(...handlers);

// Any host — the point of the wildcard patterns is that the base URL is the
// consumer's, not this package's.
const base = "http://api.internal:3000";

before(() => server.listen({ onUnhandledRequest: "error" }));
after(() => server.close());

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("POST /cart/quote matches the API and prices the submitted quantity", async () => {
  const response = await post("/cart/quote", { items: orderRequest.items });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), cartQuote);
  const changed = await post("/cart/quote", {
    items: [{ ...orderRequest.items[0], qty: 3 }],
  });
  assert.equal(
    ((await changed.json()) as { total_rappen: number }).total_rappen,
    28500,
  );
  assert.equal((await post("/cart/quote", { items: [] })).status, 400);
  assert.equal(
    (
      await post("/cart/quote", {
        items: [{ product_id: 12, size_id: null, qty: 1 }],
      })
    ).status,
    422,
  );
});

function patch(path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function put(path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del(path: string): Promise<Response> {
  return fetch(`${base}${path}`, { method: "DELETE" });
}

test("GET /drops returns the live collections", async () => {
  const res = await fetch(`${base}/drops`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), liveDrops);
});

test("GET /archive returns the archived collections", async () => {
  const res = await fetch(`${base}/archive`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), archivedDrops);
});

test("GET /drops/:slug serves a known slug and 404s an unknown one", async () => {
  assert.equal((await fetch(`${base}/drops/redline`)).status, 200);
  assert.equal((await fetch(`${base}/drops/origins`)).status, 200);
  const miss = await fetch(`${base}/drops/nope`);
  assert.equal(miss.status, 404);
  assert.deepEqual(await miss.json(), { error: "not_found" });
});

test("GET /products/:slug serves the product-with-drop and 404s an unknown one", async () => {
  const res = await fetch(`${base}/products/redline-jersey`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), jerseyProductDetail);
  assert.equal((await fetch(`${base}/products/nope`)).status, 404);
});

test("POST /orders returns the created order on a clean cart", async () => {
  const res = await post("/orders", {
    email: "buyer@example.com",
    items: [{ product_id: 10, size_id: 101, qty: 2 }],
  });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), createdOrder);
});

test("GET /orders/:reference requires the receipt token", async () => {
  const found = await fetch(
    `${base}/orders/${createdOrder.reference}?token=${createdOrder.token}`,
  );
  assert.equal(found.status, 200);
  assert.equal(
    ((await found.json()) as { items: { size_label: string | null }[] })
      .items[0]?.size_label,
    "M",
  );
  assert.equal(
    (await fetch(`${base}/orders/${createdOrder.reference}?token=wrong`))
      .status,
    404,
  );
});

test("POST /orders mirrors the API's rejections, code for code", async () => {
  // Malformed (bad email) and duplicate variant are the schema's 400s.
  assert.equal((await post("/orders", { email: "x", items: [] })).status, 400);
  const dup = await post("/orders", {
    email: "buyer@example.com",
    items: [
      { product_id: 10, size_id: 101, qty: 1 },
      { product_id: 10, size_id: 101, qty: 1 },
    ],
  });
  assert.equal(dup.status, 400);

  // Pricing's 422s, one per code, priced against the fixtures the way the API
  // prices against its table.
  const cases: [Record<string, unknown>, string][] = [
    [{ product_id: 999, size_id: null, qty: 1 }, "product_unavailable"],
    [{ product_id: 10, size_id: null, qty: 1 }, "size_required"],
    [{ product_id: 10, size_id: 900, qty: 1 }, "size_invalid"],
    [{ product_id: 11, size_id: 101, qty: 1 }, "size_not_allowed"],
  ];
  for (const [item, code] of cases) {
    const res = await post("/orders", {
      email: "buyer@example.com",
      items: [item],
    });
    assert.equal(res.status, 422, `${code} should be 422`);
    assert.deepEqual(await res.json(), { error: code });
  }
});

test("POST /admin/login accepts the fixture credentials and refuses the rest", async () => {
  const ok = await post("/admin/login", adminCredentials);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), adminUser);

  const wrong = await post("/admin/login", {
    username: adminCredentials.username,
    password: "nope",
  });
  assert.equal(wrong.status, 401);
  assert.deepEqual(await wrong.json(), { error: "invalid_credentials" });

  // A body the schema rejects is the same 400 the API gives.
  assert.equal((await post("/admin/login", { username: "x" })).status, 400);
});

test("GET /admin/orders lists the rows and filters by status", async () => {
  const all = await fetch(`${base}/admin/orders`);
  assert.equal(all.status, 200);
  assert.deepEqual(await all.json(), orderListRows);

  const paid = await fetch(`${base}/admin/orders?status=paid`);
  assert.deepEqual(
    await paid.json(),
    orderListRows.filter((o) => o.status === "paid"),
  );

  const bad = await fetch(`${base}/admin/orders?status=shipped`);
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: "invalid_status" });
});

test("GET /admin/orders/:id returns the order with items or 404s", async () => {
  const found = await fetch(`${base}/admin/orders/2`);
  assert.equal(found.status, 200);
  assert.deepEqual(await found.json(), paidOrder);
  assert.equal((await fetch(`${base}/admin/orders/999`)).status, 404);
});

test("PATCH status returns the updated order and stamps or clears paid_at", async () => {
  const paid = await patch("/admin/orders/1/status", { status: "paid" });
  const paidBody = (await paid.json()) as {
    status: string;
    paid_at: string | null;
  };
  assert.equal(paidBody.status, "paid");
  assert.notEqual(paidBody.paid_at, null);

  const cancelled = await patch("/admin/orders/1/status", {
    status: "cancelled",
  });
  assert.equal(
    ((await cancelled.json()) as { paid_at: string | null }).paid_at,
    null,
  );

  assert.equal(
    (await patch("/admin/orders/1/status", { status: "x" })).status,
    400,
  );
  assert.equal(
    (await patch("/admin/orders/999/status", { status: "paid" })).status,
    404,
  );
});

test("PATCH note returns the order with the new note", async () => {
  const res = await patch("/admin/orders/1/note", { note: "Chased payment." });
  assert.equal(
    ((await res.json()) as { note: string }).note,
    "Chased payment.",
  );
  assert.equal(
    (await patch("/admin/orders/999/note", { note: "x" })).status,
    404,
  );
});

test("POST resend is 202 for a known order and 404 otherwise", async () => {
  const ok = await fetch(`${base}/admin/orders/1/resend`, { method: "POST" });
  assert.equal(ok.status, 202);
  assert.deepEqual(await ok.json(), { status: "queued" });
  const miss = await fetch(`${base}/admin/orders/999/resend`, {
    method: "POST",
  });
  assert.equal(miss.status, 404);
});

test("GET /admin/drops lists every drop, before the live-collections handler", async () => {
  const res = await fetch(`${base}/admin/drops`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), adminDrops);
});

test("GET /admin/drops/:id serves a drop and 404s an unknown id, before the slug read", async () => {
  const detail = await fetch(`${base}/admin/drops/1`);
  assert.equal(detail.status, 200);
  assert.deepEqual(
    await detail.json(),
    adminDrops.find((d) => d.id === 1),
  );

  assert.equal((await fetch(`${base}/admin/drops/999`)).status, 404);
});

// A well-formed drop body, callers overriding the slug so the create/edit tests
// don't collide on the seeded slugs.
function dropBody(slug: string): Record<string, unknown> {
  return {
    slug,
    name: "Nightfall",
    year: 2026,
    no: 4,
    status: "draft",
    display_font: "Antonio",
    theme_base: "dark",
  };
}

test("POST /admin/drops mirrors the API's create branches", async () => {
  const created = await post("/admin/drops", dropBody("nightfall"));
  assert.equal(created.status, 201);
  assert.equal(((await created.json()) as { slug: string }).slug, "nightfall");

  // A malformed body is a 400, a slug already in use a 409 — the API's codes.
  assert.equal((await post("/admin/drops", { slug: "x" })).status, 400);
  assert.equal((await post("/admin/drops", dropBody("redline"))).status, 409);
});

test("PATCH /admin/drops/:id mirrors the API's edit branches", async () => {
  const ok = await patch("/admin/drops/2", {
    ...dropBody("origins"),
    name: "Renamed",
    status: "live",
  });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { name: string }).name, "Renamed");

  // Another drop's slug is a 409; a missing drop a 404.
  assert.equal(
    (await patch("/admin/drops/2", dropBody("redline"))).status,
    409,
  );
  assert.equal(
    (await patch("/admin/drops/999", dropBody("ghost"))).status,
    404,
  );
});

test("PATCH /admin/drops/:id/status flips status and mirrors the API's 400/404", async () => {
  const ok = await patch("/admin/drops/1/status", { status: "archived" });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { status: string }).status, "archived");

  assert.equal(
    (await patch("/admin/drops/1/status", { status: "sold" })).status,
    400,
  );
  assert.equal(
    (await patch("/admin/drops/999/status", { status: "live" })).status,
    404,
  );
});

test("GET /admin/products lists the rows and 404s an unknown detail id", async () => {
  const list = await fetch(`${base}/admin/products`);
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), adminProducts);

  const detail = await fetch(`${base}/admin/products/10`);
  assert.equal(detail.status, 200);
  assert.deepEqual(await detail.json(), jerseyProduct);

  assert.equal((await fetch(`${base}/admin/products/999`)).status, 404);
});

test("POST /admin/products mirrors the API's create branches", async () => {
  const body = {
    drop_id: 1,
    slug: "brand-new",
    name: "Brand New",
    price_rappen: 4200,
    min_orders: 2,
    status: "draft",
  };
  const created = await post("/admin/products", body);
  assert.equal(created.status, 201);
  assert.equal(((await created.json()) as { slug: string }).slug, "brand-new");

  // A malformed body, an unknown drop and a taken slug: the API's 400/422/409.
  assert.equal((await post("/admin/products", { slug: "x" })).status, 400);
  assert.equal(
    (await post("/admin/products", { ...body, drop_id: 999 })).status,
    422,
  );
  assert.equal(
    (await post("/admin/products", { ...body, slug: "redline-jersey" })).status,
    409,
  );
});

test("PATCH /admin/products/:id mirrors the API's edit branches", async () => {
  const ok = await patch("/admin/products/12", {
    slug: "origins-tee",
    name: "Renamed",
    price_rappen: 7000,
    min_orders: 1,
    status: "live",
  });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { name: string }).name, "Renamed");

  // Another product's slug is a 409; a missing product a 404.
  assert.equal(
    (
      await patch("/admin/products/12", {
        slug: "redline-jersey",
        name: "x",
        price_rappen: 1,
        min_orders: 1,
        status: "draft",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await patch("/admin/products/999", {
        slug: "ghost",
        name: "x",
        price_rappen: 1,
        min_orders: 1,
        status: "draft",
      })
    ).status,
    404,
  );
});

test("PUT /admin/products/:id/sizes mirrors the API's reconcile branches", async () => {
  // Product 10's fixture sizes are 100 (S), 101 (M), 102 (L); orders reference
  // 100 and 101, so only 102 is free to drop.
  const ok = await put("/admin/products/10/sizes", {
    sizes: [
      { id: 100, label: "S", sort: 0 },
      { id: 101, label: "M", sort: 1 },
      { label: "XL", sort: 2 },
    ],
  });
  assert.equal(ok.status, 200);
  const sizes = ((await ok.json()) as { sizes: { label: string }[] }).sizes;
  assert.deepEqual(
    sizes.map((s) => s.label),
    ["S", "M", "XL"],
  );

  // Dropping an in-use size (101) is a 409; naming an unknown id a 422.
  assert.equal(
    (
      await put("/admin/products/10/sizes", {
        sizes: [{ id: 100, label: "S" }],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await put("/admin/products/10/sizes", {
        sizes: [{ id: 99999, label: "Z" }],
      })
    ).status,
    422,
  );

  // Duplicate labels are a 400; a missing product a 404.
  assert.equal(
    (
      await put("/admin/products/10/sizes", {
        sizes: [{ label: "S" }, { label: "S" }],
      })
    ).status,
    400,
  );
  assert.equal(
    (await put("/admin/products/999/sizes", { sizes: [] })).status,
    404,
  );
});

test("DELETE /admin/products/:id refuses an ordered product and 404s a missing one", async () => {
  // Product 12 (origins-tee) has no orders → 204; product 10 has orders → 409.
  assert.equal((await del("/admin/products/12")).status, 204);
  assert.equal((await del("/admin/products/10")).status, 409);
  assert.equal((await del("/admin/products/999")).status, 404);
});

test("image write routes return the stored row and an empty 204", async () => {
  const created = await fetch(`${base}/products/10/images`, { method: "POST" });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), uploadedImage);

  const removed = await fetch(`${base}/images/5`, { method: "DELETE" });
  assert.equal(removed.status, 204);
  assert.equal(await removed.text(), "");
});

test("admin users list, create and deactivate mirror the API", async () => {
  const list = await fetch(`${base}/admin/users`);
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), adminUsers);

  // Create: a clean body is a 201, a taken username a 409, a short password a 400.
  const created = await post("/admin/users", {
    username: "newbie",
    password: "brand-new-password",
  });
  assert.equal(created.status, 201);
  assert.equal(
    ((await created.json()) as { username: string }).username,
    "newbie",
  );
  assert.equal(
    (await post("/admin/users", { username: "admin", password: "another-one" }))
      .status,
    409,
  );
  assert.equal(
    (await post("/admin/users", { username: "z", password: "short" })).status,
    400,
  );

  // Deactivate/restore: an unknown id 404s; admin is the only active user, so
  // switching it off is the last_admin 409; the inactive editor restores fine; a
  // bad body is a 400 — the API's codes.
  assert.equal(
    (await patch("/admin/users/9999/active", { active: false })).status,
    404,
  );
  const lastAdmin = await patch("/admin/users/1/active", { active: false });
  assert.equal(lastAdmin.status, 409);
  assert.equal(
    ((await lastAdmin.json()) as { error: string }).error,
    "last_admin",
  );
  const restore = await patch("/admin/users/2/active", { active: true });
  assert.equal(restore.status, 200);
  assert.equal(((await restore.json()) as { active: number }).active, 1);
  assert.equal(
    (await patch("/admin/users/2/active", { active: "nope" })).status,
    400,
  );
});

test("settings read returns the fixture and a bad IBAN is a 400", async () => {
  const read = await fetch(`${base}/admin/settings`);
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), settings);

  // A valid save echoes the normalised object back; a bad IBAN is a 400, exactly
  // as the API's settingsInput rejects it.
  const ok = await put("/admin/settings", settings);
  assert.equal(ok.status, 200);
  const bad = await put("/admin/settings", {
    ...settings,
    creditor_account: "CH5604835012345678000",
  });
  assert.equal(bad.status, 400);
});
