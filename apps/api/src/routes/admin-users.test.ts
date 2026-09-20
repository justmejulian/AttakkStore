import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { AdminUser } from "@attakk/types";
import { hashPassword } from "../password.js";
import { openTempApi } from "../test-support.js";

const { db, cleanup } = await openTempApi();
seedUsers();
const { adminUsers } = await import("./admin-users.js");

after(() => cleanup());

// Two active admins, inserted directly with fixed timestamps so the list read is
// deterministic. The mutating tests below run in order and drive this pair down
// to a single active admin to exercise the last-admin guard, then restore it.
function seedUsers(): void {
  const insert = db.prepare(
    `INSERT INTO admin_users
       (id, username, password_hash, active, created_at, last_login_at)
     VALUES (@id, @username, @password_hash, @active, @created_at, @last_login_at)`,
  );
  insert.run({
    id: 1,
    username: "admin",
    password_hash: hashPassword("first-admin-password"),
    active: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    last_login_at: null,
  });
  insert.run({
    id: 2,
    username: "editor",
    password_hash: hashPassword("second-admin-password"),
    active: 1,
    created_at: "2026-02-01T00:00:00.000Z",
    last_login_at: null,
  });
}

function post(body: unknown): Promise<Response> {
  return Promise.resolve(
    adminUsers.request("/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function patchActive(id: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    adminUsers.request(`/admin/users/${id}/active`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

test("GET /admin/users lists every admin, ordered by name, without the hash", async () => {
  const res = await adminUsers.request("/admin/users");
  assert.equal(res.status, 200);
  const users = (await res.json()) as AdminUser[];
  assert.deepEqual(
    users.map((u) => u.username),
    ["admin", "editor"],
  );
  // The public shape never carries the password hash out of the API.
  assert.ok(!("password_hash" in users[0]));
});

test("POST /admin/users rejects a duplicate username with a 409", async () => {
  const res = await post({ username: "admin", password: "another-password" });
  assert.equal(res.status, 409);
  assert.equal(
    ((await res.json()) as { error: string }).error,
    "username_taken",
  );
});

test("POST /admin/users rejects a too-short password with a 400", async () => {
  const res = await post({ username: "shortpw", password: "short" });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, "invalid");
});

test("PATCH /admin/users/:id/active is 404 for an unknown user", async () => {
  const res = await patchActive("9999", { active: false });
  assert.equal(res.status, 404);
});

test("PATCH /admin/users/:id/active is 400 on a bad body", async () => {
  const res = await patchActive("2", { active: "nope" });
  assert.equal(res.status, 400);
});

test("PATCH /admin/users/:id/active is 404 for a non-numeric id", async () => {
  const res = await patchActive("abc", { active: false });
  assert.equal(res.status, 404);
});

test("PATCH /admin/users/:id/active deactivates a user", async () => {
  const res = await patchActive("2", { active: false });
  assert.equal(res.status, 200);
  const user = (await res.json()) as AdminUser;
  assert.equal(user.id, 2);
  assert.equal(user.active, 0);
});

test("PATCH /admin/users/:id/active refuses to deactivate the last active admin", async () => {
  // editor was switched off above, so admin is the only active one left; turning
  // it off too would lock everyone out, so the guard returns a 409 and it stays.
  const res = await patchActive("1", { active: false });
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error: string }).error, "last_admin");

  const list = (await (
    await adminUsers.request("/admin/users")
  ).json()) as AdminUser[];
  assert.equal(list.find((u) => u.id === 1)?.active, 1);
});

test("PATCH /admin/users/:id/active restores a deactivated user", async () => {
  const res = await patchActive("2", { active: true });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as AdminUser).active, 1);
});

test("POST /admin/users creates a user and reads it back in the list", async () => {
  const res = await post({
    username: "newbie",
    password: "brand-new-password",
  });
  assert.equal(res.status, 201);
  const created = (await res.json()) as AdminUser;
  assert.equal(created.username, "newbie");
  assert.equal(created.active, 1);
  assert.ok(!("password_hash" in created));

  const list = (await (
    await adminUsers.request("/admin/users")
  ).json()) as AdminUser[];
  assert.ok(list.some((u) => u.username === "newbie"));
});
