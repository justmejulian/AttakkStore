// A positive integer route id, or null. Non-numeric or non-positive means no
// such row, which the handlers answer with a 404. Shared by the routes that take
// an :id, so they parse it one way.
export function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
