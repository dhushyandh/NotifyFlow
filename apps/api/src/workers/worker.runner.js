
import "dotenv/config";
import { setTimeout as sleep } from "node:timers/promises";
import { prisma } from "../lib/prisma.js";
import { runOneNotification } from "./notification.worker.js";
import { recoverExpiredLeases } from "./recover-expired-leases.js";
import { sendEmailNotification } from "../providers/resend.provider.js";

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
let shutdownPromise;

function shutdown(signal) {
  if (shutdownPromise) {
    console.warn("[worker] Shutdown already in progress");
    return shutdownPromise;
  }

  stopping = true;
  console.log(`[worker] ${signal} received; finishing current iteration`);

  shutdownPromise = Promise.resolve();
  return shutdownPromise;
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

async function main() {
  console.log(`[worker] Started; polling every ${pollIntervalMs}ms`);

  while (!stopping) {
    try {
      const recovery = await recoverExpiredLeases();

      if (recovery.requeued || recovery.failed) {
        console.log("[worker] Recovered expired leases:", recovery);
      }

      // If shutdown starts during recovery, don't claim another job.
      if (stopping) break;

      const result = await runOneNotification(processDelivery);

      if (result.outcome !== "idle") {
        console.log("[worker] Job result:", result);
      }

      if (result.outcome === "idle" && !stopping) {
        await sleep(pollIntervalMs, undefined, { signal: shutdownSignal });
      }
    } catch (error) {
      if (stopping && error?.name === "AbortError") break;

      console.error("[worker] Loop error:", error);

      if (!stopping) {
        await sleep(pollIntervalMs);
      }
    }
  }
}

const shutdownController = new AbortController();
const shutdownSignal = shutdownController.signal;

function requestShutdown(signal) {
  void shutdown(signal);
  shutdownController.abort();
}

process.removeAllListeners("SIGINT");
process.removeAllListeners("SIGTERM");
process.once("SIGINT", () => requestShutdown("SIGINT"));
process.once("SIGTERM", () => requestShutdown("SIGTERM"));

try {
  await main();
} finally {
  await prisma.$disconnect();
  console.log("[worker] Stopped; database disconnected");
}
