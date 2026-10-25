import test from "node:test";
import assert from "node:assert/strict";
import { notificationSchema } from "../src/schemas/notification.schema.js";

test("defaults notifications to SMS", () => {
  const result = notificationSchema.safeParse({
    recipient: "+919876543210",
    message: "Hello",
  });

  assert.equal(result.success, true);
  assert.equal(result.data.channel, "sms");
});

test("accepts a valid email notification", () => {
  const result = notificationSchema.safeParse({
    channel: "email",
    recipient: "customer@example.com",
    message: "Hello",
  });

  assert.equal(result.success, true);
});

test("rejects an invalid email recipient", () => {
  const result = notificationSchema.safeParse({
    channel: "email",
    recipient: "not-an-email",
    message: "Hello",
  });

  assert.equal(result.success, false);
});

test("rejects a phone number for the email channel", () => {
  const result = notificationSchema.safeParse({
    channel: "email",
    recipient: "+919876543210",
    message: "Hello",
  });

  assert.equal(result.success, false);
});
