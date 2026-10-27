import { canTransition } from "./notification-status.js";
import { prisma } from "../lib/prisma.js";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";


function getPayloadHash(data) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        data.recipient,
        data.channel ?? "sms",
        data.message,
      ]),
    )
    .digest("hex");
}

export async function createNotification(data, idempotencyKey) {
  const notificationData = {
    recipient: data.recipient,
    channel: data.channel ?? "sms",
    message: data.message,
    status: "queued",
  };

  // Preserve existing behavior for requests without an idempotency key.
  if (!idempotencyKey) {
    const notification = await prisma.notification.create({
      data: notificationData,
    });

    return { notification, replayed: false, conflict: false };
  }

  const payloadHash = getPayloadHash(notificationData);

  try {
    const notification = await prisma.notification.create({
      data: {
        ...notificationData,
        idempotencyKey,
        idempotencyPayloadHash: payloadHash,
      },
    });

    return { notification, replayed: false, conflict: false };
  } catch (error) {
    if (error?.code !== "P2002") {
      throw error;
    }

    // A concurrent request may have created this key already.
    const existing = await prisma.notification.findUnique({
      where: { idempotencyKey },
    });

    if (!existing) {
      throw error;
    }

    if (existing.idempotencyPayloadHash !== payloadHash) {
      return { notification: null, replayed: false, conflict: true };
    }

    return {
      notification: existing,
      replayed: true,
      conflict: false,
    };
  }
}

export async function listNotifications({ page, limit }) {
  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notification.count(),
  ]);

  return {
    data: notifications,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getNotificationById(id) {
  return prisma.notification.findUnique({
    where: { id },
  });
}

export async function transitionNotificationStatus(id, targetStatus) {
  const notification = await prisma.notification.findUnique({
    where: { id },
  });

  if (!notification) {
    return { error: "not_found" };
  }

  if (!canTransition(notification.status, targetStatus)) {
    return {
      error: "invalid_transition",
      currentStatus: notification.status,
      allowedTransitions: (
        await import("./notification-status.js")
      ).getAllowedTransitions(notification.status),
    };
  }

  // Conditional update prevents overwriting a status that
  // changed after the initial read.
  const updated = await prisma.notification.updateMany({
    where: {
      id,
      status: notification.status,
    },
    data: {
      status: targetStatus,
    },
  });

  if (updated.count === 0) {
    return { error: "concurrent_update" };
  }

  return {
    notification: await prisma.notification.findUnique({
      where: { id },
    }),
  };
}


const LEASE_DURATION_MS = 60_000;

export async function claimNextNotification() {
  return prisma.$transaction(
    async (tx) => {
      const jobs = await tx.$queryRaw`
        SELECT "id"
        FROM "Notification"
        WHERE "status" = 'queued'::"NotificationStatus"
          AND (
            "nextAttemptAt" IS NULL
            OR "nextAttemptAt" <= NOW()
          )
          AND "attemptCount" < "maxAttempts"
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;

      if (jobs.length === 0) {
        return null;
      }

      return tx.notification.update({
        where: { id: jobs[0].id },
        data: {
          status: "processing",
          attemptCount: { increment: 1 },
          nextAttemptAt: null,
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS),
        },
      });
    },
    {
      maxWait: 10_000,
      timeout: 15_000,
    },
  );
}

