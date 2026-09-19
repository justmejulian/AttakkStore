import type { OrderListRow } from "@attakk/types";
import { formatChf } from "./format.js";

// The orders list, downloadable as a spreadsheet. This is presentation over the
// same rows the list screen shows — no token (the API's list projection already
// drops it), so nothing here leaks a receipt secret into a file.

// One data field, made safe two ways. First, formula injection: a value opening
// with =, +, -, @, tab or CR is read as a formula by Excel and Sheets, so a
// customer email like `=1+1@x.com` or a crafted note would execute on open —
// prefixing an apostrophe forces the cell to be read as text. Then RFC 4180
// quoting: a value carrying a comma, quote or newline is wrapped and its quotes
// doubled, or it would break the row. The HEADER is not passed through here; its
// words are fixed and safe.
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

const HEADER = [
  "reference",
  "email",
  "status",
  "total_chf",
  "created_at",
  "paid_at",
  "note",
];

export function ordersToCsv(orders: OrderListRow[]): string {
  const rows = orders.map((o) =>
    [
      o.reference,
      o.email,
      o.status,
      formatChf(o.total_rappen),
      o.created_at,
      o.paid_at ?? "",
      o.note,
    ].map(csvField),
  );
  // CRLF line endings, the format Excel and the rest expect from a .csv.
  return [HEADER, ...rows].map((row) => row.join(",")).join("\r\n");
}
