import { API_URL } from "./config.js";

// The admin holds no database: every read and write is a call to the API over the
// internal network. This is the one place those calls are made, so the timeout
// and URL joining live in a single spot rather than being re-inlined per route.

// Node's fetch has no default timeout, so an API that accepts the connection but
// never answers would stall a request forever. Every call carries this deadline;
// a route treats a timeout like any other unreachable-API failure. Matches the
// API's own 10s SMTP connection timeout.
export const API_TIMEOUT_MS = 10_000;

// A call to the API. Resolves with the Response whatever the status — the caller
// maps 404/5xx to the right screen, the way the login route already does — and
// rejects only when the API could not be reached at all (down, refused, timed
// out), which every caller treats as a 502 service problem.
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, API_URL), {
    ...init,
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
}

// A JSON write with the method and header the API expects. Keeps the admin's
// mutation routes from repeating the stringify/header pair; the admin's forms are
// POSTs but the API's order writes are PATCHes, so the method is a parameter.
export function jsonBody(method: string, value: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}
