import { createMiddleware } from "hono/factory";
import { getSession, type Session } from "./session.js";

// The context variables the admin sets on itself. `user` is present on every
// request that passed through requireAuth, so a protected handler reads it
// straight off the context without re-checking the cookie.
export interface AdminEnv {
  Variables: { user: Session };
}

// The gate for every screen but the public ones (health, login, logout): no
// valid session means a redirect to the login page, not a 401 — the admin is
// browsed by a person, so the answer to "not signed in" is "here is the login
// form". A valid session is stashed on the context for the handler to use.
export const requireAuth = createMiddleware<AdminEnv>(async (c, next) => {
  const session = await getSession(c);
  if (!session) return c.redirect("/login");
  c.set("user", session);
  await next();
});
