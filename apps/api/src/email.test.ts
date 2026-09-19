import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { OrderWithItems } from "@attakk/types";
import { openTempApi } from "./test-support.js";

// email.ts pulls in the creditor reader, which prepares a statement against the
// db singleton at import time, so open a throwaway database before importing.
const { cleanup } = await openTempApi();
const {
  buildConfirmationEmail,
  buildNotificationEmail,
  emailConfigFromEnv,
  sendOrderConfirmation,
} = await import("./email.js");

after(() => cleanup());

const config = {
  host: "mail.example.com",
  port: 465,
  user: "shop@example.com",
  pass: "secret",
  from: "shop@example.com",
  notifyTo: "orders@example.com",
};

const order: OrderWithItems = {
  id: 1,
  reference: "RF18539007547034",
  token: "0".repeat(32),
  email: "buyer@example.com",
  phone: "",
  total_rappen: 19000,
  status: "pending",
  created_at: "2026-09-19T10:00:00.000Z",
  paid_at: null,
  note: "",
  items: [
    {
      id: 1,
      product_id: 10,
      size_id: 1,
      qty: 2,
      unit_price_rappen: 9500,
      title: "Redline Jersey",
    },
  ],
};

test("reads SMTP config from the environment with sensible defaults", () => {
  const cfg = emailConfigFromEnv({
    SMTP_HOST: "mail.infomaniak.com",
    SMTP_USER: "shop@atk-collective.ch",
    SMTP_PASS: "secret",
    SMTP_FROM: "shop@atk-collective.ch",
  });
  assert.ok(cfg);
  assert.equal(cfg.port, 465); // default when SMTP_PORT is unset
  assert.equal(cfg.notifyTo, "shop@atk-collective.ch"); // falls back to the sender
});

test("is unconfigured when an essential field is missing", () => {
  // A half-set environment must not send: no SMTP_PASS means null, so the caller
  // skips rather than opening a transport that would fail to authenticate.
  assert.equal(
    emailConfigFromEnv({ SMTP_HOST: "mail.example.com", SMTP_USER: "u" }),
    null,
  );
  assert.equal(emailConfigFromEnv({}), null);
});

test("uses NOTIFY_EMAIL for the notification address when set", () => {
  const cfg = emailConfigFromEnv({
    SMTP_HOST: "mail.example.com",
    SMTP_USER: "u",
    SMTP_PASS: "p",
    SMTP_FROM: "shop@example.com",
    NOTIFY_EMAIL: "orders@example.com",
  });
  assert.equal(cfg?.notifyTo, "orders@example.com");
});

test("confirmation email goes to the customer with the QR bill attached", () => {
  const pdf = Buffer.from("%PDF-1.7 fake");
  const mail = buildConfirmationEmail(config, order, pdf);

  assert.equal(mail.to, "buyer@example.com");
  assert.match(String(mail.subject), /RF18539007547034/);
  assert.match(String(mail.text), /6–10 weeks/); // the pickup lead-time wording
  assert.match(String(mail.text), /CHF 190.00/); // total off the rappen sum

  assert.equal(mail.attachments?.length, 1);
  const [att] = mail.attachments!;
  assert.equal(att.filename, "attakk-RF18539007547034.pdf");
  assert.equal(att.contentType, "application/pdf");
  assert.equal(att.content, pdf);
});

test("notification email goes to the shop, no attachment", () => {
  const mail = buildNotificationEmail(config, order);

  assert.equal(mail.to, "orders@example.com");
  assert.match(String(mail.subject), /RF18539007547034/);
  assert.match(String(mail.subject), /CHF 190.00/);
  assert.match(String(mail.text), /buyer@example.com/);
  assert.equal(mail.attachments, undefined);
});

test("skips silently, never throws, when SMTP is unconfigured", async () => {
  // The order is already committed; an unconfigured mailer must not fail the
  // request, so the send resolves rather than rejecting.
  await assert.doesNotReject(sendOrderConfirmation(order, null));
});
