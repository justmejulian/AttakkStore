import { Hono } from "hono";
import {
  getDropForAdmin,
  listDropsForAdmin,
} from "../repositories/admin-drops.js";
import { parseId } from "./params.js";

// The admin's drop screens, reached over the internal network: the list of every
// drop, any status (the product create form reads it to offer a drop to create
// into), and one drop for the edit form. Create, edit and the archive control
// arrive in later commits. Like the other admin routes it carries no auth of its
// own; the session gate is the admin app's and the private network is the
// boundary. No SQL here; the repository owns it.
export const adminDrops = new Hono();

adminDrops.get("/admin/drops", (c) => c.json(listDropsForAdmin()));

adminDrops.get("/admin/drops/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);
  const drop = getDropForAdmin(id);
  if (!drop) return c.json({ error: "not_found" }, 404);
  return c.json(drop);
});
