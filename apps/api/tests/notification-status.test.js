import test from "node:test";
import assert from "node:assert/strict";
import {
  canTransition,
  getAllowedTransitions,
} from "../src/services/notification-status.js";

test("pending can move to queued", () => {
  assert.equal(canTransition("pending", "queued"), true);
});

test("processing can move to sent or failed", () => {
  assert.equal(canTransition("processing", "sent"), true);
  assert.equal(canTransition("processing", "failed"), true);
});

test("failed can be queued for retry", () => {
  assert.equal(canTransition("failed", "queued"), true);
});

test("sent cannot transition to another status", () => {
  assert.equal(canTransition("sent", "queued"), false);
  assert.deepEqual(getAllowedTransitions("sent"), []);
});

test("unknown statuses are rejected", () => {
  assert.equal(canTransition("unknown", "queued"), false);
  assert.deepEqual(getAllowedTransitions("unknown"), []);
});