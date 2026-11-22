// Admin configuration, read once from the environment. The admin holds no
// database of its own, so all of its configuration is process env: where the
// API lives, the secret its session cookies are signed with, and whether those
// cookies carry the Secure flag. Secrets are config, never the repo — the host
// sets them with `dokku config:set`.

// Where the API answers. Defaults to localhost in dev; compose and Dokku point
// this at the API service on the shared internal network.
export const API_URL = process.env.API_URL ?? "http://localhost:3000";

// Where the shop serves product photos from, e.g. https://atk-collective.ch/uploads.
// The admin has no uploads volume of its own, so with this set the image
// thumbnails load the real derivative from the shop; unset, they fall back to the
// inlined blurred placeholder.
export const UPLOADS_URL = (process.env.UPLOADS_URL ?? "").replace(/\/+$/, "");

// The key admin session cookies are signed with. A signed cookie cannot be
// forged or tampered with, so the identity carried inside it can be trusted
// without a server-side session store — the admin keeps none. The default is a
// dev-only placeholder; production must set a real secret via config. A missing
// one in production is fatal rather than a warning: the fallback below is printed
// in this file, so signing real sessions with it would let anyone who can reach
// the login page forge an admin session. Failing the boot makes a forgotten
// `dokku config:set` a visibly broken deploy instead of a silent auth bypass.
const DEV_SESSION_SECRET = "dev-only-insecure-admin-session-secret";
const configuredSecret = process.env.SESSION_SECRET;
if (process.env.NODE_ENV === "production" && !configuredSecret) {
  throw new Error(
    "SESSION_SECRET must be set in production — refusing to sign sessions with the insecure dev default. Set it with `dokku config:set`.",
  );
}
export const SESSION_SECRET = configuredSecret ?? DEV_SESSION_SECRET;

// The admin is reached over a loopback SSH tunnel, not HTTPS, so Secure is off
// by default — a Secure cookie would never be sent back over plain http and
// login would silently fail. It is turned on from config the day the admin moves
// behind TLS, with no code change (see the plan's session note).
export const COOKIE_SECURE = process.env.COOKIE_SECURE === "1";
