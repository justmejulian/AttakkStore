import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { COOKIE_SECURE, SESSION_SECRET } from "./config.js";

// The signed-in admin, as carried in the session cookie: only what a screen
// needs to know who is acting. Everything else about the user is re-read from
// the API when a screen needs it, so nothing stored here can go stale.
export interface Session {
  id: number;
  username: string;
}

const COOKIE_NAME = "admin_session";

// A signed, httpOnly, SameSite=Lax cookie. httpOnly keeps it out of reach of any
// script on the page; SameSite=Lax lets it ride a top-level navigation but not a
// cross-site POST, which is the CSRF guard on the admin's forms; signed means the
// identity inside cannot be forged. Secure comes from config.
export async function setSession(c: Context, session: Session): Promise<void> {
  await setSignedCookie(
    c,
    COOKIE_NAME,
    JSON.stringify(session),
    SESSION_SECRET,
    {
      httpOnly: true,
      sameSite: "Lax",
      secure: COOKIE_SECURE,
      path: "/",
    },
  );
}

// The session if the cookie is present and its signature checks out, else null.
// A tampered or wrongly-signed value (getSignedCookie returns false), a missing
// cookie (undefined) and a payload that no longer parses to a Session all read
// the same: not signed in.
export async function getSession(c: Context): Promise<Session | null> {
  const raw = await getSignedCookie(c, SESSION_SECRET, COOKIE_NAME);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Session).id === "number" &&
      typeof (parsed as Session).username === "string"
    ) {
      const { id, username } = parsed as Session;
      return { id, username };
    }
  } catch {
    // Malformed payload — treated as no session below.
  }
  return null;
}

export function clearSession(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}
