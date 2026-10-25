
import test from "node:test";
import assert from "node:assert/strict";
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