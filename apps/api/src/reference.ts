// ISO 11649 RF Creditor Reference. The IBAN is a standard one, not a QR-IBAN,
// so the bill carries an RF reference rather than a QR reference. Its two check
// digits matter because the reference is matched by eye against a bank export:
// a mistyped one fails the check instead of silently matching another order.
//
// The reference body is the order id, zero-padded, so references sort in order
// and stay short. The check digits follow ISO 7064 mod-97-10: move "RF00" to
// the end, map each letter A–Z to 10–35, and the check is 98 minus the whole
// lot taken mod 97.

const BODY_WIDTH = 6;

export function rfReference(orderId: number): string {
  const body = String(orderId).padStart(BODY_WIDTH, "0");
  return `RF${checkDigits(body)}${body}`;
}

function checkDigits(body: string): string {
  const check = 98 - mod97(`${body}RF00`);
  return String(check).padStart(2, "0");
}

// mod 97 over the letter-expanded string, folded digit by digit so the number
// never has to fit in a JS integer.
function mod97(input: string): number {
  let remainder = 0;
  for (const digit of expandLetters(input)) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

// A–Z become 10–35; digits pass through. The only letters here are the "RF" of
// the appended "RF00", but keeping it general is what makes it the standard.
function expandLetters(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    out += code >= 65 && code <= 90 ? String(code - 55) : ch;
  }
  return out;
}
