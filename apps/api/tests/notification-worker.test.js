
import test from "node:test";
import assert from "node:assert/strict";
import {
  processNotification,
  runOneNotification,
} from "../src/workers/notification.worker.js";

function createFakeDb() {
  const updates = [];

  return {
    updates,
    notification: {
      async updateMany(args) {
        updates.push(args);
        return { count: 1 };
      },
    },
  };
}

function createJob(overrides = {}) {
  return {
    id: "test-job-1",
    recipient: "+919876543210",
    message: "Test notification",
    status: "processing",
    attemptCount: 1,
    maxAttempts: 3,
    ...overrides,
  };
}

test("successful processing updates the status to sent", async () => {
  const db = createFakeDb();

  const result = await processNotification(
    createJob(),
    async () => {},
    db,
  );

  assert.equal(result.outcome, "processed");
  assert.equal(db.updates[0].data.status, "sent");
});

test("temporary failure schedules a retry", async () => {
  const db = createFakeDb();

  const result = await processNotification(
    createJob({ attemptCount: 1 }),
    async () => {
      throw new Error("Temporary failure");
    },
    db,
  );

  assert.equal(result.outcome, "retry_scheduled");
  assert.equal(db.updates[0].data.status, "queued");
  assert.equal(db.updates[0].data.lastError, "Temporary failure");
  assert.ok(db.updates[0].data.nextAttemptAt instanceof Date);
});

test("final failure marks the notification failed", async () => {
  const db = createFakeDb();

  const result = await processNotification(
    createJob({ attemptCount: 3, maxAttempts: 3 }),
    async () => {
      throw new Error("Permanent failure");
    },
    db,
  );

  assert.equal(result.outcome, "failed");
  assert.equal(db.updates[0].data.status, "failed");
  assert.equal(db.updates[0].data.nextAttemptAt, null);
});

test("worker returns idle when no job is available", async () => {
  const result = await runOneNotification(
    async () => {
      throw new Error("Processor should not run");
    },
    async () => null,
  );

  assert.deepEqual(result, { outcome: "idle" });
});

test("worker reports a state change when its conditional update loses", async () => {
  const db = {
    notification: {
      async updateMany() {
        return { count: 0 };
      },
    },
  };

  const result = await processNotification(
    createJob(),
    async () => {},
    db,
  );

  assert.equal(result.outcome, "state_changed");
});
test("stores provider acceptance details after successful delivery", async () => {
  const db = createFakeDb();
  const acceptedAt = new Date("2026-10-25T12:00:00.000Z");

  const result = await processNotification(
    createJob(),
    async () => ({ id: "email_provider_123" }),
    db,
    () => acceptedAt,
  );

  assert.equal(result.outcome, "processed");
  assert.equal(
    db.updates[0].data.providerMessageId,
    "email_provider_123",
  );
  assert.equal(
    db.updates[0].data.providerAcceptedAt,
    acceptedAt,
  );
});