import { setupServer } from "msw/node";
import { handlers } from "./handlers.js";

// The msw/node side of the package, kept out of the main entry so importing
// handlers or fixtures never drags in setupServer. An app enables the mock by
// loading ./register as a preload (see the dev:mock scripts); this is what that
// preload calls. Every call to the API happens server-side, so this is all the
// mock the shop and admin need — the browser service-worker half is never used.

export const server = setupServer(...handlers);

let started = false;

// Start intercepting, once. Un-mocked requests only warn rather than throw:
// a running dev server makes framework requests this package never mocks, and
// crashing on the first of them would be worse than letting it through. The
// contract test, which owns a closed request surface, is where onUnhandledRequest
// is "error".
export function startMockApi(): void {
  if (started) return;
  server.listen({ onUnhandledRequest: "warn" });
  started = true;
  console.log("[mock-api] MSW active — API calls are answered by fixtures");
}
