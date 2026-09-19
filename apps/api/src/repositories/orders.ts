import { randomBytes } from "node:crypto";
import type {
  Order,
  OrderInput,
  OrderItem,
  OrderLineInput,
  OrderListRow,
  OrderStatus,
  OrderWithItems,
} from "@attakk/types";
import { db } from "../db.js";
import { rfReference } from "../reference.js";

// The order write path. All SQL lives here. Server-side pricing is the whole
// point: the cart is never trusted, so every line's price and title are read
// from the products table at order time and copied onto the order, and the
// total is summed from those — a tampered cart cannot change the bill.

// Why a line was refused. The route maps these to a 4xx the shop can act on,
// rather than a 500. Anything else (a broken database) stays a thrown 500.
export type OrderErrorCode =
  "product_unavailable" | "size_required" | "size_invalid" | "size_not_allowed";

export class OrderError extends Error {
  constructor(readonly code: OrderErrorCode) {
    super(code);
    this.name = "OrderError";
  }
}

// A product is purchasable only when it is live AND its drop is live. An
// archived drop still serves its pages (the catalogue allows live-or-archived),
// but its pieces cannot be bought, so pricing refuses them here.
const purchasableProductStmt = db.prepare(
  `SELECT p.id, p.name, p.price_rappen
     FROM products p JOIN drops d ON d.id = p.drop_id
    WHERE p.id = ? AND p.status = 'live' AND d.status = 'live'`,
);

const sizeCountStmt = db.prepare(
  `SELECT count(*) AS n FROM product_sizes WHERE product_id = ?`,
);

const sizeBelongsStmt = db.prepare(
  `SELECT 1 FROM product_sizes WHERE id = ? AND product_id = ?`,
);

const insertOrderStmt = db.prepare(
  `INSERT INTO orders (reference, token, email, total_rappen)
   VALUES (@reference, @token, @email, @total_rappen)`,
);
const setReferenceStmt = db.prepare(
  `UPDATE orders SET reference = ? WHERE id = ?`,
);
const insertItemStmt = db.prepare(
  `INSERT INTO order_items
     (order_id, product_id, size_id, qty, unit_price_rappen, title)
   VALUES (@order_id, @product_id, @size_id, @qty, @unit_price_rappen, @title)`,
);

const orderByIdStmt = db.prepare(
  `SELECT id, reference, token, email, phone, total_rappen, status,
          created_at, paid_at, note
     FROM orders WHERE id = ?`,
);
const itemsForOrderStmt = db.prepare(
  `SELECT id, product_id, size_id, qty, unit_price_rappen, title
     FROM order_items WHERE order_id = ? ORDER BY id`,
);

interface ProductRow {
  id: number;
  name: string;
  price_rappen: number;
}

// One priced line ready to insert: the client's product/size/qty with the
// price and title filled in from the database, never from the request.
interface PricedLine {
  product_id: number;
  size_id: number | null;
  qty: number;
  unit_price_rappen: number;
  title: string;
}

function priceLine(line: OrderLineInput): PricedLine {
  const product = purchasableProductStmt.get(line.product_id) as
    ProductRow | undefined;
  if (!product) throw new OrderError("product_unavailable");

  const { n: sizeCount } = sizeCountStmt.get(product.id) as { n: number };
  if (sizeCount > 0) {
    if (line.size_id === null) throw new OrderError("size_required");
    if (!sizeBelongsStmt.get(line.size_id, product.id)) {
      throw new OrderError("size_invalid");
    }
  } else if (line.size_id !== null) {
    throw new OrderError("size_not_allowed");
  }

  return {
    product_id: product.id,
    size_id: line.size_id,
    qty: line.qty,
    unit_price_rappen: product.price_rappen,
    title: product.name,
  };
}

// A 32-hex-char token guarding the receipt URL against a guessed neighbour.
function newToken(): string {
  return randomBytes(16).toString("hex");
}

// A transaction so a bad line throws before any row is written and the whole
// order rolls back. better-sqlite3 wraps this into a plain callable, so it is
// the exported entry point directly rather than behind another function.
export const createOrder = db.transaction(
  (input: OrderInput): OrderWithItems => {
    // Price and validate every line first.
    const priced = input.items.map(priceLine);
    const total = priced.reduce(
      (sum, line) => sum + line.unit_price_rappen * line.qty,
      0,
    );
    const token = newToken();

    // The RF reference is derived from the order id, which only exists after
    // the insert, so the row goes in with the (already unique) token as a
    // placeholder reference and is stamped with its real reference right after.
    const info = insertOrderStmt.run({
      reference: token,
      token,
      email: input.email,
      total_rappen: total,
    });
    const id = Number(info.lastInsertRowid);
    setReferenceStmt.run(rfReference(id), id);

    for (const line of priced) {
      insertItemStmt.run({ order_id: id, ...line });
    }

    const order = getOrder(id);
    if (!order) throw new Error(`order ${id} missing right after insert`);
    return order;
  },
);

export function getOrder(id: number): OrderWithItems | undefined {
  const order = orderByIdStmt.get(id) as Order | undefined;
  if (!order) return undefined;
  const items = itemsForOrderStmt.all(id) as OrderItem[];
  return { ...order, items };
}

// -------------------------------------------------------------- admin reads

// The admin's orders list. Newest first — id descending is creation order, since
// ids are assigned in sequence — optionally narrowed to one status. No items are
// joined: the list shows reference, email, total and status, and the detail view
// loads the lines when a row is opened. The receipt token is deliberately not
// selected: it guards the public receipt URL, so it stays out of the list (and
// its CSV export) — the detail view is where the full order, token included, is
// read.
const listOrdersStmt = db.prepare(
  `SELECT id, reference, email, phone, total_rappen, status,
          created_at, paid_at, note
     FROM orders ORDER BY id DESC`,
);
const listOrdersByStatusStmt = db.prepare(
  `SELECT id, reference, email, phone, total_rappen, status,
          created_at, paid_at, note
     FROM orders WHERE status = ? ORDER BY id DESC`,
);

export function listOrders(status?: OrderStatus): OrderListRow[] {
  const rows = status
    ? listOrdersByStatusStmt.all(status)
    : listOrdersStmt.all();
  return rows as OrderListRow[];
}

// -------------------------------------------------------------- admin writes

const setStatusStmt = db.prepare(
  `UPDATE orders SET status = @status, paid_at = @paid_at WHERE id = @id`,
);
const setNoteStmt = db.prepare(`UPDATE orders SET note = ? WHERE id = ?`);

// Move an order between pending, paid and cancelled. paid_at is the moment it was
// marked paid and is meaningless otherwise, so it is cleared for any non-paid
// state — flipping a mistaken mark back to pending erases the timestamp too. When
// marking paid it is stamped only if not already set, so re-confirming a paid
// order keeps the original payment date rather than resetting it to now; the
// stamp matches created_at's format (millisecond ISO in UTC). Returns undefined
// when no such order exists.
export function setOrderStatus(
  id: number,
  status: OrderStatus,
): OrderWithItems | undefined {
  const existing = getOrder(id);
  if (!existing) return undefined;
  const paid_at =
    status === "paid" ? (existing.paid_at ?? new Date().toISOString()) : null;
  setStatusStmt.run({ id, status, paid_at });
  return getOrder(id);
}

export function setOrderNote(
  id: number,
  note: string,
): OrderWithItems | undefined {
  const info = setNoteStmt.run(note, id);
  if (info.changes === 0) return undefined;
  return getOrder(id);
}
