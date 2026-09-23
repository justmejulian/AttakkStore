import type { ReceiptOrder } from "@attakk/types";
import { apiFetch } from "./api.js";

export async function getReceiptOrder(
  reference: string,
  token: string,
): Promise<ReceiptOrder | null> {
  const response = await apiFetch(
    `/orders/${encodeURIComponent(reference)}?token=${encodeURIComponent(token)}`,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Receipt read failed: ${response.status}`);
  return (await response.json()) as ReceiptOrder;
}
