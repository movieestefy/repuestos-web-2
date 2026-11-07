import "dotenv/config";
import app from "./app";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { ensureMarketplaceSeed } from "./lib/seed";
import { startOrderExpirationJob } from "./jobs/order-expiration";

const rawPort = process.env["PORT"] || "5000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection detected in server process");
});

ensureMarketplaceSeed()
  .then(() => {
    const server = app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
      // Start background order expiration worker
      startOrderExpirationJob();
    });

    const shutdown = async (signal: string) => {
      logger.info({ signal }, "Graceful shutdown initiated. Closing HTTP server and DB connections...");
      server.close(async () => {
        try {
          await pool.end();
          logger.info("PostgreSQL connection pool cleanly closed.");
        } catch (poolErr) {
          logger.error({ poolErr }, "Error closing PostgreSQL connection pool");
        }
        process.exit(0);
      });
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  })
  .catch((err) => {
    logger.error({ err }, "Could not seed marketplace database");
    process.exit(1);
  });
