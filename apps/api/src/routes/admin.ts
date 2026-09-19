import { loginInput } from "@attakk/types";
import { Hono } from "hono";
import { verifyPassword } from "../password.js";
import {
  findAdminUserByUsername,
  stampLastLogin,
  toPublicAdminUser,
} from "../repositories/admin-users.js";

// The admin's authentication, reached over the internal network: the admin app
// posts a username and password here, the API verifies them against the scrypt
// hash it stores, and hands back the user's identity for the admin to sign into
// its session cookie. The admin holds no database, so this is the only place a
// password is ever checked. No SQL here — the repository owns it.
export const admin = new Hono();

admin.post("/admin/login", async (c) => {
  const parsed = loginInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);

  const { username, password } = parsed.data;
  const user = findAdminUserByUsername(username);
  // A missing user, a deactivated one and a wrong password are one answer: the
  // caller learns only that the pair did not work, never which half. There is no
  // constant-time dance against username enumeration — the API is internal-only,
  // reachable solely by the shop and admin over the private network, so the
  // timing side channel has no untrusted observer to leak to.
  if (
    !user ||
    !user.active ||
    !(await verifyPassword(password, user.password_hash))
  ) {
    return c.json({ error: "invalid_credentials" }, 401);
  }

  // Return the row as it was read — its last_login_at is the previous login —
  // then record this one. The session only needs id and username; the timestamp
  // is for the admin to show "last seen".
  stampLastLogin(user.id);
  return c.json(toPublicAdminUser(user));
});
