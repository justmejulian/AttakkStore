/**
 * @attakk/mocks — MSW handlers and the fixtures behind them, shared by the shop
 * and admin so neither needs the API running to be built, and replayed by the
 * API's own contract test so the fixtures can never drift from what its real
 * routes return. Dev-only: resolved through the `source` export condition and
 * pulled in as a devDependency, so it and msw stay out of every production
 * image.
 *
 * Consumers wire it as `setupServer(...handlers)` from msw/node, gated by
 * MOCK_API=1. The browser service-worker half of MSW is never used, since every
 * call to the API happens server-side.
 */

export { handlers } from "./handlers.js";
export * from "./fixtures.js";
