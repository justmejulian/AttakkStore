import type { DropWithProducts } from "@attakk/types";
import { apiFetch } from "./api.js";

// The catalogue reads the storefront makes. Each returns the typed shape the
// API's routes hand back — the same contract packages/mocks answers in dev — so
// a page consumes drops and products without knowing the fetch happened. No
// shape is re-validated here: packages/types is the one definition both sides
// compile against, and the API is the only writer.

// The live collections, in the API's sort order, for the home page. A draft
// drop is filtered out at the query, so nothing unpublished can reach the shop
// by asking. Throws if the API is unreachable or answers with an error — the
// page decides what to render when the catalogue can't be read (the plan's
// last-known-good cache lands with the backend cache, deferred from step 9).
export async function getLiveDrops(): Promise<DropWithProducts[]> {
  const res = await apiFetch("/drops");
  if (!res.ok) {
    throw new Error(`GET /drops failed: ${res.status}`);
  }
  return (await res.json()) as DropWithProducts[];
}
