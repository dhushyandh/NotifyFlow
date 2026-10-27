
import { prisma } from "../lib/prisma.js";
import { claimNextNotification } from "../services/notification.service.js";
import { getNextAttemptAt } from "../services/notification-retry.js";

export async function processNotification(
  notification,
  processor,
  db = prisma,
  now = () => new Date(),
) {
  let processorResult;

  try {
    processorResult = await processor(notification);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown processing error";

    const exhausted =
      notification.attemptCount >= notification.maxAttempts;

    const data = exhausted
      ? {
          status: "failed",
          lastError: message.slice(0, 1000),
          nextAttemptAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
        }
      : {
          status: "queued",
          lastError: message.slice(0, 1000),
          nextAttemptAt: getNextAttemptAt(
            notification.attemptCount,
            now(),
          ),
          leaseToken: null,
          leaseExpiresAt: null,
        };

    const updated = await db.notification.updateMany({
      where: {
        id: notification.id,
        status: "processing",
        leaseToken: notification.leaseToken,
        leaseExpiresAt: { gt: now() },
      },
      data,
    });

    if (updated.count !== 1) {
      return { outcome: "state_changed", id: notification.id };
    }

    return {
      outcome: exhausted ? "failed" : "retry_scheduled",
      id: notification.id,
      nextAttemptAt: data.nextAttemptAt,
    };
  }

  // Only finish the job if this worker's lease is still valid.
  const acceptedAt = now();

  const updated = await db.notification.updateMany({
    where: {
      id: notification.id,
      status: "processing",
      leaseToken: notification.leaseToken,
      leaseExpiresAt: { gt: acceptedAt },
    },
    data: {
      status: "sent",
      lastError: null,
      nextAttemptAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
      ...(processorResult?.id
        ? {
            providerMessageId: processorResult.id,
            providerAcceptedAt: acceptedAt,
          }
        : {}),
    },
  });

  return {
    outcome: updated.count === 1 ? "processed" : "state_changed",
    id: notification.id,
  };
} // ← This closing brace was missing!

export async function runOneNotification(
  processor,
  claim = claimNextNotification,
) {
  const notification = await claim();

  if (!notification) {
    return { outcome: "idle" };
  }

  return processNotification(notification, processor);
}
