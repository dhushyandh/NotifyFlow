
import { z } from "zod";

const phoneRegex = /^\+[1-9]\d{7,14}$/;

export const notificationSchema = z
  .object({
    channel: z.enum(["sms", "email"]).default("sms"),

    recipient: z.string().trim().min(1, "Recipient is required"),

    message: z
      .string()
      .trim()
      .min(1, "Message cannot be empty")
      .max(4096, "Message is too long"),
  })
  .superRefine((data, ctx) => {
    const validRecipient =
      data.channel === "sms"
        ? phoneRegex.test(data.recipient)
        : z.email().safeParse(data.recipient).success;

    if (!validRecipient) {
      ctx.addIssue({
        code: "custom",
        path: ["recipient"],
        message:
          data.channel === "sms"
            ? "Use international phone format, e.g. +919876543210"
            : "Enter a valid email address",
      });
    }
  });
