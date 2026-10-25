import { z } from "zod";

export const notificationSchema = z.object({
  recipient: z.string()
    .regex(/^\+[1-9]\d{7,14}$/, "Use international phone format, e.g. +919876543210"),
  message: z.string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(4096, "Message is too long"),
});
