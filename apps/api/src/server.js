import "dotenv/config";
import { app } from "./app.js";
import { prisma } from "./lib/prisma.js";

const PORT = Number(process.env.PORT) || 3000;

const server = app.listen(PORT, () => {
  console.log(`NotifyFlow API running at http://localhost:${PORT}`);
});

let isShuttingDown = false;
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[server] ${signal} received; shutting down gracefully`);

  server.close(async () => {
    try {
      await prisma.$disconnect();
      console.log("[server] Database connection closed; stopped");
      process.exit(0);
    } catch (err) {
      console.error("[server] Error disconnecting database:", err);
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.error("[server] Forced shutdown after timeout");
    process.exit(1);
  }, 10_000).unref();
}

process.once("SIGINT", () => void gracefulShutdown("SIGINT"));
process.once("SIGTERM", () => void gracefulShutdown("SIGTERM"));
