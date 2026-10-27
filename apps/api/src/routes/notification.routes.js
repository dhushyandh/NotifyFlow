
import { Router } from "express";
import { notificationSchema } from "../schemas/notification.schema.js";
import {
  createNotification,
  listNotifications,
  getNotificationById,
  transitionNotificationStatus
} from "../services/notification.service.js";
import { timingSafeEqual } from "node:crypto";



export const notificationRouter = Router();

function requireInternalApiKey(req, res, next) {
  const expected = process.env.INTERNAL_API_KEY;
  const provided = req.get("x-internal-api-key");

  if (!expected) {
    return res.status(503).json({
      error: "Internal status updates are not configured",
    });
  }

  if (
    typeof provided !== "string" ||
    Buffer.byteLength(provided) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    return res.status(401).json({
      error: "Unauthorized",
    });
  }

  return next();
}

function validateNotification(req, res) {
  const result = notificationSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      error: "Validation failed",
      details: result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });

    return null;
  }

  return result.data;
}

// Validate only; do not save or send.
notificationRouter.post("/validate", (req, res) => {
  const data = validateNotification(req, res);
  if (!data) return;

  return res.status(200).json({
    valid: true,
    notification: data,
    message: "Request validated. No message has been sent.",
  });
});

// Create and persist a notification with optional idempotency key.
notificationRouter.post("/", async (req, res, next) => {
  const data = validateNotification(req, res);
  if (!data) return;

  const header = req.get("Idempotency-Key");
  const idempotencyKey = header?.trim();

  if (
    header !== undefined &&
    (!idempotencyKey ||
      header.length > 255 ||
      idempotencyKey.length > 255 ||
      /[\u0000-\u001F\u007F]/.test(idempotencyKey))
  ) {
    return res.status(400).json({
      error: "Invalid Idempotency-Key",
      details: "Provide a non-empty key of at most 255 characters.",
    });
  }

  try {
    const result = await createNotification(data, idempotencyKey);

    if (result.conflict) {
      return res.status(409).json({
        error: "Idempotency key already used with a different payload",
      });
    }

    return res.status(result.replayed ? 200 : 201).json({
      message: result.replayed
        ? "Existing notification returned"
        : "Notification saved successfully",
      replayed: result.replayed,
      notification: result.notification,
    });
  } catch (error) {
    return next(error);
  }
});

// List notifications with pagination.
notificationRouter.get("/", async (req, res, next) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 10);

  if (
    !Number.isSafeInteger(page) ||
    !Number.isSafeInteger(limit) ||
    page < 1 ||
    limit < 1 ||
    limit > 100
  ) {
    return res.status(400).json({
      error: "Invalid pagination parameters",
      details: {
        page: "Must be a positive integer",
        limit: "Must be an integer between 1 and 100",
      },
    });
  }

  try {
    const result = await listNotifications({ page, limit });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
});

// Retrieve one notification.
notificationRouter.get("/:id", async (req, res, next) => {
  try {
    const notification = await getNotificationById(req.params.id);

    if (!notification) {
      return res.status(404).json({
        error: "Notification not found",
      });
    }

    return res.status(200).json({ notification });
  } catch (error) {
    return next(error);
  }
});

notificationRouter.patch(
  "/:id/status",
  requireInternalApiKey,
  async (req, res, next) => {
    const { status } = req.body ?? {};

    const validStatuses = [
      "pending",
      "queued",
      "processing",
      "sent",
      "failed",
    ];

    if (typeof status !== "string" || !validStatuses.includes(status)) {
      return res.status(400).json({
        error: "Invalid status",
        allowedStatuses: validStatuses,
      });
    }

    try {
      const result = await transitionNotificationStatus(
        req.params.id,
        status,
      );

      if (result.error === "not_found") {
        return res.status(404).json({
          error: "Notification not found",
        });
      }

      if (result.error === "invalid_transition") {
        return res.status(409).json({
          error: "Invalid status transition",
          currentStatus: result.currentStatus,
          allowedTransitions: result.allowedTransitions,
        });
      }

      if (result.error === "concurrent_update") {
        return res.status(409).json({
          error: "Notification status changed concurrently. Retry the request.",
        });
      }

      return res.status(200).json({
        message: "Notification status updated",
        notification: result.notification,
      });
    } catch (error) {
      return next(error);
    }
  });
