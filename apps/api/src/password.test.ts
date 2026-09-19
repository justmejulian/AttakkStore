import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "./password.js";

test("a hash verifies against its own password", async () => {
  const hash = hashPassword("s3cret-passphrase");
  assert.equal(await verifyPassword("s3cret-passphrase", hash), true);
});

test("a wrong or empty password does not verify", async () => {
  const hash = hashPassword("s3cret-passphrase");
  assert.equal(await verifyPassword("s3cret-passphras", hash), false);
  assert.equal(await verifyPassword("", hash), false);
});

test("the same password hashes to a different string each time", () => {
  // A random salt per hash, so two hashes of one password never collide — what
  // stops the store revealing which admins share a password.
  assert.notEqual(hashPassword("same"), hashPassword("same"));
});

test("a malformed stored hash is rejected, not thrown", async () => {
  for (const bad of [
    "",
    "nope",
    "scrypt$1",
    "md5$16384$8$1$aa$bb",
    "scrypt$16384$8$1$$",
  ]) {
    assert.equal(await verifyPassword("whatever", bad), false);
  }
});
