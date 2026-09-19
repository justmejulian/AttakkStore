import type { ScryptOptions } from "node:crypto";
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

// Promise wrapper over the callback scrypt. promisify picks scrypt's option-less
// overload, so it cannot pass the cost parameters; this keeps them. A synchronous
// throw for bad parameters (e.g. a non-power-of-two N) rejects the promise, which
// verifyPassword catches.
function scryptDerive(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

// Admin passwords are stored as scrypt hashes through node:crypto — no native
// dependency to compile, and nothing in the database can be turned back into a
// password. The stored string is self-describing: the algorithm, its cost
// parameters, the random salt and the derived key, all `$`-separated. So a hash
// carries everything verify needs, and the cost can be raised later without
// guessing what parameters an already-stored hash was made with.

const KEYLEN = 64;
// scrypt's cost parameters — Node's own defaults, a sensible interactive cost.
// Naming them keeps the stored format explicit and lets them be raised later.
const N = 16384;
const R = 8;
const P = 1;

// Synchronous by design: the only callers are the one-shot seed CLI and test
// seeds, never a request handler, so blocking here costs nothing that serves
// traffic. Verification, which runs on the API's request path, is async instead.
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

// Async so the scrypt work runs off the event loop: the login route awaits this,
// and the API process it runs in also serves the shop's reads and checkout, so a
// synchronous scrypt would stall every concurrent request for its duration.
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, keyHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const key = Buffer.from(keyHex, "hex");
  // A hash whose salt or key did not decode can never match — treat a malformed
  // stored value as a failed verification rather than letting it throw.
  if (salt.length === 0 || key.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scryptDerive(password, salt, key.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    return false;
  }

  // Constant-time compare so a near-miss password cannot be narrowed byte by
  // byte from how long the check takes. Lengths are guarded first, since
  // timingSafeEqual throws on a mismatch.
  return derived.length === key.length && timingSafeEqual(derived, key);
}
