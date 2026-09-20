import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import {
  adminCredentials,
  adminProducts,
  jerseyProduct,
  orderListRows,
  paidOrder,
} from "@attakk/mocks";
import { server } from "@attakk/mocks/node";
import { http, HttpResponse } from "msw";
import { app } from "./app.js";

// The login flow driven end to end against the mock API: the admin's routes,
// its session cookie and its auth gate, with POST /admin/login answered by the
// same fixtures the API's contract test proves its real route returns. onUnhandled
// is "error" so a stray request the mock does not model fails loudly.
before(() => server.listen({ onUnhandledRequest: "error" }));
// Some tests override /admin/login for a single case; reset so it never leaks.
afterEach(() => server.resetHandlers());
after(() => server.close());

// The `admin_session` cookie out of a Set-Cookie header, ready to send back.
function sessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie")!;
  const eq = setCookie.indexOf("=");
  const value = setCookie.slice(eq + 1).split(";")[0];
  return `admin_session=${value}`;
}

function login(username: string, password: string): Promise<Response> {
  return Promise.resolve(
    app.request("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password }),
    }),
  );
}

test("a protected page redirects to login when signed out", async () => {
  const res = await app.request("/");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/login");
});

test("GET /login renders the form", async () => {
  const res = await app.request("/login");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<form method="post" action="\/login">/);
});

test("valid credentials open a session and unlock the home page", async () => {
  const res = await login(adminCredentials.username, adminCredentials.password);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");

  const home = await app.request("/", {
    headers: { cookie: sessionCookie(res) },
  });
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Signed in as <strong>admin<\/strong>/);
});

test("a signed-in visitor to /login is sent to the home page", async () => {
  const res = await login(adminCredentials.username, adminCredentials.password);
  const redirected = await app.request("/login", {
    headers: { cookie: sessionCookie(res) },
  });
  assert.equal(redirected.status, 302);
  assert.equal(redirected.headers.get("location"), "/");
});

test("wrong credentials re-render the form with an error and no session", async () => {
  const res = await login(adminCredentials.username, "wrong-password");
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("set-cookie"), null);
  assert.match(await res.text(), /did not work/);
});

test("a form missing a field is a 400 before the API is called", async () => {
  const res = await app.request("/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "admin" }),
  });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /Enter a username and password/);
});

test("an API error reads as a service problem, not bad credentials", async () => {
  server.use(
    http.post("*/admin/login", () =>
      HttpResponse.json({ error: "boom" }, { status: 503 }),
    ),
  );
  const res = await login(adminCredentials.username, adminCredentials.password);
  assert.equal(res.status, 502);
  assert.equal(res.headers.get("set-cookie"), null);
  assert.match(await res.text(), /service is unavailable/i);
});

test("a login response missing its user shape opens no session", async () => {
  server.use(
    http.post("*/admin/login", () => HttpResponse.json({ nope: true })),
  );
  const res = await login(adminCredentials.username, adminCredentials.password);
  assert.equal(res.status, 502);
  assert.equal(res.headers.get("set-cookie"), null);
});

test("logout expires the session cookie", async () => {
  const res = await app.request("/logout", { method: "POST" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/login");
  assert.match(res.headers.get("set-cookie")!, /admin_session=;/);
});

// ------------------------------------------------------------ order screens

// A signed-in session cookie, ready to send with a protected request.
async function authed(): Promise<string> {
  const res = await login(adminCredentials.username, adminCredentials.password);
  return sessionCookie(res);
}

function get(path: string, cookie: string): Promise<Response> {
  return Promise.resolve(app.request(path, { headers: { cookie } }));
}

function form(
  path: string,
  cookie: string,
  body: Record<string, string>,
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
    }),
  );
}

test("the orders list is behind the auth gate", async () => {
  const res = await app.request("/orders");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/login");
});

test("GET /orders lists every order from the API", async () => {
  const res = await get("/orders", await authed());
  assert.equal(res.status, 200);
  const body = await res.text();
  for (const o of orderListRows) assert.match(body, new RegExp(o.reference));
});

test("GET /orders?status= narrows to that status", async () => {
  const res = await get("/orders?status=paid", await authed());
  assert.equal(res.status, 200);
  const body = await res.text();
  // The mock filters to the paid order; the pending one must be absent.
  assert.match(body, new RegExp(paidOrder.reference));
  assert.doesNotMatch(body, /RF74000001/);
});

test("GET /orders.csv returns a csv attachment of the same rows", async () => {
  const res = await get("/orders.csv", await authed());
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type")!, /text\/csv/);
  assert.match(
    res.headers.get("content-disposition")!,
    /attachment; filename="orders.csv"/,
  );
  const body = await res.text();
  assert.match(
    body,
    /^reference,email,status,total_chf,created_at,paid_at,note/,
  );
  assert.match(body, new RegExp(paidOrder.reference));
});

