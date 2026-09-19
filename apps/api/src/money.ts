// Rappen to a plain "95.00" for display. Amounts are integer rappen everywhere
// in the database and on the bill's amount field; only human-facing recaps turn
// them into francs — the QR bill's summary and the confirmation emails. One
// definition so a total shown in an email can never disagree with the PDF.
export function chf(rappen: number): string {
  return (rappen / 100).toFixed(2);
}
