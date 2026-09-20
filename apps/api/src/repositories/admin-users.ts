import type { AdminUser } from "@attakk/types";
import { db } from "../db.js";

// The admin_users rows. All SQL lives here; the login route verifies the hash
// and the seed CLI creates the first user, but neither writes SQL. The only
// caller that ever sees the password hash is the login route, to verify it — the
// public shape (AdminUser) drops it before anything leaves the API.

// The internal row, hash included, as the login route needs it to verify.
export interface AdminUserRow extends AdminUser {
  password_hash: string;
}

// A create or active-flip that the admin-users route turns into a 4xx rather
// than a 500: a username already taken, and the refusal to deactivate the last
// active admin (which would lock everyone out of the panel).
export class AdminUserError extends Error {
  constructor(public readonly code: "username_taken" | "last_admin") {
    super(code);
    this.name = "AdminUserError";
  }
}

// username is the only UNIQUE column on admin_users, so a unique-constraint
// failure on an insert is always a clash on it. Catching the constraint instead
// of a pre-check SELECT avoids a check-then-insert race and keeps the DB the
// single arbiter — the same pattern the products repository uses for its slug.
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

const PUBLIC_COLUMNS = `id, username, active, created_at, last_login_at`;

const findByUsernameStmt = db.prepare(
  `SELECT ${PUBLIC_COLUMNS}, password_hash FROM admin_users WHERE username = ?`,
);

const stampLastLoginStmt = db.prepare(
  `UPDATE admin_users
      SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?`,
);

const insertStmt = db.prepare(
  `INSERT INTO admin_users (username, password_hash)
   VALUES (@username, @password_hash)
   RETURNING ${PUBLIC_COLUMNS}`,
);

const listStmt = db.prepare(
  `SELECT ${PUBLIC_COLUMNS} FROM admin_users ORDER BY username COLLATE NOCASE, id`,
);

const getByIdStmt = db.prepare(
  `SELECT ${PUBLIC_COLUMNS} FROM admin_users WHERE id = ?`,
);

const activeCountStmt = db.prepare(
  `SELECT COUNT(*) AS n FROM admin_users WHERE active = 1`,
);

const setActiveStmt = db.prepare(
  `UPDATE admin_users SET active = @active WHERE id = @id
   RETURNING ${PUBLIC_COLUMNS}`,
);

export function findAdminUserByUsername(
  username: string,
): AdminUserRow | undefined {
  return findByUsernameStmt.get(username) as AdminUserRow | undefined;
}

export function stampLastLogin(id: number): void {
  stampLastLoginStmt.run(id);
}

// Creates a user and returns the public row (no hash). username is UNIQUE, so a
// duplicate is turned into a named AdminUserError the callers (the route and the
// seed CLI) report plainly rather than surfacing a raw SqliteError.
export function createAdminUser(user: {
  username: string;
  password_hash: string;
}): AdminUser {
  try {
    return insertStmt.get(user) as AdminUser;
  } catch (err) {
    if (isUniqueViolation(err)) throw new AdminUserError("username_taken");
    throw err;
  }
}

// Every admin user, public shape, ordered by name so the panel's list is stable.
export function listAdminUsers(): AdminUser[] {
  return listStmt.all() as AdminUser[];
}

// Deactivate or restore a user, returning the updated public row (undefined when
// no such user, which the route turns into a 404). Wrapped in a transaction so
// the last-admin count and the update cannot race a concurrent flip: deactivating
// the last active admin would lock everyone out of the panel — recoverable only
// by the seed CLI on the server — so it is refused with a last_admin error. A
// user that is already inactive is a no-op and never trips the guard.
export const setAdminUserActive = db.transaction(
  (id: number, active: boolean): AdminUser | undefined => {
    const existing = getByIdStmt.get(id) as AdminUser | undefined;
    if (!existing) return undefined;
    if (!active && existing.active === 1) {
      const { n } = activeCountStmt.get() as { n: number };
      if (n <= 1) throw new AdminUserError("last_admin");
    }
    return setActiveStmt.get({ id, active: active ? 1 : 0 }) as AdminUser;
  },
);

// Drops the password hash from an internal row, so only the public shape leaves.
export function toPublicAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    username: row.username,
    active: row.active,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
  };
}
