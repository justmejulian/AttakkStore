import type { APIRoute } from "astro";
import { cartInput } from "@attakk/types";
import { apiFetch } from "../../../lib/api.js";

export const POST: APIRoute = async ({ request }) => {
  const headers = { "Cache-Control": "no-store" };
  const parsed = cartInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid" }, { status: 400, headers });
  }
  try {
    const response = await apiFetch("/cart/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    if (![200, 400, 422].includes(response.status)) {
      throw new Error(`Cart quote failed: ${response.status}`);
    }
    return Response.json(await response.json(), {
      status: response.status,
      headers,
    });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
};
