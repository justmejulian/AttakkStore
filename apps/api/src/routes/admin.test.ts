import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { AdminUser } from "@attakk/types";
import { hashPassword } from "../password.js";
import { openTempApi } from "../test-support.js";

const { db, cleanup } = await openTempApi();
// The route and repository reach the connection, so they are imported after the
// temp DATA_DIR is set (see openTempApi); password is db-free and imported above.
const { admin } = await import("./admin.js");
const { findAdminUserByUsername } =
  await import("../repositories/admin-users.js");

after(() => cleanup());

// One active user and one deactivated one, both with the same known password.
const PASSWORD = "correct-horse-battery-staple";
db.prepare(
  `INSERT INTO admin_users (id, username, password_hash, active) VALUES
     (1, 'julian', @hash, 1),
     (2, 'former', @hash, 0)`,
).run({ hash: hashPassword(PASSWORD) });

function login(body: unknown): Promise<Response> {
  return Promise.resolve(
    admin.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

test("valid credentials return the user without the hash and stamp last_login_at", async () => {
  const res = await login({ username: "julian", password: PASSWORD });
  assert.equal(res.status, 200);
  const user = (await res.json()) as AdminUser & { password_hash?: string };

  assert.equal(user.id, 1);
  assert.equal(user.username, "julian");
  assert.equal(user.password_hash, undefined);
  // The response carries the login before this one — none yet — while the row is
  // now stamped with this login's time.
  assert.equal(user.last_login_at, null);
  const row = findAdminUserByUsername("julian");
  assert.ok(row?.last_login_at);
  assert.match(row.last_login_at, /^\d{4}-\d\d-\d\dT/);
});

test("a wrong password is a 401 with a single generic code", async () => {
  const res = await login({ username: "julian", password: "nope" });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "invalid_credentials" });
});

test("an unknown user is a 401", async () => {
  const res = await login({ username: "ghost", password: PASSWORD });
  assert.equal(res.status, 401);
});

test("a deactivated user cannot log in even with the right password", async () => {
  const res = await login({ username: "former", password: PASSWORD });
  assert.equal(res.status, 401);
});

test("a malformed body is a 400", async () => {
  assert.equal((await login({ username: "julian" })).status, 400);
  assert.equal((await login(null)).status, 400);
  assert.equal((await login({ username: "", password: "x" })).status, 400);
});
