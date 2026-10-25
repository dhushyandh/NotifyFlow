
import { prisma } from "../lib/prisma.js";

export async function recoverExpiredLeases(db = prisma, now = new Date()) {
  return db.$transaction(async (tx) => {
    const recovered = await tx.$queryRaw`
      WITH expired AS (
        SELECT
          "id",
          CASE
            WHEN "attemptCount" < "maxAttempts"
              THEN 'queued'::"NotificationStatus"
            ELSE 'failed'::"NotificationStatus"
          END AS "targetStatus"
        FROM "Notification"
        WHERE "status" = 'processing'::"NotificationStatus"
          AND "leaseExpiresAt" IS NOT NULL
          AND "leaseExpiresAt" <= ${now}
        ORDER BY "leaseExpiresAt" ASC
        FOR UPDATE SKIP LOCKED
      ),
      updated AS (
        UPDATE "Notification" AS n
        SET
          "status" = expired."targetStatus",
          "nextAttemptAt" = CASE
            WHEN expired."targetStatus" = 'queued'::"NotificationStatus"
              THEN CAST(${now} AS timestamp)
            ELSE NULL
          END,
          "lastError" = CASE
            WHEN expired."targetStatus" = 'queued'::"NotificationStatus"
              THEN 'Worker lease expired'
            ELSE 'Worker lease expired; maximum attempts exhausted'
          END,
          "leaseToken" = NULL,
          "leaseExpiresAt" = NULL,
          "updatedAt" = NOW()
        FROM expired
        WHERE n."id" = expired."id"
        RETURNING n."status"
      )
      SELECT "status", COUNT(*)::int AS count
      FROM updated
      GROUP BY "status"
    `;

    const counts = { requeued: 0, failed: 0 };

    for (const row of recovered) {
      if (row.status === "queued") {
        counts.requeued = row.count;
      } else if (row.status === "failed") {
        counts.failed = row.count;
      }
    }

    return counts;
  }, {
    maxWait: 10000,
    timeout: 15000,
  });
}
