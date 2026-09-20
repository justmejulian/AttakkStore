import { Hono } from "hono";
import { listDropsForAdmin } from "../repositories/admin-drops.js";

// The admin's drop screens, reached over the internal network. For now just the
// list — every drop, any status — which the product create form reads to offer a
// drop to create into. Drop editing, theming and the archive control arrive with
// the drops step. Like the other admin routes it carries no auth of its own; the
// session gate is the admin app's and the private network is the boundary. No SQL
// here; the repository owns it.
export const adminDrops = new Hono();

adminDrops.get("/admin/drops", (c) => c.json(listDropsForAdmin()));
