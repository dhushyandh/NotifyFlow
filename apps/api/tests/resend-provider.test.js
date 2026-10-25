import test from "node:test";
import assert from "node:assert/strict";
import { sendEmailNotification } from "../src/providers/resend.provider.js";

test("rejects missing Resend credentials", async () => {
  const oldKey = process.env.RESEND_API_KEY;
  const oldFrom = process.env.EMAIL_FROM;

  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;

  try {
    await assert.rejects(
      sendEmailNotification({
        recipient: "customer@example.com",
        message: "Hello",
      }),
      /Email provider is not configured/,
    );
  } finally {
    if (oldKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = oldKey;

    if (oldFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = oldFrom;
  }
});

test("rejects missing sender configuration", async () => {
  const oldKey = process.env.RESEND_API_KEY;
  const oldFrom = process.env.EMAIL_FROM;

  process.env.RESEND_API_KEY = "test-key";
  delete process.env.EMAIL_FROM;

  try {
    await assert.rejects(
      sendEmailNotification({
        recipient: "customer@example.com",
        message: "Hello",
      }),
      /Email provider is not configured/,
    );
  } finally {
    if (oldKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = oldKey;

    if (oldFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = oldFrom;
  }
});

test("sends email and returns the provider message ID", async () => {
  const oldKey = process.env.RESEND_API_KEY;
  const oldFrom = process.env.EMAIL_FROM;
  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_FROM = "NotifyFlow <onboarding@resend.dev>";

  const calls = [];
  const client = {
    emails: {
      async send(payload, options) {
        calls.push({ payload, options });
        return { data: { id: "email_test_123" }, error: null };
      },
    },
  };

  try {
    const result = await sendEmailNotification(
      {
        id: "notif_test_123",
        recipient: "customer@example.com",
        message: "Hello",
      },
      client,
    );

    assert.equal(result.id, "email_test_123");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].payload.to, "customer@example.com");
    assert.equal(calls[0].payload.text, "Hello");
    assert.equal(
      calls[0].options.idempotencyKey,
      "notifyflow/notification/notif_test_123",
    );
  } finally {
    if (oldKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = oldKey;
    if (oldFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = oldFrom;
  }
});

test("throws when Resend returns a delivery error", async () => {
  const oldKey = process.env.RESEND_API_KEY;
  const oldFrom = process.env.EMAIL_FROM;
  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_FROM = "NotifyFlow <onboarding@resend.dev>";

  const client = {
    emails: {
      async send() {
        return { data: null, error: { message: "Rejected by provider" } };
      },
    },
  };

  try {
    await assert.rejects(
      sendEmailNotification(
        { recipient: "customer@example.com", message: "Hello" },
        client,
      ),
      /Resend delivery failed: Rejected by provider/,
    );
  } finally {
    if (oldKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = oldKey;
    if (oldFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = oldFrom;
  }
});
