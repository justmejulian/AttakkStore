import type { OrderWithItems } from "@attakk/types";
import PDFDocument from "pdfkit";
import { SwissQRBill } from "swissqrbill/pdf";
import type { Creditor, Data } from "swissqrbill/types";

// The Swiss QR bill the customer is emailed and pays from their banking app. A
// standard IBAN, not a QR-IBAN, so the payment part carries the order's RF
// creditor reference rather than a QR reference (see reference.ts). No SQL here:
// this renders an order the repository already priced, from the creditor the
// settings reader already resolved.

// Rappen to a plain "95.00" for display. Amounts are integer rappen everywhere
// else; only the bill's amount field and this recap turn them into francs.
function chf(rappen: number): string {
  return (rappen / 100).toFixed(2);
}

// The payload swissqrbill encodes. Pulled out of the render so the parts that
// matter — the franc amount off the rappen total, the RF reference, the
// creditor — are unit-testable without parsing a PDF. No debtor: only an email
// is collected (pickup only), so the payer fields are left blank for the
// customer's banking app to fill in.
export function billData(order: OrderWithItems, creditor: Creditor): Data {
  return {
    currency: "CHF",
    amount: order.total_rappen / 100,
    reference: order.reference,
    creditor,
  };
}

// A short recap above the payment part so the PDF says what was ordered, with
// the pickup and lead-time wording from the current site. Sizes are not shown
// here — order_items carries the size id, not its label, and keeping this
// SQL-free means it renders whatever the repository handed over.
function renderRecap(pdf: PDFKit.PDFDocument, order: OrderWithItems): void {
  pdf.font("Helvetica-Bold").fontSize(20).text("ATTAKK");
  pdf.font("Helvetica").fontSize(12).text("Order confirmation");
  pdf.moveDown();

  pdf.text(`Order ${order.reference}`);
  pdf.text(order.created_at.slice(0, 10));
  pdf.moveDown();

  for (const item of order.items) {
    pdf.text(`${item.qty}× ${item.title}`, { continued: true });
    pdf.text(`CHF ${chf(item.unit_price_rappen * item.qty)}`, {
      align: "right",
    });
  }
  pdf.font("Helvetica-Bold").text("Total", { continued: true });
  pdf.text(`CHF ${chf(order.total_rappen)}`, { align: "right" });
  pdf.font("Helvetica").moveDown();

  pdf.text(
    "Made on demand. Ready for pickup at ATTAKK HQ in roughly 6–10 weeks. " +
      "Pay the attached QR bill from your banking app; we'll be in touch when " +
      "your order is ready to collect.",
  );
}

// Render the whole PDF and resolve with it as a single Buffer, so the caller
// (the confirmation email, a later step) can attach it without touching a file.
// Everything runs inside the executor so a validation failure comes back as a
// rejected promise the caller can catch, not a synchronous throw that escapes a
// Promise<Buffer> signature.
export function generateQrBill(
  order: OrderWithItems,
  creditor: Creditor,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    try {
      renderRecap(pdf, order);
      // The constructor validates the data and throws on an invalid IBAN or
      // reference; ours are generated, so this only fires on a misconfigured
      // creditor. attachTo drops the payment part at the foot of the A4 page.
      new SwissQRBill(billData(order, creditor), { language: "EN" }).attachTo(
        pdf,
      );
      pdf.end();
    } catch (err) {
      pdf.destroy(); // don't leave the stream dangling on a validation error
      reject(err);
    }
  });
}
