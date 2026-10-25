
import test from "node:test";
import assert from "node:assert/strict";
import { recoverExpiredLeases } from "../src/workers/recover-expired-leases.js";

test("recovery counts requeued and failed notifications", async () => {
  const db = {
    $transaction: async (callback) =>
      callback({
        $queryRaw: async () => [
          { status: "queued", count: 2 },
          { status: "failed", count: 1 },
        ],
      }),
  };

  const result = await recoverExpiredLeases(db);

  assert.deepEqual(result, { requeued: 2, failed: 1 });
});

test("recovery returns zero counts when no leases have expired", async () => {
  const db = {
    $transaction: async (callback) =>
      callback({
        $queryRaw: async () => [],
      }),
  };

  const result = await recoverExpiredLeases(db);

  assert.deepEqual(result, { requeued: 0, failed: 0 });
});

test("recovery query uses per-job limits and skips locked rows", async () => {
  let queryText = "";

  const db = {
    $transaction: async (callback) =>
      callback({
        $queryRaw: async (strings) => {
          queryText = strings.join("?");
          return [];
        },
      }),
  };

  await recoverExpiredLeases(db);

  assert.match(queryText, /"attemptCount" < "maxAttempts"/);
  assert.match(queryText, /FOR UPDATE SKIP LOCKED/);
  assert.match(queryText, /"leaseToken" = NULL/);
  assert.match(queryText, /"leaseExpiresAt" = NULL/);
});
