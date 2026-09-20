import { API_URL } from "./config.js";

// The shop holds no database: every catalogue read is a call to the API over the
// internal network. This is the one place those calls are made, so the timeout
// and URL joining live in a single spot rather than being re-inlined per page —
// the same shape the admin's api.ts gives its own calls.

// Node's fetch has no default timeout, so an API that accepts the connection but
// never answers would stall a page render forever. Every call carries this
// deadline; a caller treats a timeout like any other unreachable-API failure.
// Matches the admin's own 10s deadline and the API's SMTP connection timeout.
export const API_TIMEOUT_MS = 10_000;

// A call to the API. Resolves with the Response whatever the status — the caller
// distinguishes a 404 from a real error — and rejects only when the API could
// not be reached at all (down, refused, timed out).
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, API_URL), {
    ...init,
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
}