test("GET /orders/:id shows the order and its items", async () => {
  const res = await get(`/orders/${paidOrder.id}`, await authed());
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, new RegExp(paidOrder.reference));
  assert.match(body, new RegExp(paidOrder.items[0].title));
});

test("GET /orders/:id is a 404 page for an unknown order", async () => {
  const res = await get("/orders/999", await authed());
  assert.equal(res.status, 404);
  assert.match(await res.text(), /does not exist/);
});

test("POST status redirects back to the order", async () => {
  const res = await form(`/orders/${paidOrder.id}/status`, await authed(), {
    status: "pending",
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), `/orders/${paidOrder.id}`);
});

test("POST status with a bad value bounces back without calling the API", async () => {
  // If it reached the API the mock would 400/404; the admin rejects it first and
  // just redirects to the order, so onUnhandledRequest never fires.
  const res = await form(`/orders/${paidOrder.id}/status`, await authed(), {
    status: "shipped",
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), `/orders/${paidOrder.id}`);
});

test("POST note saves and redirects; an over-long note is a 400 with the value kept", async () => {
  const cookie = await authed();
  const ok = await form(`/orders/${paidOrder.id}/note`, cookie, {
    note: "Called about pickup.",
  });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get("location"), `/orders/${paidOrder.id}`);

  const tooLong = await form(`/orders/${paidOrder.id}/note`, cookie, {
    note: "x".repeat(2001),
  });
  assert.equal(tooLong.status, 400);
  const body = await tooLong.text();
  assert.match(body, /Keep the note under/);
  assert.match(body, /xxxx/); // the attempted note is preserved in the field
});

test("POST resend redirects with the resent flash", async () => {
  const res = await form(`/orders/${paidOrder.id}/resend`, await authed(), {});
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), `/orders/${paidOrder.id}?sent=1`);
});

test("an unreachable/erroring API reads as a 502 service page", async () => {
  server.use(
    http.get("*/admin/orders", () =>
      HttpResponse.json({ error: "boom" }, { status: 503 }),
    ),
  );
  const res = await get("/orders", await authed());
  assert.equal(res.status, 502);
  assert.match(await res.text(), /could not be reached/);
});

// ---------------------------------------------------------- product screens

test("the products list is behind the auth gate", async () => {
  const res = await app.request("/products");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/login");
});

test("GET /products lists products grouped by drop", async () => {
  const res = await get("/products", await authed());
  assert.equal(res.status, 200);
  const body = await res.text();
  for (const p of adminProducts) assert.match(body, new RegExp(p.name));
  // Each row links to its edit page.
  assert.match(body, new RegExp(`href="/products/${jerseyProduct.id}"`));
});

test("GET /products/:id shows the edit form with the current values", async () => {
  const res = await get(`/products/${jerseyProduct.id}`, await authed());
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, new RegExp(`action="/products/${jerseyProduct.id}"`));
  assert.match(body, new RegExp(`value="${jerseyProduct.slug}"`));
});

test("GET /products/:id is a 404 page for an unknown product", async () => {
  const res = await get("/products/999", await authed());
  assert.equal(res.status, 404);
});

test("POST /products/:id saves and redirects with a flash", async () => {
  const res = await form(`/products/${jerseyProduct.id}`, await authed(), {
    slug: jerseyProduct.slug,
    name: "Redline Jersey v2",
    description: "Updated.",
    price_rappen: "9900",
    fit: "Boxy",
    fit_url: "",
    min_orders: "1",
    status: "live",
    sort: "0",
  });
  assert.equal(res.status, 302);
  assert.equal(
    res.headers.get("location"),
    `/products/${jerseyProduct.id}?saved=1`,
  );
});

test("POST /products/:id keeps the slug error when the API reports a clash", async () => {
  // The cap (product 11) owns redline-cap; the mock's edit handler 409s on it.
  const res = await form(`/products/${jerseyProduct.id}`, await authed(), {
    slug: "redline-cap",
    name: "Redline Jersey",
    price_rappen: "9500",
    min_orders: "1",
    status: "live",
  });
  assert.equal(res.status, 409);
  const body = await res.text();
  assert.match(body, /already in use/);
  // The typed slug is kept in the field.
  assert.match(body, /value="redline-cap"/);
});

test("POST /products/:id is a 400 with values kept when the form is invalid", async () => {
  const res = await form(`/products/${jerseyProduct.id}`, await authed(), {
    slug: "redline-jersey",
    name: "", // required — rejected before the API is called
    price_rappen: "9500",
    min_orders: "1",
    status: "live",
  });
  assert.equal(res.status, 400);
  const body = await res.text();
  // The edit form is re-rendered (its action present), values preserved.
  assert.match(body, new RegExp(`action="/products/${jerseyProduct.id}"`));
});
