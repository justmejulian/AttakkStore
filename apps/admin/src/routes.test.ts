import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { adminCredentials } from "@attakk/mocks";
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
