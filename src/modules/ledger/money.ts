import { Prisma } from "@/generated/prisma/client";

/** Exact decimal helpers. Money is never handled as a JavaScript number. */
export type Money = Prisma.Decimal;
export const ZERO = new Prisma.Decimal(0);

/** Parses user input such as "1,250.50" or "-12.5" (max 2 decimals, 12 integer digits). Returns null if invalid. */
export function parseMoney(input: string | null | undefined): Money | null {
  const cleaned = String(input ?? "").trim().replaceAll(",", "");
  if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(cleaned)) return null;
  return new Prisma.Decimal(cleaned);
}

export const toDecimal = (value: Prisma.Decimal | string | number | null | undefined): Money => new Prisma.Decimal(value ?? 0);
export const sum = (values: Array<Prisma.Decimal | string | null | undefined>): Money => values.reduce<Money>((total, value) => total.plus(toDecimal(value)), ZERO);

/** "1234.5" -> "1,234.50"; always two decimals, no float conversion. */
export function formatDecimal(value: Prisma.Decimal | string | null | undefined): string {
  const fixed = toDecimal(value).toFixed(2);
  const negative = fixed.startsWith("-");
  const [integer, fraction] = fixed.replace("-", "").split(".");
  return `${negative ? "-" : ""}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

export const formatMoney = (value: Prisma.Decimal | string | null | undefined, currency: string) => `${currency} ${formatDecimal(value)}`;

/** Plain, unformatted two-decimal string for exports and storage. */
export const plainDecimal = (value: Prisma.Decimal | string | null | undefined) => toDecimal(value).toFixed(2);
