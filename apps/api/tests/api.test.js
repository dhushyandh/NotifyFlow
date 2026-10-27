import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "../src/app.js";

test("GET / returns API information", async () => {
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
  assert.equal(res.body.name, "NotifyFlow API");
});

test("GET /api/v1/health returns healthy status", async () => {
  const res = await request(app).get("/api/v1/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
});

test("valid notification request passes validation", async () => {
  const res = await request(app)
    .post("/api/v1/notifications/validate")
    .send({
      recipient: "+919876543210",
      message: "Your order has been confirmed.",
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.valid, true);
});

test("invalid phone number is rejected", async () => {
  const res = await request(app)
    .post("/api/v1/notifications/validate")
    .send({
      recipient: "not-a-phone",
      message: "Hello",
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, "Validation failed");
});

test("unknown routes return 404", async () => {
  const res = await request(app).get("/api/unknown");
  assert.equal(res.status, 404);
});

test("GET /api/v1/notifications returns paginated data", async () => {
  const res = await request(app)
    .get("/api/v1/notifications?page=1&limit=10");

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.equal(res.body.pagination.page, 1);
  assert.equal(res.body.pagination.limit, 10);
  assert.equal(typeof res.body.pagination.total, "number");
});

test("GET /api/v1/notifications rejects invalid pagination", async () => {
  const res = await request(app)
    .get("/api/v1/notifications?page=0&limit=10");

  assert.equal(res.status, 400);
  assert.equal(res.body.error, "Invalid pagination parameters");
});

test("GET /api/v1/notifications/:id returns 404 for a missing record", async () => {
  const res = await request(app)
    .get("/api/v1/notifications/nonexistent-notification-id");

  assert.equal(res.status, 404);
  assert.equal(res.body.error, "Notification not found");
});

test("POST /api/v1/notifications creates a notification without idempotency key", async () => {
  const payload = {
    channel: "email",
    recipient: `test-${randomUUID()}@example.com`,
    message: "Welcome to NotifyFlow",
  };

  const res = await request(app)
    .post("/api/v1/notifications")
    .send(payload);

  assert.equal(res.status, 201);
  assert.equal(res.body.replayed, false);
  assert.equal(res.body.notification.recipient, payload.recipient);
  assert.equal(res.body.notification.channel, "email");
  assert.equal(res.body.notification.status, "queued");
  assert.ok(res.body.notification.id);
});

test("GET /api/v1/notifications/:id returns the created notification", async () => {
  const createRes = await request(app)
    .post("/api/v1/notifications")
    .send({
      channel: "email",
      recipient: `test-${randomUUID()}@example.com`,
      message: "Notification retrieval test",
    });

  assert.equal(createRes.status, 201);
  const notifId = createRes.body.notification.id;

  const getRes = await request(app).get(`/api/v1/notifications/${notifId}`);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.notification.id, notifId);
  assert.equal(getRes.body.notification.status, "queued");
});

test("POST /api/v1/notifications rejects empty, whitespace, or invalid Idempotency-Key", async () => {
  const payload = {
    channel: "email",
    recipient: `test-${randomUUID()}@example.com`,
    message: "Idempotency validation test",
  };

  const resEmpty = await request(app)
    .post("/api/v1/notifications")
    .set("Idempotency-Key", "")
    .send(payload);
  assert.equal(resEmpty.status, 400);
  assert.equal(resEmpty.body.error, "Invalid Idempotency-Key");

  const resSpaces = await request(app)
    .post("/api/v1/notifications")
    .set("Idempotency-Key", "   ")
    .send(payload);
  assert.equal(resSpaces.status, 400);
  assert.equal(resSpaces.body.error, "Invalid Idempotency-Key");

  const resTooLong = await request(app)
    .post("/api/v1/notifications")
    .set("Idempotency-Key", "a".repeat(256))
    .send(payload);
  assert.equal(resTooLong.status, 400);
  assert.equal(resTooLong.body.error, "Invalid Idempotency-Key");
});

test("POST /api/v1/notifications idempotency: creates on first request, replays on duplicate, and conflicts on payload change", async () => {
  const idempotencyKey = `idem-${randomUUID()}`;
  const payload = {
    channel: "email",
    recipient: `user-${randomUUID()}@example.com`,
    message: "Idempotent notification test",
  };

  // 1. First request returns 201
  const firstRes = await request(app)
    .post("/api/v1/notifications")
    .set("Idempotency-Key", idempotencyKey)
    .send(payload);

  assert.equal(firstRes.status, 201);
  assert.equal(firstRes.body.replayed, false);
  const originalId = firstRes.body.notification.id;
  assert.ok(originalId);

  // 2. Second request with same key and same payload returns 200 and replayed: true
  const secondRes = await request(app)
    .post("/api/v1/notifications")
    .set("Idempotency-Key", idempotencyKey)
    .send(payload);

  assert.equal(secondRes.status, 200);
  assert.equal(secondRes.body.replayed, true);
  assert.equal(secondRes.body.notification.id, originalId);

  // 3. Third request with same key but different payload returns 409 Conflict
  const conflictPayload = {
    ...payload,
    message: "Different payload message",
  };
  const conflictRes = await request(app)
    .post("/api/v1/notifications")
    .set("Idempotency-Key", idempotencyKey)
    .send(conflictPayload);

  assert.equal(conflictRes.status, 409);
  assert.equal(
    conflictRes.body.error,
    "Idempotency key already used with a different payload",
  );
});

test("status endpoint rejects a missing API key", async () => {
  const previousKey = process.env.INTERNAL_API_KEY;
  delete process.env.INTERNAL_API_KEY;

  try {
    const response = await request(app)
      .patch("/api/v1/notifications/test-id/status")
      .send({ status: "queued" });

    assert.equal(response.status, 503);
  } finally {
    if (previousKey === undefined) {
      delete process.env.INTERNAL_API_KEY;
    } else {
      process.env.INTERNAL_API_KEY = previousKey;
    }
  }
});

test("status endpoint rejects an incorrect API key", async () => {
  const previousKey = process.env.INTERNAL_API_KEY;
  process.env.INTERNAL_API_KEY = "expected-test-secret";

  try {
    const response = await request(app)
      .patch("/api/v1/notifications/test-id/status")
      .set("x-internal-api-key", "wrong-test-secret")
      .send({ status: "queued" });

    assert.equal(response.status, 401);
    assert.equal(response.body.error, "Unauthorized");
  } finally {
    if (previousKey === undefined) {
      delete process.env.INTERNAL_API_KEY;
    } else {
      process.env.INTERNAL_API_KEY = previousKey;
    }
  }
});

test("valid API key passes authentication middleware", async () => {
  const previousKey = process.env.INTERNAL_API_KEY;
  process.env.INTERNAL_API_KEY = "expected-test-secret";

  try {
    const response = await request(app)
      .patch("/api/v1/notifications/nonexistent-test-id/status")
      .set("x-internal-api-key", "expected-test-secret")
      .send({ status: "queued" });

    // The request passes authentication, then the service returns 404.
    assert.equal(response.status, 404);
    assert.equal(response.body.error, "Notification not found");
  } finally {
    if (previousKey === undefined) {
      delete process.env.INTERNAL_API_KEY;
    } else {
      process.env.INTERNAL_API_KEY = previousKey;
    }
  }
});

test("PATCH /api/v1/notifications/:id/status updates on allowed transition and rejects disallowed transition", async () => {
  const previousKey = process.env.INTERNAL_API_KEY;
  process.env.INTERNAL_API_KEY = "expected-test-secret";

  try {
    const createRes = await request(app)
      .post("/api/v1/notifications")
      .send({
        channel: "email",
        recipient: `status-${randomUUID()}@example.com`,
        message: "Status transition test",
      });
    assert.equal(createRes.status, 201);
    const notifId = createRes.body.notification.id;

    // Disallowed transition: queued -> sent
    const invalidRes = await request(app)
      .patch(`/api/v1/notifications/${notifId}/status`)
      .set("x-internal-api-key", "expected-test-secret")
      .send({ status: "sent" });

    assert.equal(invalidRes.status, 409);
    assert.equal(invalidRes.body.error, "Invalid status transition");
    assert.equal(invalidRes.body.currentStatus, "queued");

    // Allowed transition: queued -> processing
    const validRes = await request(app)
      .patch(`/api/v1/notifications/${notifId}/status`)
      .set("x-internal-api-key", "expected-test-secret")
      .send({ status: "processing" });

    assert.equal(validRes.status, 200);
    assert.equal(validRes.body.notification.status, "processing");

    // Invalid status parameter value
    const badStatusRes = await request(app)
      .patch(`/api/v1/notifications/${notifId}/status`)
      .set("x-internal-api-key", "expected-test-secret")
      .send({ status: "invalid_status_value" });

    assert.equal(badStatusRes.status, 400);
    assert.equal(badStatusRes.body.error, "Invalid status");
  } finally {
    if (previousKey === undefined) {
      delete process.env.INTERNAL_API_KEY;
    } else {
      process.env.INTERNAL_API_KEY = previousKey;
    }
  }
});