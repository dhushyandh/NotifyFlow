import "dotenv/config";
import { setTimeout as sleep } from "node:timers/promises";
import { prisma } from "../lib/prisma.js";
import { runOneNotification } from "./notification.worker.js";
import { recoverExpiredLeases } from "./recover-expired-leases.js";
import { sendEmailNotification } from "../providers/resend.provider.js";

// Placeholder until a real delivery provider is integrated.
async function processDelivery(notification) {
  if (notification.channel === "email") {
    return sendEmailNotification(notification);
  }

  throw new Error(
    "SMS delivery provider is not configured; notification was not sent",
  );
}

const pollIntervalMs = Math.max(
  250,
  Number(process.env.WORKER_POLL_INTERVAL_MS) || 1000,
);

let stopping = false;

async function main() {
  console.log(`[worker] Started; polling every ${pollIntervalMs}ms`);

  while (!stopping) {
    try {
      const recovery = await recoverExpiredLeases();

      if (recovery.requeued || recovery.failed) {
        console.log("[worker] Recovered expired leases:", recovery);
      }

      const result = await runOneNotification(processDelivery);

      if (result.outcome !== "idle") {
        console.log("[worker] Job result:", result);
      }

      if (result.outcome === "idle") {
        await sleep(pollIntervalMs);
      }
    } catch (error) {
      console.error("[worker] Loop error:", error);
      await sleep(pollIntervalMs);
    }
  }
}

function shutdown(signal) {
  console.log(`[worker] ${signal} received; shutting down`);
  stopping = true;
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

try {
  await main();
} finally {
  await prisma.$disconnect();
  console.log("[worker] Stopped");
}
