import { adminActiveInput, adminUserCreateInput } from "@attakk/types";
import { type Context, Hono } from "hono";
import { hashPasswordAsync } from "../password.js";
import {
  AdminUserError,
  createAdminUser,
  listAdminUsers,
  setAdminUserActive,
} from "../repositories/admin-users.js";
import { parseId } from "./params.js";

// The admin's user screen, reached over the internal network: list every admin,
// create another, and deactivate or restore one. There is no delete — `active`
// is a flag, so who did what stays attributable after someone is switched off.
// Like the other admin routes it carries no auth of its own; the session gate is
// the admin app's and the private network is the boundary. The password is the
// one thing that never leaves: it is hashed here and only the public shape (no
// hash) is ever returned. No SQL here; the repository owns it.
export const adminUsers = new Hono();

// Turn a repository AdminUserError into the 4xx it maps to. Both a username
// already taken and a refusal to deactivate the last active admin are conflicts
// with the current state of the table, so both are a 409; the caller tells them
// apart by the error code. Anything else is a real fault and rethrown to the 500
// handler.
function adminUserError(c: Context, err: unknown): Response {
  if (err instanceof AdminUserError) return c.json({ error: err.code }, 409);
  throw err;
}

adminUsers.get("/admin/users", (c) => c.json(listAdminUsers()));

// Create an admin user. A bad body is a 400 (with the zod issues — a too-short
// password, a blank username) and a username already taken a 409; on success the
// public row comes back 201.
adminUsers.post("/admin/users", async (c) => {
  const parsed = adminUserCreateInput.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  }
  try {
    const user = createAdminUser({
      username: parsed.data.username,
      password_hash: await hashPasswordAsync(parsed.data.password),
    });
    return c.json(user, 201);
  } catch (err) {
    return adminUserError(c, err);
  }
});

// Deactivate or restore a user. A missing user is a 404, a bad body a 400, and
// deactivating the last active admin a 409 (last_admin); on success the updated
// public row comes back.
adminUsers.patch("/admin/users/:id/active", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);
  const parsed = adminActiveInput.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return c.json({ error: "invalid" }, 400);

  try {
    const user = setAdminUserActive(id, parsed.data.active);
    if (!user) return c.json({ error: "not_found" }, 404);
    return c.json(user);
  } catch (err) {
    return adminUserError(c, err);
  }
});
