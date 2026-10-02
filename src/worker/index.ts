import { prisma } from "@/lib/prisma";
import { runNotificationJobs } from "@/modules/notifications/jobs";

/**
 * Long-running scheduler for the Docker `worker` service. It runs the idempotent
 * notification checks on a fixed interval, never overlapping itself. It exposes no port.
 */
const intervalMinutes = Math.max(1, Number(process.env.NOTIFICATION_JOB_INTERVAL_MINUTES) || 15);
let stopping = false;
let timer: NodeJS.Timeout | undefined;

async function tick() {
  const startedAt = Date.now();
  try {
    const summary = await runNotificationJobs({ log: (line) => console.error(`[worker] ${line}`) });
    console.log(`[worker] ${new Date().toISOString()} ${JSON.stringify(summary)} (${Date.now() - startedAt}ms)`);
  } catch (error) {
    console.error("[worker] run failed:", error instanceof Error ? error.message : error);
  }
  if (!stopping) timer = setTimeout(tick, intervalMinutes * 60_000);
}

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, shutting down`);
  stopping = true;
  if (timer) clearTimeout(timer);
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log(`[worker] notification scheduler started; interval ${intervalMinutes} min`);
void tick();
