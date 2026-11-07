/**
 * @file order-expiration.ts
 * Background worker for automatic order expiration and stock reclamation.
 *
 * Runs every 5 minutes to release held inventory for unpaid orders older than 45 minutes.
 * Prevents "inventory hoarding" attacks where malicious actors hold parts in cart/pending
 * state without paying, locking out legitimate customers.
 */

import { and, eq, lt, sql } from "drizzle-orm";
import { db, orderItemsTable, ordersTable, paymentsTable, productsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const EXPIRATION_WINDOW_MS = 45 * 60 * 1000; // 45 minutes threshold
const CHECK_INTERVAL_MS = 3 * 60 * 1000; // Run every 3 minutes (SRE anti-hoarding worker)

/**
 * Sweeps the database for orders still pending payment past the 45-minute TTL.
 * Releases inventory back to productsTable atomically.
 */
export async function expireStaleOrders(): Promise<number> {
  const cutoffTime = new Date(Date.now() - EXPIRATION_WINDOW_MS);

  try {
    // 1. Locate expired pending orders without any reported payment
    const expiredOrders = await db
      .select({ id: ordersTable.id, createdAt: ordersTable.createdAt })
      .from(ordersTable)
      .leftJoin(paymentsTable, eq(ordersTable.id, paymentsTable.orderId))
      .where(
        and(
          eq(ordersTable.status, "pending_payment"),
          lt(ordersTable.createdAt, cutoffTime),
          sql`${paymentsTable.id} IS NULL`
        )
      );

    if (expiredOrders.length === 0) {
      return 0;
    }

    logger.info(
      { count: expiredOrders.length },
      "[order-expiration] Found stale pending orders to cancel and reclaim stock"
    );

    let cancelledCount = 0;

    // 2. Process each stale order in an isolated transaction to prevent deadlocks and race conditions
    for (const order of expiredOrders) {
      await db.transaction(async (tx) => {
        // Set local lock timeout
        await tx.execute(sql`SET LOCAL lock_timeout = '4s'`);

        // Concurrency guard: Ensure status is still pending_payment under transaction
        const [targetOrder] = await tx
          .select({ id: ordersTable.id, status: ordersTable.status })
          .from(ordersTable)
          .where(and(eq(ordersTable.id, order.id), eq(ordersTable.status, "pending_payment")))
          .limit(1);

        if (!targetOrder) {
          // Order was paid or updated in a concurrent request
          return;
        }

        // Fetch associated items
        const items = await tx
          .select()
          .from(orderItemsTable)
          .where(eq(orderItemsTable.orderId, order.id));

        // Mark order as cancelled
        await tx
          .update(ordersTable)
          .set({ status: "cancelled" })
          .where(eq(ordersTable.id, order.id));

        // Sort items by productId to maintain consistent lock hierarchy during stock increment
        const sortedItems = [...items].sort((a, b) => a.productId.localeCompare(b.productId));

        // Atomically refund stock for each item
        for (const item of sortedItems) {
          await tx
            .update(productsTable)
            .set({
              stock: sql`${productsTable.stock} + ${item.quantity}`,
            })
            .where(eq(productsTable.id, item.productId));
        }

        cancelledCount++;
      });
    }

    logger.info(
      { cancelledCount },
      "[order-expiration] Successfully expired orders and restored stock to catalog"
    );

    return cancelledCount;
  } catch (error) {
    logger.error({ err: error }, "[order-expiration] Error during order expiration run");
    return 0;
  }
}

/**
 * Initializes the background interval job on server startup.
 */
export function startOrderExpirationJob(): NodeJS.Timeout {
  logger.info("[order-expiration] Initializing 45-minute order auto-expiration worker (runs every 5m)");

  // Run initial check shortly after startup (10 seconds delay)
  setTimeout(() => {
    expireStaleOrders().catch((err) =>
      logger.error({ err }, "[order-expiration] Startup check failed")
    );
  }, 10_000);

  // Recurring 5-minute schedule
  return setInterval(() => {
    expireStaleOrders().catch((err) =>
      logger.error({ err }, "[order-expiration] Scheduled check failed")
    );
  }, CHECK_INTERVAL_MS);
}
