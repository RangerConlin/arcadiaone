import { prisma } from "@/lib/prisma";
import { postPaymentToLedger } from "@/modules/ledger/service";

/**
 * One-off, idempotent: posts payments recorded before the ledger existed. Safe to re-run; payments
 * that already have an entry are skipped. Honors each organization's auto-post setting.
 * Usage: npm run ledger:backfill-payments
 */
async function main() {
  const payments = await prisma.payment.findMany({
    where: { correctedAt: null, ledgerTransaction: null },
    select: { id: true, organizationId: true }, orderBy: { createdAt: "asc" },
  });
  let posted = 0;
  for (const payment of payments) {
    const created = await prisma.$transaction((tx) => postPaymentToLedger(tx, payment.organizationId, payment.id, null));
    if (created) posted += 1;
  }
  console.log(`[ledger] ${payments.length} payments without entries examined, ${posted} posted.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
