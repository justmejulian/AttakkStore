import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { clearSession, getSession, setSession } from "./session.js";

// A throwaway app that exercises the session helpers through real requests:
// setting the cookie, reading it back, and confirming a tampered one reads as no
// session. This is where the signing guarantee is pinned — the routes then trust
// it.
function harness() {
  const app = new Hono();
  app.get("/set", async (c) => {
    await setSession(c, { id: 7, username: "julian" });
    return c.text("ok");
  });
  app.get("/whoami", async (c) => c.json(await getSession(c)));
  app.get("/clear", (c) => {
    clearSession(c);
    return c.text("ok");
  });
  return app;
}

// The `name=value` pair out of a Set-Cookie header, without its attributes, so
// it can be sent straight back as a Cookie header. Split on the first `=` only —
// the signed value carries its own `=` padding.
function cookiePair(setCookie: string): string {
  const eq = setCookie.indexOf("=");
  const value = setCookie.slice(eq + 1).split(";")[0];
  return `${setCookie.slice(0, eq)}=${value}`;
}

test("a session round-trips through a signed cookie", async () => {
  const app = harness();
  const set = await app.request("/set");
  const cookie = cookiePair(set.headers.get("set-cookie")!);

  const who = await app.request("/whoami", { headers: { cookie } });
  assert.deepEqual(await who.json(), { id: 7, username: "julian" });
});

test("no cookie is no session", async () => {
  const who = await harness().request("/whoami");
  assert.equal(await who.json(), null);
});

test("a tampered cookie is rejected", async () => {
  const app = harness();
  const set = await app.request("/set");
  const cookie = cookiePair(set.headers.get("set-cookie")!);

  // Flip the last character of the value; the signature no longer matches, so
  // getSignedCookie returns false and the session reads as absent.
  const eq = cookie.indexOf("=");
  const value = cookie.slice(eq + 1);
  const flipped = value.slice(0, -1) + (value.at(-1) === "A" ? "B" : "A");
  const tampered = `${cookie.slice(0, eq)}=${flipped}`;

  const who = await app.request("/whoami", { headers: { cookie: tampered } });
  assert.equal(await who.json(), null);
});

test("clearing a session expires the cookie", async () => {
  const res = await harness().request("/clear");
  const setCookie = res.headers.get("set-cookie")!;
  assert.match(setCookie, /admin_session=;/);
  assert.match(setCookie, /Max-Age=0|Expires=/i);
});
