import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { db } from "./db.js";
import { admin } from "./routes/admin.js";
import { adminDrops } from "./routes/admin-drops.js";
import { adminOrders } from "./routes/admin-orders.js";
import { adminProducts } from "./routes/admin-products.js";
import { adminSettings } from "./routes/admin-settings.js";
import { adminUsers } from "./routes/admin-users.js";
import { catalog } from "./routes/catalog.js";
import { images } from "./routes/images.js";
import { orders } from "./routes/orders.js";

const PORT = Number(process.env.PORT ?? 3000);

// Opening the connection (in ./db) already migrated the schema, so the server
// is ready to serve as soon as this module loads.
const app = new Hono();

// Liveness probe. Reading sqlite_version exercises the better-sqlite3 native
// binding, and user_version confirms the schema is applied, so a broken build
// or an unmigrated volume shows up here rather than on the first query. The API
// is internal-only, so this is the one route reachable now.
app.get("/health", (c) => {
  const { version } = db
    .prepare("select sqlite_version() as version")
    .get() as { version: string };
  const schema = db.pragma("user_version", { simple: true }) as number;
  return c.json({ status: "ok", service: "api", sqlite: version, schema });
});

// Public catalogue reads for the storefront: /drops, /drops/:slug,
// /products/:slug.
app.route("/", catalog);

// The write path: POST /orders prices the cart server-side and creates the
// order with its RF reference.
app.route("/", orders);

// The admin's image writes: attach a processed photo to a product, or remove
// one. Reached over the internal network only.
app.route("/", images);

// The admin's authentication: POST /admin/login verifies a username and password
// against the stored scrypt hash and returns the user for the admin's session.
app.route("/", admin);

// The admin's order screens: list, detail, mark paid/cancelled, edit the note,
// resend the QR bill. Reached over the internal network only.
app.route("/", adminOrders);

// The admin's product screens: list every product by drop with an ordered-units
// tally, and one product with its sizes and images for editing. Internal only.
app.route("/", adminProducts);

// The admin's drop reads: every drop, any status — the product create form reads
// this to offer a drop to create into. Internal only.
app.route("/", adminDrops);

// The admin's Settings screen: read and save shop-open, the QR-bill creditor and
// the notification address. Internal only.
app.route("/", adminSettings);

// The admin's Users screen: list admins, create another, deactivate or restore
// one. Internal only.
app.route("/", adminUsers);

serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
  console.log(`api listening on :${port}`);
});
