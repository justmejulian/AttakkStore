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

export function findAdminUserByUsername(
  username: string,
): AdminUserRow | undefined {
  return findByUsernameStmt.get(username) as AdminUserRow | undefined;
}

export function stampLastLogin(id: number): void {
  stampLastLoginStmt.run(id);
}

// Creates a user and returns the public row (no hash). username is UNIQUE, so a
// duplicate throws the SqliteError the seed CLI turns into a plain message.
export function createAdminUser(user: {
  username: string;
  password_hash: string;
}): AdminUser {
  return insertStmt.get(user) as AdminUser;
}

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
