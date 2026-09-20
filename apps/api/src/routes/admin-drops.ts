import { dropInput } from "@attakk/types";
import { type Context, Hono } from "hono";
import {
  createDrop,
  DropError,
  getDropForAdmin,
  listDropsForAdmin,
  updateDrop,
} from "../repositories/admin-drops.js";
import { parseId } from "./params.js";

// The admin's drop screens, reached over the internal network: the list of every
// drop, any status (the product create form reads it to offer a drop to create
// into), one drop for the edit form, plus create and edit. The archive control is
// a status change, which edit already carries; a dedicated status endpoint lands
// in the next commit. Like the other admin routes it carries no auth of its own;
// the session gate is the admin app's and the private network is the boundary. No
// SQL here; the repository owns it.
export const adminDrops = new Hono();

// Turn a repository DropError into the 4xx it maps to: a slug already in use is a
// conflict with an existing row, so a 409. Anything else is a real fault and
// rethrown to the 500 handler.
function dropError(c: Context, err: unknown): Response {
  if (err instanceof DropError && err.code === "slug_taken") {
    return c.json({ error: err.code }, 409);
  }
  throw err;
}

adminDrops.get("/admin/drops", (c) => c.json(listDropsForAdmin()));

// Create a drop. A bad body is a 400 (with the zod issues) and a slug already
// taken a 409; on success the stored drop comes back 201 so the admin lands on
// its edit screen.
adminDrops.post("/admin/drops", async (c) => {
  const parsed = dropInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  }
  try {
    return c.json(createDrop(parsed.data), 201);
  } catch (err) {
    return dropError(c, err);
  }
});

adminDrops.get("/admin/drops/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);
  const drop = getDropForAdmin(id);
  if (!drop) return c.json({ error: "not_found" }, 404);
  return c.json(drop);
});

// Edit a drop's fields (status included — archiving is a status change). A bad
// body is a 400, a missing drop a 404 and a slug taken by another drop a 409; on
// success the updated drop comes back.
adminDrops.patch("/admin/drops/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);
  const parsed = dropInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  }
  try {
    const drop = updateDrop(id, parsed.data);
    if (!drop) return c.json({ error: "not_found" }, 404);
    return c.json(drop);
  } catch (err) {
    return dropError(c, err);
  }
});
