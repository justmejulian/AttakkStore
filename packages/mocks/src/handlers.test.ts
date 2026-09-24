import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
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
} from "./fixtures.js";
import { handlers } from "./handlers.js";
import { resetMockState } from "./state.js";

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

// The handlers keep what they are written, so each test starts from the seeded
// fixtures rather than from whatever the one before it created or deleted.
beforeEach(() => resetMockState());

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

test("POST /orders prices a clean cart and stores what it created", async () => {
  const res = await post("/orders", {
    email: "buyer@example.com",
    items: [{ product_id: 10, size_id: 101, qty: 2 }],
  });
  assert.equal(res.status, 201);
  const order = (await res.json()) as {
    id: number;
    reference: string;
    token: string;
    email: string;
    total_rappen: number;
    status: string;
    items: { product_id: number; unit_price_rappen: number; title: string }[];
  };
  assert.equal(order.email, "buyer@example.com");
  assert.equal(order.status, "pending");
  // Repriced from the product row, never from what the browser sent.
  assert.equal(order.total_rappen, 19000);
  assert.equal(order.items[0].unit_price_rappen, 9500);
  assert.equal(order.items[0].title, "Redline Jersey");

  // It is the order the admin now opens, and the receipt the buyer was sent.
  const detail = await fetch(`${base}/admin/orders/${order.id}`);
  assert.equal(detail.status, 200);
  const receipt = await fetch(
    `${base}/orders/${order.reference}?token=${order.token}`,
  );
  assert.equal(receipt.status, 200);
  assert.equal(
    ((await receipt.json()) as { items: { size_label: string | null }[] })
      .items[0].size_label,
    "M",
  );
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

test("an uploaded photo joins the product's gallery, and a deleted one leaves it", async () => {
  const before = (await (await fetch(`${base}/admin/products/10`)).json()) as {
    images: { id: number }[];
  };

  const created = await fetch(`${base}/products/10/images`, { method: "POST" });
  assert.equal(created.status, 201);
  const image = (await created.json()) as { id: number; sort: number };
  // The bytes are the stored fixture's — the processing is the API's — but the
  // row is this product's own, at the end of its gallery.
  assert.equal(image.sort, before.images.length);

  const withPhoto = (await (
    await fetch(`${base}/admin/products/10`)
  ).json()) as { images: { id: number }[] };
  assert.equal(withPhoto.images.length, before.images.length + 1);
  assert.equal(withPhoto.images.at(-1)?.id, image.id);

  const removed = await fetch(`${base}/images/${image.id}`, {
    method: "DELETE",
  });
  assert.equal(removed.status, 204);
  assert.equal(await removed.text(), "");

  const after = (await (await fetch(`${base}/admin/products/10`)).json()) as {
    images: { id: number }[];
  };
  assert.deepEqual(after.images, before.images);

  // An image that is not there any more, and one that never was.
  assert.equal(
    (await fetch(`${base}/images/${image.id}`, { method: "DELETE" })).status,
    404,
  );
  assert.equal(
    (await fetch(`${base}/products/9999/images`, { method: "POST" })).status,
    404,
  );
});

test("admin users list, create and deactivate mirror the API", async () => {
  const list = await fetch(`${base}/admin/users`);
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), adminUsers);

  // Deactivate/restore: an unknown id 404s; admin is the only active user, so
  // switching it off is the last_admin 409; the inactive editor restores fine; a
  // bad body is a 400 — the API's codes. Checked before the create below, which
  // adds a second active admin and so lifts the guard.
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

  // The created admin is in the list the screen re-reads, and now that there is
  // a second active one, the last_admin guard lets the first go.
  const listed = (await (await fetch(`${base}/admin/users`)).json()) as {
    username: string;
  }[];
  assert.ok(listed.some((u) => u.username === "newbie"));
  assert.equal(
    (await patch("/admin/users/1/active", { active: false })).status,
    200,
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

// What the canned-response mock could not do: a write the next read agrees
// with. These are the flows a screen built against the mock used to appear to
// complete while the list beside it said otherwise.

test("a created drop is in the next list read, and its slug is then taken", async () => {
  const created = await post("/admin/drops", dropBody("nightfall"));
  const { id } = (await created.json()) as { id: number };

  const listed = (await (await fetch(`${base}/admin/drops`)).json()) as {
    id: number;
    slug: string;
  }[];
  assert.ok(
    listed.some((d) => d.id === id && d.slug === "nightfall"),
    "the drop the create returned is in the list",
  );

  const detail = await fetch(`${base}/admin/drops/${id}`);
  assert.equal(detail.status, 200);
  assert.equal(((await detail.json()) as { slug: string }).slug, "nightfall");

  // The seeded fixtures were the only slugs the stateless mock could refuse.
  const again = await post("/admin/drops", dropBody("nightfall"));
  assert.equal(again.status, 409);
  assert.deepEqual(await again.json(), { error: "slug_taken" });
});

test("a renamed drop reads back renamed, and frees the slug it had", async () => {
  const renamed = await patch("/admin/drops/1", dropBody("redline-two"));
  assert.equal(renamed.status, 200);

  const detail = await fetch(`${base}/admin/drops/1`);
  assert.equal(((await detail.json()) as { slug: string }).slug, "redline-two");

  // "redline" is nobody's slug now, so a create may take it.
  assert.equal((await post("/admin/drops", dropBody("redline"))).status, 201);
});

test("archiving a drop moves it between the storefront's two reads", async () => {
  const live = (await (await fetch(`${base}/drops`)).json()) as {
    id: number;
  }[];
  assert.deepEqual(
    live.map((d) => d.id),
    [1],
  );

  const flipped = await patch("/admin/drops/1/status", { status: "archived" });
  assert.equal(flipped.status, 200);

  assert.deepEqual(await (await fetch(`${base}/drops`)).json(), []);
  const archived = (await (await fetch(`${base}/archive`)).json()) as {
    id: number;
  }[];
  assert.deepEqual(archived.map((d) => d.id).sort(), [1, 2]);

  // Its pieces are no longer sellable, the way the API prices against live drops.
  const quote = await post("/cart/quote", { items: orderRequest.items });
  assert.equal(quote.status, 422);
  assert.deepEqual(await quote.json(), { error: "product_unavailable" });
});

test("a created product joins its drop, the admin list and the storefront read", async () => {
  const created = await post("/admin/products", {
    drop_id: 1,
    slug: "nightfall-cap",
    name: "Nightfall Cap",
    price_rappen: 4500,
    min_orders: 1,
    status: "live",
  });
  assert.equal(created.status, 201);
  const { id } = (await created.json()) as { id: number };

  const rows = (await (await fetch(`${base}/admin/products`)).json()) as {
    id: number;
    drop_name: string;
    ordered_count: number;
  }[];
  const row = rows.find((p) => p.id === id);
  assert.equal(
    row?.drop_name,
    "Redline",
    "it is listed under the drop it went into",
  );
  assert.equal(row?.ordered_count, 0, "nothing has been ordered of it yet");

  const page = await fetch(`${base}/products/nightfall-cap`);
  assert.equal(page.status, 200);
  const product = (await page.json()) as { drop: { slug: string } };
  assert.equal(product.drop.slug, "redline");
});

test("an edited product reads back edited everywhere it is shown", async () => {
  const edited = await patch("/admin/products/10", {
    slug: "redline-jersey",
    name: "Redline Jersey II",
    price_rappen: 10500,
    min_orders: 1,
    status: "live",
  });
  assert.equal(edited.status, 200);

  const detail = (await (await fetch(`${base}/admin/products/10`)).json()) as {
    name: string;
    price_rappen: number;
  };
  assert.equal(detail.name, "Redline Jersey II");

  // The price the shop quotes comes off the same row.
  const quote = (await (
    await post("/cart/quote", {
      items: [{ product_id: 10, size_id: 101, qty: 1 }],
    })
  ).json()) as { total_rappen: number };
  assert.equal(quote.total_rappen, 10500);
});

test("saved sizes replace the old ones and keep the ids of the rows that stay", async () => {
  // Sizes 100 and 101 are on order lines, so they have to stay; 102 is free to
  // drop, and XL is new.
  const saved = await put("/admin/products/10/sizes", {
    sizes: [
      { id: 100, label: "S", sort: 0 },
      { id: 101, label: "M", sort: 1 },
      { label: "XL", sort: 2 },
    ],
  });
  assert.equal(saved.status, 200);

  const detail = (await (await fetch(`${base}/admin/products/10`)).json()) as {
    sizes: { id: number; label: string }[];
  };
  assert.deepEqual(
    detail.sizes.map((s) => s.label),
    ["S", "M", "XL"],
  );
  assert.deepEqual(
    detail.sizes.slice(0, 2).map((s) => s.id),
    [100, 101],
    "the kept rows keep the ids the order lines point at",
  );

  // The size that was dropped is no longer one the shop can buy.
  const gone = await post("/cart/quote", {
    items: [{ product_id: 10, size_id: 102, qty: 1 }],
  });
  assert.equal(gone.status, 422);
  assert.deepEqual(await gone.json(), { error: "size_invalid" });
});

test("a deleted product is gone from every read", async () => {
  // Products 10 and 11 are on order lines and refused; 12 is the one free to go.
  assert.equal((await del("/admin/products/10")).status, 409);
  assert.equal((await del("/admin/products/12")).status, 204);

  assert.equal((await fetch(`${base}/admin/products/12`)).status, 404);
  assert.equal((await fetch(`${base}/products/origins-tee`)).status, 404);
  const rows = (await (await fetch(`${base}/admin/products`)).json()) as {
    id: number;
  }[];
  assert.equal(
    rows.some((p) => p.id === 12),
    false,
  );
  // Its drop keeps it no longer either.
  const archived = (await (await fetch(`${base}/archive`)).json()) as {
    products: unknown[];
  }[];
  assert.deepEqual(archived[0].products, []);
  assert.equal((await del("/admin/products/12")).status, 404);
});

test("a saved setting is what the next read returns", async () => {
  const changed = { ...settings, notify_email: "orders@attakk.example" };
  assert.equal((await put("/admin/settings", changed)).status, 200);

  const read = (await (await fetch(`${base}/admin/settings`)).json()) as {
    notify_email: string;
  };
  assert.equal(read.notify_email, "orders@attakk.example");
});

test("an order's status and note stay put, in the detail and in the list", async () => {
  const paid = await patch(`/admin/orders/${createdOrder.id}/status`, {
    status: "paid",
  });
  assert.equal(paid.status, 200);
  await patch(`/admin/orders/${createdOrder.id}/note`, {
    note: "Picked up at HQ.",
  });

  const detail = (await (
    await fetch(`${base}/admin/orders/${createdOrder.id}`)
  ).json()) as { status: string; paid_at: string | null; note: string };
  assert.equal(detail.status, "paid");
  assert.equal(detail.note, "Picked up at HQ.");
  assert.ok(detail.paid_at, "marking it paid stamped a paid_at");

  const row = (
    (await (await fetch(`${base}/admin/orders`)).json()) as {
      id: number;
      status: string;
    }[]
  ).find((o) => o.id === createdOrder.id);
  assert.equal(row?.status, "paid");
  // The status filter reads the stored row too, not the fixture it was seeded from.
  const pending = (await (
    await fetch(`${base}/admin/orders?status=pending`)
  ).json()) as { id: number }[];
  assert.equal(
    pending.some((o) => o.id === createdOrder.id),
    false,
  );
});
