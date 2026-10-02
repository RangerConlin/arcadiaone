export type MoneyLine = { quantity: string | number; unitPrice: string | number; discountAmount?: string | number | null; taxRate?: string | number | null };
const SCALE = BigInt(10000);
function scaled(value: string | number | null | undefined, scale = SCALE) {
  const raw = String(value ?? 0).trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw new Error(`Invalid decimal: ${raw}`);
  const negative = raw.startsWith("-");
  const [whole, fraction = ""] = raw.replace("-", "").split(".");
  const digits = scale.toString().length - 1;
  const result = BigInt(whole) * scale + BigInt((fraction + "0".repeat(digits)).slice(0, digits));
  return negative ? -result : result;
}
function cents(value: string | number | null | undefined) { return (scaled(value) + BigInt(50)) / BigInt(100); }
export function money(c: bigint) { return `${c < 0 ? "-" : ""}${(c < 0 ? -c : c) / BigInt(100)}.${((c < 0 ? -c : c) % BigInt(100)).toString().padStart(2, "0")}`; }
export function calculateLine(line: MoneyLine) {
  const quantity = scaled(line.quantity), unit = cents(line.unitPrice), discount = cents(line.discountAmount);
  if (quantity <= BigInt(0) || unit < BigInt(0) || discount < BigInt(0)) throw new Error("Quantity must be positive and monetary values cannot be negative.");
  const gross = (quantity * unit + SCALE / BigInt(2)) / SCALE;
  if (discount > gross) throw new Error("Discount cannot exceed the line amount.");
  const net = gross - discount;
  const rate = scaled(line.taxRate);
  if (rate < BigInt(0) || rate > BigInt(100) * SCALE) throw new Error("Tax rate must be between 0 and 100.");
  const tax = (net * rate + BigInt(50) * SCALE) / (BigInt(100) * SCALE);
  return { subtotal: money(gross), discount: money(discount), tax: money(tax), total: money(net + tax) };
}
export function calculateInvoice(lines: MoneyLine[], invoiceDiscount: string | number = 0) {
  const calculated = lines.map(calculateLine);
  const sum = (key: keyof typeof calculated[number]) => calculated.reduce((n, line) => n + cents(line[key]), BigInt(0));
  const subtotal = sum("subtotal"), lineDiscount = sum("discount"), tax = sum("tax"), extraDiscount = cents(invoiceDiscount);
  if (extraDiscount < BigInt(0) || extraDiscount > subtotal - lineDiscount) throw new Error("Invoice discount is invalid.");
  const discount = lineDiscount + extraDiscount, total = subtotal - discount + tax;
  return { lines: calculated, subtotal: money(subtotal), discountTotal: money(discount), taxTotal: money(tax), total: money(total) };
}
export function effectiveInvoiceStatus(status:string,dueDate:Date|null,balance:string|number,now=new Date()) { return status!=="VOID"&&status!=="DRAFT"&&status!=="PAID"&&dueDate&&dueDate<now&&Number(balance)>0 ? "OVERDUE" : status; }
