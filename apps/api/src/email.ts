import type { OrderWithItems } from "@attakk/types";
import nodemailer from "nodemailer";
import type { SendMailOptions } from "nodemailer/lib/mailer";
import { getCreditor } from "./creditor.js";
import { chf } from "./money.js";
import { generateQrBill } from "./qrbill.js";
import { getSetting, SETTINGS_KEYS } from "./repositories/settings.js";

// The confirmation email. Once an order is created the customer is sent their
// QR bill as a PDF attachment with the pickup wording, and the shop gets a
// plain notification for each new order. Mail goes out over SMTP — Infomaniak
// in production. The credentials are config, never in the repo or the database,
// so they are read from the environment here.
//
// Sending is best-effort. The order is already committed and the receipt page
// reads it back from the database, so a mail failure is logged and swallowed
// rather than turned into a failed order the customer already completed. An
// unconfigured mailer (dev, tests, staging without secrets) skips sending.

export interface EmailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  notifyTo: string;
}

// Read the mailer config from the environment, or null when an essential field
// is missing so the caller skips sending instead of throwing. Port defaults to
// 465 (implicit TLS). The notification address is the admin's Settings value
// first — the shop edits where its heads-up goes without a redeploy — then the
// NOTIFY_EMAIL env var, and finally the sender, so a configured shop always gets
// its own copy. The SMTP secrets stay in the environment (never the DB); only
// the recipient is a setting.
export function emailConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): EmailConfig | null {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM } = env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) return null;
  const notifySetting = getSetting(SETTINGS_KEYS.notify_email);
  return {
    host: SMTP_HOST,
    port: Number(env.SMTP_PORT || 465),
    user: SMTP_USER,
    pass: SMTP_PASS,
    from: SMTP_FROM,
    notifyTo: notifySetting || env.NOTIFY_EMAIL || SMTP_FROM,
  };
}

// One line per ordered item, indented under a heading. Sizes are not shown —
// order_items carries the size id, not its label — matching the PDF recap.
function itemLines(order: OrderWithItems): string[] {
  return order.items.map(
    (item) =>
      `  ${item.qty}× ${item.title} — CHF ${chf(item.unit_price_rappen * item.qty)}`,
  );
}

// The customer's confirmation, with the QR bill attached. Plain text on purpose:
// a bill-carrying transactional mail reads as more trustworthy to a spam filter
// than a marketing HTML blast, which is the shape SPF/DKIM checks are set up to
// protect (see the ops plan).
export function buildConfirmationEmail(
  config: EmailConfig,
  order: OrderWithItems,
  pdf: Buffer,
): SendMailOptions {
  const body = [
    "Thanks for your order.",
    "",
    `Order ${order.reference}`,
    ...itemLines(order),
    `  Total — CHF ${chf(order.total_rappen)}`,
    "",
    "Made on demand. Your pieces will be ready for pickup at ATTAKK HQ in",
    "roughly 6–10 weeks. Pay the attached QR bill from your banking app and",
    "we'll be in touch when your order is ready to collect.",
  ].join("\n");
  return {
    from: config.from,
    to: order.email,
    // Always a blind copy to the sender mailbox: SMTP submission leaves nothing
    // in a Sent folder, so this is the shop's record of what actually went out.
    // The sender, not notifyTo, so it holds even when notifications are rerouted.
    bcc: config.from,
    subject: `Your ATTAKK order ${order.reference}`,
    text: body,
    attachments: [
      {
        filename: `attakk-${order.reference}.pdf`,
        content: pdf,
        contentType: "application/pdf",
      },
    ],
  };
}

// The shop's heads-up for a new order. No attachment — the PDF is the
// customer's; the reference is enough to find the order in the admin and match
// the payment against the bank export.
export function buildNotificationEmail(
  config: EmailConfig,
  order: OrderWithItems,
): SendMailOptions {
  const body = [
    `New order ${order.reference}`,
    `From ${order.email}`,
    "",
    ...itemLines(order),
    `  Total — CHF ${chf(order.total_rappen)}`,
  ].join("\n");
  return {
    from: config.from,
    to: config.notifyTo,
    subject: `New order ${order.reference} — CHF ${chf(order.total_rappen)}`,
    text: body,
  };
}

// Generate the bill, then send the customer's confirmation and the shop's
// notification. Never throws: an unconfigured or failing mailer is logged and
// the order — already committed — stands. Config is injectable so the message
// building can be exercised without a live SMTP server.
//
// The shop notification is independent of the QR bill: a creditor/PDF failure
// drops only the customer's confirmation, so the shop still learns of the order.
// The two sends run concurrently, and each failure is logged on its own so one
// does not mask the other. Explicit timeouts keep a hung SMTP server from tying
// up this background task indefinitely.
export async function sendOrderConfirmation(
  order: OrderWithItems,
  config: EmailConfig | null = emailConfigFromEnv(),
): Promise<void> {
  if (!config) {
    console.warn(
      `SMTP not configured; skipping mail for order ${order.reference}`,
    );
    return;
  }

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465, // implicit TLS on 465, STARTTLS otherwise
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  const mails: SendMailOptions[] = [buildNotificationEmail(config, order)];
  try {
    const pdf = await generateQrBill(order, getCreditor());
    mails.push(buildConfirmationEmail(config, order, pdf));
  } catch (err) {
    console.error(`failed to build QR bill for order ${order.reference}:`, err);
  }

  const results = await Promise.allSettled(
    mails.map((mail) => transport.sendMail(mail)),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(
        `failed to send mail for order ${order.reference}:`,
        result.reason,
      );
    }
  }
}
