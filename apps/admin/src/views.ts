import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Session } from "./session.js";

// Server-rendered HTML, plain forms, no client framework and no build step — the
// admin is presentation over the API. This is a deliberately spare shell; the
// real styling and the seven screens land in the steps that follow. What matters
// at this step is that login, the session and the auth gate work end to end.

// hono/html returns a promise when any interpolated value is one, so both the
// body passed in and the page handed back are the async-or-sync union; c.html
// accepts either.
type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

function layout(title: string, body: Html): Html {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title} · attakk admin</title>
      </head>
      <body>
        ${body}
      </body>
    </html>`;
}

// The login form. `error` shows above the fields when a prior attempt failed;
// the username is preserved so a wrong password does not also wipe the field.
// Interpolated values are escaped by hono/html, so a value echoed back into the
// form cannot inject markup.
export function loginPage(opts: { error?: string; username?: string } = {}) {
  return layout(
    "Sign in",
    html`<main>
      <h1>attakk admin</h1>
      ${opts.error ? html`<p role="alert">${opts.error}</p>` : ""}
      <form method="post" action="/login">
        <label
          >Username
          <input
            name="username"
            value="${opts.username ?? ""}"
            autocomplete="username"
            autofocus
            required
        /></label>
        <label
          >Password
          <input
            name="password"
            type="password"
            autocomplete="current-password"
            required
        /></label>
        <button type="submit">Sign in</button>
      </form>
    </main>`,
  );
}

// The signed-in landing page: enough to prove the session round-trips and the
// gate lets a valid one through, plus the logout control. The actual dashboard
// replaces this in a later step.
export function homePage(user: Session) {
  return layout(
    "Home",
    html`<main>
      <p>Signed in as <strong>${user.username}</strong>.</p>
      <form method="post" action="/logout">
        <button type="submit">Sign out</button>
      </form>
    </main>`,
  );
}
