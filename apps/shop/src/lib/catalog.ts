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

// The archived collections, in the API's sort order, for the archive grid. The
// mirror of getLiveDrops — a drop that has ended keeps its pieces here. Throws
// on an unreachable or erroring API, so the archive page decides its fallback
// the same way the home page does for the live collections.
export async function getArchivedDrops(): Promise<DropWithProducts[]> {
  const res = await apiFetch("/archive");
  if (!res.ok) {
    throw new Error(`GET /archive failed: ${res.status}`);
  }
  return (await res.json()) as DropWithProducts[];
}

// One collection by slug, live or archived, for its page. A 404 is a real
// answer — the drop does not exist, or is still a draft — so it returns null
// and the page routes to its not-found view; any other non-ok status is an API
// fault and throws, so a hiccup never reads as a missing drop. Both a live and
// an archived drop resolve here: a drop keeps one canonical URL across its life.
export async function getDrop(slug: string): Promise<DropWithProducts | null> {
  const res = await apiFetch(`/drops/${encodeURIComponent(slug)}`);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`GET /drops/${slug} failed: ${res.status}`);
  }
  return (await res.json()) as DropWithProducts;
}
