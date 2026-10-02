import { z } from "zod";
import { isDayKey, keyToDate } from "@/lib/datetime";
import { parseMoney } from "./money";

const optionalId = z.string().trim().transform((v) => v || null);
const optionalText = (max: number) => z.string().trim().max(max).transform((v) => v || null);

export const transactionSchema = z
  .object({
    type: z.enum(["INCOME", "EXPENSE", "ADJUSTMENT"]),
    transactionDate: z.string().trim().refine(isDayKey, "Enter a valid date."),
    description: z.string().trim().min(1, "Description is required.").max(300),
    amount: z.string().trim(),
    categoryId: optionalId,
    clientId: optionalId,
    projectId: optionalId,
    rentalId: optionalId,
    invoiceId: optionalId,
    equipmentId: optionalId,
    reference: optionalText(120),
    notes: optionalText(2000),
  })
  .transform((value, ctx) => {
    const amount = parseMoney(value.amount);
    if (!amount) {
      ctx.addIssue({ code: "custom", message: "Enter an amount with at most two decimals.", path: ["amount"] });
      return z.NEVER;
    }
    if (amount.isZero()) {
      ctx.addIssue({ code: "custom", message: "Amount cannot be zero.", path: ["amount"] });
      return z.NEVER;
    }
    if (value.type !== "ADJUSTMENT" && amount.isNegative()) {
      ctx.addIssue({ code: "custom", message: "Income and expense amounts must be positive. Use an adjustment for a negative correction.", path: ["amount"] });
      return z.NEVER;
    }
    if (value.equipmentId && value.type !== "EXPENSE") {
      ctx.addIssue({ code: "custom", message: "Equipment can only be linked to an expense.", path: ["equipmentId"] });
      return z.NEVER;
    }
    return { ...value, amount, transactionDate: keyToDate(value.transactionDate) };
  });

export function transactionInput(data: FormData) {
  const value = (key: string) => String(data.get(key) ?? "");
  return {
    type: value("type"), transactionDate: value("transactionDate"), description: value("description"), amount: value("amount"),
    categoryId: value("categoryId"), clientId: value("clientId"), projectId: value("projectId"), rentalId: value("rentalId"),
    invoiceId: value("invoiceId"), equipmentId: value("equipmentId"), reference: value("reference"), notes: value("notes"),
  };
}
