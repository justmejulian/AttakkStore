// Presentation helpers shared by the screens and the CSV export. The admin shows
// data the API owns; it never computes money, so these only format for display.

// Rappen as Swiss francs: 19000 -> "190.00". Prices are whole rappen by design
// (see the plan), so this is a pure divide-and-fix, never a parse.
export function formatChf(rappen: number): string {
  return (rappen / 100).toFixed(2);
}

// The stored timestamps are millisecond ISO in UTC. Trim to the minute for the
// screens — seconds and milliseconds are noise when reading an orders list.
export function formatTimestamp(iso: string | null): string {
  if (!iso) return "";
  return iso.replace("T", " ").slice(0, 16) + " UTC";
}
