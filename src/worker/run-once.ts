import { runNotificationJobs } from "@/modules/notifications/jobs";
import { prisma } from "@/lib/prisma";

/** One evaluation pass; suitable for host cron: `npm run jobs:notifications`. */
async function main() {
  const startedAt = Date.now();
  const summary = await runNotificationJobs({ log: (line) => console.error(`[jobs] ${line}`) });
  console.log(`[jobs] ${new Date().toISOString()} ${JSON.stringify(summary)} (${Date.now() - startedAt}ms)`);
}

main()
  .catch((error) => {
    console.error("[jobs] run failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
