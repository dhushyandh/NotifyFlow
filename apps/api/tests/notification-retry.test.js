
import test from "node:test";
import assert from "node:assert/strict";
import {
  getRetryDelayMs,
  getNextAttemptAt,
} from "../src/services/notification-retry.js";

test("first retry delay is 5 seconds", () => {
  assert.equal(getRetryDelayMs(1), 5_000);
});

test("retry delay doubles after each attempt", () => {
  assert.equal(getRetryDelayMs(2), 10_000);
  assert.equal(getRetryDelayMs(3), 20_000);
});

test("retry delay is capped at 15 minutes", () => {
  assert.equal(getRetryDelayMs(20), 15 * 60 * 1_000);
});

test("invalid attempt counts are rejected", () => {
  assert.throws(() => getRetryDelayMs(0));
  assert.throws(() => getRetryDelayMs(-1));
  assert.throws(() => getRetryDelayMs(1.5));
});

test("next attempt time is calculated from the supplied time", () => {
  const now = new Date("2026-10-25T10:00:00.000Z");

  assert.equal(
    getNextAttemptAt(1, now).toISOString(),
    "2026-10-25T10:00:05.000Z",
  );
});
