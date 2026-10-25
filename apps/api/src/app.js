import express from "express";
import { healthRouter } from "./routes/health.routes.js";
import { notificationRouter } from "./routes/notification.routes.js";

export const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.get("/", (_req, res) => {
  res.json({
    name: "NotifyFlow API",
    version: "0.1.0",
    message: "Business messaging automation starts here.",
  });
});

app.use("/api/v1/health", healthRouter);
app.use("/api/v1/notifications", notificationRouter);

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
});
