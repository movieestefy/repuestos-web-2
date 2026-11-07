import { Router, type IRouter } from "express";
import multer from "multer";
import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  CreateExchangeRateBody,
  CreateProductBody,
  CreateOrderBody,
  GetProductParams,
  GetOrderParams,
  ListProductsQueryParams,
  ListOrdersQueryParams,
  ListPaymentsQueryParams,
  SubmitPaymentBody,
  UpdateProductBody,
  UpdateProductParams,
  UpdateOrderStatusBody,
  UpdateOrderStatusParams,
  UpdatePaymentReceiverBody,
  CreateDeliveryLocationBody,
  UpdateDeliveryLocationBody,
  UpdateDeliveryLocationParams,
  UpdateUserRoleBody,
} from "@workspace/api-zod";
import {
  db,
  deliveryLocationsTable,
  exchangeRatesTable,
  merchantsTable,
  orderItemsTable,
  ordersTable,
  orderRatingsTable,
  partRequestsTable,
  paymentsTable,
  paymentReceiverSettingsTable,
  productsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, optionalUser, MASTER_EMAIL, invalidateUserCache, type RequestWithUser } from "./auth";
import { checkoutAndPaymentLimiter, adminLimiter } from "../middlewares/rateLimiters";
import { uploadReceiptToDrive } from "../services/googleDrive";
import { parseProductFile } from "../services/productImport";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

const router: IRouter = Router();
const today = () => new Date().toISOString().slice(0, 10);
const pageInfo = (page: number, pageSize: number, total: number) => ({
  page,
  pageSize,
  total,
  totalPages: Math.max(1, Math.ceil(total / pageSize)),
});

/**
 * Access control helper: checks whether the user is the Admin Master
 */
function isMaster(user: typeof usersTable.$inferSelect | null | undefined) {
  return Boolean(user?.isMaster);
}

/**
 * Strips sensitive internal user fields before returning to client
 */
function publicUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isMaster: user.isMaster,
    merchantId: user.merchantId,
  };
}

/**
 * Augments raw product row with numeric price conversion and merchant reputation stats.
 * PRIVACY REQUIREMENT: Company names are NOT displayed in the public catalog.
 */
async function decorateProduct(product: typeof productsTable.$inferSelect) {
  const [[merchant], [ratingStats]] = await Promise.all([
    db
      .select({
        city: merchantsTable.city,
        hasDelivery: merchantsTable.hasDelivery,
      })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, product.merchantId))
      .limit(1),
    db
      .select({
        avgScore: sql<number>`ROUND(AVG(${orderRatingsTable.score})::numeric, 1)`,
        totalCount: sql<number>`COUNT(${orderRatingsTable.id})::int`,
      })
      .from(orderRatingsTable)
      .where(eq(orderRatingsTable.toMerchantId, product.merchantId)),
  ]);

  return {
    ...product,
    priceUsd: Number(product.priceUsd),
    // PRIVACY: Hide private company name from catalog before payment confirmation
    merchantName: "Comercio Verificado",
    merchantRating: ratingStats?.avgScore ? Number(ratingStats.avgScore) : 5.0,
    merchantRatingsCount: Number(ratingStats?.totalCount ?? 0),
    merchantCity: merchant?.city ?? "Barinas",
    merchantHasDelivery: merchant?.hasDelivery ?? false,
  };
}

/**
 * Augments raw order row with parsed numeric prices, exchange rate, associated line items,
 * latest payment report, order ratings, and merchant seller contact details.
 * Merchant contact details are ONLY populated once payment is confirmed!
 */
async function decorateOrder(order: typeof ordersTable.$inferSelect) {
  const items = await db
    .select()
    .from(orderItemsTable)
    .where(eq(orderItemsTable.orderId, order.id));

  // 1. Fetch latest reported payment for this order
  const [payment] = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.orderId, order.id))
    .orderBy(desc(paymentsTable.createdAt))
    .limit(1);

  // 2. Fetch merchant seller profile for the products in this order
  let merchant: any = null;
  const productIds = items.map((i) => i.productId);
  if (productIds.length > 0) {
    const [firstProduct] = await db
      .select({ merchantId: productsTable.merchantId })
      .from(productsTable)
      .where(inArray(productsTable.id, productIds))
      .limit(1);

    if (firstProduct?.merchantId) {
      const [m] = await db
        .select({
          id: merchantsTable.id,
          name: merchantsTable.name,
          city: merchantsTable.city,
          businessName: merchantsTable.businessName,
          rif: merchantsTable.rif,
          contactPhone: merchantsTable.contactPhone,
          address: merchantsTable.address,
          businessHours: merchantsTable.businessHours,
          hasDelivery: merchantsTable.hasDelivery,
        })
        .from(merchantsTable)
        .where(eq(merchantsTable.id, firstProduct.merchantId))
        .limit(1);

      if (m) {
        merchant = m;
      }
    }
  }

  // 3. Fetch ratings for this order
  const ratings = await db
    .select()
    .from(orderRatingsTable)
    .where(eq(orderRatingsTable.orderId, order.id));

  const merchantRating = ratings.find((r) => r.targetType === "merchant") || null;
  const customerRating = ratings.find((r) => r.targetType === "customer") || null;

  // 4. Fetch customer reputation if customerId exists (for merchant awareness)
  let customerReputation: any = null;
  if (order.customerId) {
    const [cStats] = await db
      .select({
        avgScore: sql<number>`ROUND(AVG(${orderRatingsTable.score})::numeric, 1)`,
        totalCount: sql<number>`COUNT(${orderRatingsTable.id})::int`,
      })
      .from(orderRatingsTable)
      .where(and(eq(orderRatingsTable.toCustomerId, order.customerId), eq(orderRatingsTable.targetType, "customer")));

    customerReputation = {
      avgScore: cStats?.avgScore ? Number(cStats.avgScore) : 5.0,
      totalCount: Number(cStats?.totalCount ?? 0),
    };
  }

  // PRIVACY: Only provide merchant company & contact details if payment has been confirmed!
  const isPaidOrBeyond = order.status !== "pending_payment";

  return {
    ...order,
    totalUsd: Number(order.totalUsd),
    totalBs: Number(order.totalBs),
    exchangeRate: Number(order.exchangeRate),
    deliveryCity: order.deliveryCity,
    items: items.map((item) => ({
      ...item,
      unitPriceUsd: Number(item.unitPriceUsd),
      subtotalUsd: Number(item.subtotalUsd),
    })),
    payment: payment ? { ...payment, amountBs: Number(payment.amountBs) } : null,
    merchant: isPaidOrBeyond ? merchant : null,
    merchantRating,
    customerRating,
    customerReputation,
  };
}

// ==========================================
// Dashboard & Metrics (Multitenancy Isolated)
// ==========================================

router.get("/dashboard/summary", requireAuth, async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (user?.role !== "admin" && user?.role !== "merchant") {
      res.status(403).json({ error: "No tienes permisos para ver el panel de operaciones." });
      return;
    }

    // Multitenancy: Merchants ONLY see their own metrics and sales
    if (user.role === "merchant") {
      const merchantId = user.merchantId;
      if (!merchantId) {
        res.json({
          todaySalesUsd: 0,
          pendingPayments: 0,
          activeProducts: 0,
          recentOrders: [],
          topCategories: [],
        });
        return;
      }

      const [productsCount, merchantOrderItems] = await Promise.all([
        db
          .select({ value: count() })
          .from(productsTable)
          .where(and(eq(productsTable.merchantId, merchantId), eq(productsTable.isVisible, true))),
        db
          .select({
            orderId: orderItemsTable.orderId,
            subtotalUsd: orderItemsTable.subtotalUsd,
          })
          .from(orderItemsTable)
          .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
          .where(eq(productsTable.merchantId, merchantId)),
      ]);

      const orderIds = Array.from(new Set(merchantOrderItems.map((i) => i.orderId)));
      let recentOrders: any[] = [];
      let pendingPaymentsCount = 0;
      let totalSales = 0;

      if (orderIds.length > 0) {
        const orders = await db
          .select()
          .from(ordersTable)
          .where(inArray(ordersTable.id, orderIds))
          .orderBy(desc(ordersTable.createdAt))
          .limit(5);

        recentOrders = await Promise.all(orders.map(decorateOrder));

        const pendingPayments = await db
          .select({ value: count() })
          .from(paymentsTable)
          .where(and(inArray(paymentsTable.orderId, orderIds), eq(paymentsTable.status, "pending")));
        pendingPaymentsCount = Number(pendingPayments[0]?.value ?? 0);

        totalSales = merchantOrderItems.reduce((acc, curr) => acc + Number(curr.subtotalUsd), 0);
      }

      res.json({
        todaySalesUsd: totalSales,
        pendingPayments: pendingPaymentsCount,
        activeProducts: Number(productsCount[0]?.value ?? 0),
        recentOrders,
        topCategories: [],
      });
      return;
    }

    // Admins see whole-platform totals
    const [products, merchants, payments, orders] = await Promise.all([
      db.select({ value: count() }).from(productsTable).where(eq(productsTable.isVisible, true)),
      db.select({ value: count() }).from(merchantsTable).where(eq(merchantsTable.isVisible, true)),
      db.select({ value: count() }).from(paymentsTable).where(eq(paymentsTable.status, "pending")),
      db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt)).limit(5),
    ]);
    const recentOrders = await Promise.all(orders.map(decorateOrder));
    res.json({
      todaySalesUsd: recentOrders
        .filter((order) => order.status !== "cancelled")
        .reduce((sum, order) => sum + Number(order.totalUsd), 0),
      pendingPayments: Number(payments[0]?.value ?? 0),
      activeProducts: Number(products[0]?.value ?? 0),
      activeMerchants: Number(merchants[0]?.value ?? 0),
      recentOrders,
      topCategories: [],
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// Exchange Rate Management (Strict RBAC - Master Only)
// ==========================================

router.get("/rates/today", async (_req, res, next) => {
  try {
    const [rate] = await db
      .select()
      .from(exchangeRatesTable)
      .where(eq(exchangeRatesTable.effectiveDate, today()))
      .limit(1);

    if (!rate) {
      res.status(404).json({ error: "No hay una tasa configurada para hoy." });
      return;
    }
    res.json({ ...rate, value: Number(rate.value) });
  } catch (error) {
    next(error);
  }
});

/**
 * SECURITY HARDENING:
 * Restricted to Admin Master only (isMaster === true).
 * Merchants and regular users strictly receive 403 Forbidden.
 */
const setExchangeRateHandler = async (req: any, res: any, next: any) => {
  try {
    const user = (req as RequestWithUser).user;
    if (!isMaster(user)) {
      res.status(403).json({ error: "Solo el Admin Master puede configurar la tasa de cambio." });
      return;
    }

    const body = CreateExchangeRateBody.parse(req.body);
    const [rate] = await db
      .insert(exchangeRatesTable)
      .values({
        value: body.value,
        currency: body.currency,
        effectiveDate: today(),
        updatedBy: user?.id ?? null,
      })
      .onConflictDoUpdate({
        target: exchangeRatesTable.effectiveDate,
        set: { value: body.value, currency: body.currency, updatedBy: user?.id ?? null },
      })
      .returning();

    res.status(201).json({ ...rate, value: Number(rate.value) });
  } catch (error) {
    next(error);
  }
};

router.post("/rates/today", requireAuth, setExchangeRateHandler);
router.post("/exchange-rates", requireAuth, setExchangeRateHandler);
router.put("/exchange-rates", requireAuth, setExchangeRateHandler);
router.get("/exchange-rates", async (req, res, next) => {
  try {
    const rates = await db
      .select()
      .from(exchangeRatesTable)
      .orderBy(desc(exchangeRatesTable.effectiveDate))
      .limit(30);
    res.json(rates.map((r) => ({ ...r, value: Number(r.value) })));
  } catch (error) {
    next(error);
  }
});


// ==========================================
// Payment Receiver Settings (Admin Master)
// ==========================================

router.get("/payment-receiver", async (_req, res, next) => {
  try {
    const [receiver] = await db
      .select()
      .from(paymentReceiverSettingsTable)
      .where(eq(paymentReceiverSettingsTable.isActive, true))
      .limit(1);

    if (!receiver) {
      res.status(404).json({ error: "No hay datos de pago configurados." });
      return;
    }
    res.json(receiver);
  } catch (error) {
    next(error);
  }
});

router.put("/payment-receiver", requireAuth, adminLimiter, async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (!isMaster(user)) {
      res.status(403).json({ error: "Solo el Admin Master puede editar los datos receptores." });
      return;
    }
    const body = UpdatePaymentReceiverBody.parse(req.body);
    const [current] = await db
      .select()
      .from(paymentReceiverSettingsTable)
      .where(eq(paymentReceiverSettingsTable.isActive, true))
      .limit(1);

    const [receiver] = current
      ? await db
          .update(paymentReceiverSettingsTable)
          .set({ ...body, updatedBy: user?.id ?? null, updatedAt: new Date() })
          .where(eq(paymentReceiverSettingsTable.id, current.id))
          .returning()
      : await db
          .insert(paymentReceiverSettingsTable)
          .values({ ...body, updatedBy: user?.id ?? null, isActive: true })
          .returning();

    res.json(receiver);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// Delivery Locations
// ==========================================

router.get("/delivery-locations", async (_req, res, next) => {
  try {
    const locations = await db
      .select()
      .from(deliveryLocationsTable)
      .where(eq(deliveryLocationsTable.isEnabled, true))
      .orderBy(deliveryLocationsTable.city);

    res.json(locations);
  } catch (error) {
    next(error);
  }
});

router.post("/delivery-locations", requireAuth, async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (!isMaster(user)) {
      res.status(403).json({ error: "Solo el Admin Master puede habilitar ciudades." });
      return;
    }
    const body = CreateDeliveryLocationBody.parse(req.body);
    const [location] = await db.insert(deliveryLocationsTable).values(body).returning();
    res.status(201).json(location);
  } catch (error: any) {
    if (error?.code === "23505") {
      res.status(409).json({ error: "Esa ciudad ya está configurada." });
      return;
    }
    next(error);
  }
});

router.patch("/delivery-locations/:locationId", requireAuth, async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (!isMaster(user)) {
      res.status(403).json({ error: "Solo el Admin Master puede habilitar ciudades." });
      return;
    }
    const { locationId } = UpdateDeliveryLocationParams.parse(req.params);
    const body = UpdateDeliveryLocationBody.parse(req.body);
    const [location] = await db
      .update(deliveryLocationsTable)
      .set(body)
      .where(eq(deliveryLocationsTable.id, locationId))
      .returning();

    if (!location) {
      res.status(404).json({ error: "Ciudad no encontrada." });
      return;
    }
    res.json(location);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// Catalog / Products
// ==========================================

router.get("/products", async (req, res, next) => {
  try {
    const query = ListProductsQueryParams.parse(req.query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 12;
    const filters = [eq(productsTable.isVisible, true)];

    if (query.category) filters.push(eq(productsTable.category, query.category));
    if (query.search) {
      filters.push(
        or(
          ilike(productsTable.name, `%${query.search}%`),
          ilike(productsTable.sku, `%${query.search}%`),
          ilike(productsTable.description, `%${query.search}%`),
        )!
      );
    }
    if (query.merchantId) filters.push(eq(productsTable.merchantId, query.merchantId));

    const [rows, totals] = await Promise.all([
      db
        .select()
        .from(productsTable)
        .where(and(...filters))
        .orderBy(desc(productsTable.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ value: count() }).from(productsTable).where(and(...filters)),
    ]);

    res.json({
      items: await Promise.all(rows.map(decorateProduct)),
      ...pageInfo(page, pageSize, Number(totals[0]?.value ?? 0)),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/products/:productId", async (req, res, next) => {
  try {
    const { productId } = GetProductParams.parse(req.params);
    const [product] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, productId))
      .limit(1);

    if (!product) {
      res.status(404).json({ error: "Repuesto no encontrado." });
      return;
    }
    res.json(await decorateProduct(product));
  } catch (error) {
    next(error);
  }
});

router.post("/products", requireAuth, async (req, res, next) => {
  try {
    const body = CreateProductBody.parse(req.body);
    const user = (req as RequestWithUser).user;
    if (!user?.merchantId) {
      res.status(403).json({ error: "Solo los comerciantes pueden publicar inventario." });
      return;
    }
    const [product] = await db
      .insert(productsTable)
      .values({ ...body, merchantId: user.merchantId })
      .returning();

    res.status(201).json(await decorateProduct(product));
  } catch (error) {
    next(error);
  }
});

router.patch("/products/:productId", requireAuth, async (req, res, next) => {
  try {
    const params = UpdateProductParams.parse(req.params);
    const body = UpdateProductBody.parse(req.body);
    const user = (req as RequestWithUser).user;

    if (!user) {
      res.status(401).json({ error: "No autorizado." });
      return;
    }

    // MULTITENANCY ISOLATION:
    // If user is a merchant, strictly require matching merchantId in the database query
    const whereConditions = [eq(productsTable.id, params.productId)];
    if (user.role === "merchant") {
      if (!user.merchantId) {
        res.status(403).json({ error: "No tienes una tienda asignada para modificar este repuesto." });
        return;
      }
      whereConditions.push(eq(productsTable.merchantId, user.merchantId));
    } else if (user.role !== "admin") {
      res.status(403).json({ error: "No tienes permisos para modificar inventario." });
      return;
    }

    const [product] = await db
      .update(productsTable)
      .set({ ...body, updatedAt: new Date() })
      .where(and(...whereConditions))
      .returning();

    if (!product) {
      res.status(404).json({ error: "Repuesto no encontrado o no pertenece a tu tienda." });
      return;
    }

    res.json(await decorateProduct(product));
  } catch (error) {
    next(error);
  }
});

router.delete("/products/:productId", requireAuth, async (req, res, next) => {
  try {
    const { productId } = UpdateProductParams.parse(req.params);
    const user = (req as RequestWithUser).user;

    if (!user) {
      res.status(401).json({ error: "No autorizado." });
      return;
    }

    // MULTITENANCY ISOLATION:
    // If user is a merchant, strictly require matching merchantId in the database query
    const whereConditions = [eq(productsTable.id, productId)];
    if (user.role === "merchant") {
      if (!user.merchantId) {
        res.status(403).json({ error: "No tienes una tienda asignada para archivar este repuesto." });
        return;
      }
      whereConditions.push(eq(productsTable.merchantId, user.merchantId));
    } else if (user.role !== "admin") {
      res.status(403).json({ error: "No tienes permisos para archivar inventario." });
      return;
    }

    const [product] = await db
      .update(productsTable)
      .set({ isVisible: false, updatedAt: new Date() })
      .where(and(...whereConditions))
      .returning();

    if (!product) {
      res.status(404).json({ error: "Repuesto no encontrado o no pertenece a tu tienda." });
      return;
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * POST /products/import
 * Bulk imports inventory from Excel (.xlsx/.xls) or CSV with automatic merchantId assignment.
 */
router.post("/products/import", requireAuth, upload.single("file"), async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (user?.role !== "admin" && user?.role !== "merchant") {
      res.status(403).json({ error: "Solo comerciantes y administradores pueden importar inventario." });
      return;
    }

    let merchantId = user.merchantId;
    if (!merchantId && user.role === "admin") {
      const [m] = await db.select({ id: merchantsTable.id }).from(merchantsTable).limit(1);
      merchantId = m?.id ?? null;
    }

    if (!merchantId) {
      res.status(400).json({ error: "No hay una tienda asociada para asignar los repuestos." });
      return;
    }

    let fileBuffer: Buffer | null = null;
    if (req.file) {
      fileBuffer = req.file.buffer;
    } else if (req.body.fileData) {
      const raw = String(req.body.fileData);
      const base64Part = raw.includes(";base64,") ? raw.split(";base64,")[1] : raw;
      fileBuffer = Buffer.from(base64Part, "base64");
    }

    if (!fileBuffer) {
      res.status(400).json({ error: "No se proporcionó ningún archivo Excel o CSV para importar." });
      return;
    }

    const { rows, errors } = parseProductFile(fileBuffer);
    if (rows.length === 0) {
      res.status(400).json({
        error: "No se encontraron productos válidos para importar en el archivo.",
        details: errors,
      });
      return;
    }

    let importedCount = 0;
    for (const r of rows) {
      await db
        .insert(productsTable)
        .values({
          merchantId,
          sku: r.sku,
          name: r.name,
          category: r.category,
          description: r.description,
          priceUsd: r.priceUsd,
          stock: r.stock,
          condition: r.condition,
          isVisible: r.isVisible,
        })
        .onConflictDoUpdate({
          target: [productsTable.merchantId, productsTable.sku],
          set: {
            name: r.name,
            category: r.category,
            description: r.description,
            priceUsd: r.priceUsd,
            stock: r.stock,
            condition: r.condition,
            isVisible: r.isVisible,
            updatedAt: new Date(),
          },
        });
      importedCount++;
    }

    res.json({
      success: true,
      importedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Error al procesar la importación del archivo." });
  }
});

// ==========================================
// Orders Management (Multitenancy Isolated)
// ==========================================

router.get("/orders", requireAuth, async (req, res, next) => {
  try {
    const query = ListOrdersQueryParams.parse(req.query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 12;
    const user = (req as RequestWithUser).user;

    // Multitenancy: Merchants ONLY see orders that include their own products
    if (user?.role === "merchant") {
      if (!user.merchantId) {
        res.json({ items: [], ...pageInfo(page, pageSize, 0) });
        return;
      }
      const merchantOrderItems = await db
        .select({ orderId: orderItemsTable.orderId })
        .from(orderItemsTable)
        .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
        .where(eq(productsTable.merchantId, user.merchantId));

      const orderIds = Array.from(new Set(merchantOrderItems.map((i) => i.orderId)));
      if (orderIds.length === 0) {
        res.json({ items: [], ...pageInfo(page, pageSize, 0) });
        return;
      }

      const merchantFilters = [inArray(ordersTable.id, orderIds)];
      if (query.status) merchantFilters.push(eq(ordersTable.status, query.status));

      const [rows, totals] = await Promise.all([
        db
          .select()
          .from(ordersTable)
          .where(and(...merchantFilters))
          .orderBy(desc(ordersTable.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ value: count() }).from(ordersTable).where(and(...merchantFilters)),
      ]);

      res.json({
        items: await Promise.all(rows.map(decorateOrder)),
        ...pageInfo(page, pageSize, Number(totals[0]?.value ?? 0)),
      });
      return;
    }

    // Customers see only orders they placed; Admins see all
    const filters = user?.role === "admin" ? [] : [eq(ordersTable.customerId, user?.id ?? "")];
    if (query.status) filters.push(eq(ordersTable.status, query.status));

    const [rows, totals] = await Promise.all([
      db
        .select()
        .from(ordersTable)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(ordersTable.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ value: count() }).from(ordersTable).where(filters.length ? and(...filters) : undefined),
    ]);

    res.json({
      items: await Promise.all(rows.map(decorateOrder)),
      ...pageInfo(page, pageSize, Number(totals[0]?.value ?? 0)),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * SECURITY HARDENING: POST /orders
 * 1. Transaction wrapping: All checks, stock updates, and order creations happen atomically.
 * 2. Concurrency control: Each product row is fetched with `FOR UPDATE` lock to eliminate race conditions.
 * 3. Strict stock verification: Every product's stock is validated under lock; rejects with 409 if insufficient.
 * 4. Server-side price authority: Prices are fetched directly from the database and currency converted
 *    using the verified daily exchange rate. Client-provided prices are completely ignored.
 * 5. Atomic stock decrement: Stock is reduced via SQL arithmetic inside the active transaction.
 */
/**
 * POST /orders - Creates a new customer order with defensive concurrency controls.
 *
 * Security & Reliability Architecture:
 * 1. Layered Rate Limiting: Max 10 attempts per 15 min per user/IP via checkoutAndPaymentLimiter.
 * 2. Inventory Hoarding Defense: Customers with >= 2 orders in 'pending_payment' cannot create new ones
 *    until existing orders are paid or cancelled.
 * 3. Deadlock Prevention: Product IDs are sorted alphabetically before row locking so concurrent
 *    orders acquire locks in identical deterministic hierarchy.
 * 4. Lock Timeout Protection: SET LOCAL lock_timeout = '4s' prevents connection pool starvation.
 * 5. Strict stock verification: Every product's stock is validated under lock; rejects with 409 if insufficient.
 * 6. Server-side price authority: Prices are fetched directly from the database and currency converted
 *    using verified daily exchange rate.
 * 7. Atomic stock decrement: Stock is reduced via SQL arithmetic inside the active transaction.
 */
router.post("/orders", optionalUser, checkoutAndPaymentLimiter, async (req, res, next) => {
  try {
    const body = CreateOrderBody.parse(req.body);
    const user = (req as RequestWithUser).user;

    // Inventory Hoarding Protection: Maximum 2 unpaid orders per user
    if (user?.id) {
      const [pendingCount] = await db
        .select({ count: count() })
        .from(ordersTable)
        .where(and(eq(ordersTable.customerId, user.id), eq(ordersTable.status, "pending_payment")));

      if (Number(pendingCount?.count ?? 0) >= 2) {
        res.status(429).json({
          error:
            "Tienes 2 pedidos pendientes de pago. Por favor registra tu Pago Móvil o cancela un pedido anterior antes de crear uno nuevo.",
        });
        return;
      }
    }

    // Validate that the requested delivery city is currently enabled
    const [location] = await db
      .select()
      .from(deliveryLocationsTable)
      .where(and(eq(deliveryLocationsTable.city, body.deliveryCity), eq(deliveryLocationsTable.isEnabled, true)))
      .limit(1);

    if (!location) {
      res.status(400).json({ error: "La ciudad de entrega no está disponible." });
      return;
    }

    // Validate that today's official exchange rate is configured
    const [rate] = await db
      .select()
      .from(exchangeRatesTable)
      .where(eq(exchangeRatesTable.effectiveDate, today()))
      .limit(1);

    if (!rate) {
      res.status(400).json({ error: "La tasa del día aún no está configurada." });
      return;
    }
    const rateValue = Number(rate.value);

    // Aggregate requested quantities per product to handle duplicate cart lines cleanly
    const requestedQuantities = new Map<string, number>();
    for (const item of body.items) {
      requestedQuantities.set(
        item.productId,
        (requestedQuantities.get(item.productId) ?? 0) + item.quantity
      );
    }

    // Deadlock Prevention: Sort product IDs alphabetically to enforce consistent locking order
    const sortedProductIds = Array.from(requestedQuantities.keys()).sort();

    // Begin atomic transaction with row locking
    const order = await db.transaction(async (tx) => {
      // Fail-fast timeout on row locking to protect connection pool from deadlocks
      await tx.execute(sql`SET LOCAL lock_timeout = '4s'`);

      const lockedProducts = new Map<string, typeof productsTable.$inferSelect>();

      // Fetch and acquire exclusive row lock (FOR UPDATE) in sorted deterministic order
      for (const productId of sortedProductIds) {
        const requestedQuantity = requestedQuantities.get(productId)!;
        const [product] = await tx
          .select()
          .from(productsTable)
          .where(and(eq(productsTable.id, productId), eq(productsTable.isVisible, true)))
          .for("update");

        if (!product) {
          const err = new Error(`El repuesto con ID "${productId}" ya no está disponible.`);
          (err as any).statusCode = 400;
          throw err;
        }

        // Security check: Verify sufficient inventory under exclusive lock
        if (product.stock < requestedQuantity) {
          const err = new Error(
            `Stock insuficiente para "${product.name}". Disponible: ${product.stock}, solicitado: ${requestedQuantity}.`
          );
          (err as any).statusCode = 409;
          throw err;
        }

        lockedProducts.set(productId, product);
      }

      // Decrement stock atomically for each product using database arithmetic
      for (const productId of sortedProductIds) {
        const requestedQuantity = requestedQuantities.get(productId)!;
        await tx
          .update(productsTable)
          .set({
            stock: sql`${productsTable.stock} - ${requestedQuantity}`,
            updatedAt: new Date(),
          })
          .where(eq(productsTable.id, productId));
      }

      // Compute order items and totals strictly server-side from verified DB prices
      const itemsToInsert = body.items.map((item) => {
        const product = lockedProducts.get(item.productId)!;
        const unitPriceUsd = Number(product.priceUsd);
        const subtotalUsd = Number((unitPriceUsd * item.quantity).toFixed(2));
        return {
          productId: product.id,
          productName: product.name,
          quantity: item.quantity,
          unitPriceUsd,
          subtotalUsd,
        };
      });

      const totalUsd = Number(
        itemsToInsert.reduce((sum, item) => sum + item.subtotalUsd, 0).toFixed(2)
      );
      const totalBs = Number((totalUsd * rateValue).toFixed(2));

      // Insert new order record within transaction
      const [newOrder] = await tx
        .insert(ordersTable)
        .values({
          customerId: user?.id ?? null,
          customerName: body.customerName,
          customerPhone: body.customerPhone,
          deliveryCity: body.deliveryCity,
          pickupNotes: body.pickupNotes ?? null,
          totalUsd,
          totalBs,
          exchangeRate: rateValue,
        })
        .returning();

      // Insert line items bound to the new order
      await tx.insert(orderItemsTable).values(
        itemsToInsert.map((item) => ({
          ...item,
          orderId: newOrder.id,
        }))
      );

      return newOrder;
    });

    res.status(201).json(await decorateOrder(order));
  } catch (error: any) {
    if (error?.statusCode === 409) {
      res.status(409).json({ error: error.message });
      return;
    }
    if (error?.statusCode === 400) {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

router.get("/orders/:orderId", requireAuth, async (req, res, next) => {
  try {
    const { orderId } = GetOrderParams.parse(req.params);
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
    if (!order) {
      res.status(404).json({ error: "Pedido no encontrado." });
      return;
    }
    const user = (req as RequestWithUser).user;

    // Platform admin can view any order
    if (user?.role === "admin") {
      res.json(await decorateOrder(order));
      return;
    }

    // Merchant can only view order if it contains their products
    if (user?.role === "merchant" && user.merchantId) {
      const items = await db
        .select()
        .from(orderItemsTable)
        .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
        .where(and(eq(orderItemsTable.orderId, orderId), eq(productsTable.merchantId, user.merchantId)))
        .limit(1);

      if (items.length === 0) {
        res.status(403).json({ error: "No tienes permiso para consultar este pedido de otro comercio." });
        return;
      }
      res.json(await decorateOrder(order));
      return;
    }

    // Customer can only view their own order (or claim unassigned order)
    if (!order.customerId && user?.id) {
      await db.update(ordersTable).set({ customerId: user.id }).where(eq(ordersTable.id, order.id));
      order.customerId = user.id;
    }

    if (order.customerId !== user?.id) {
      res.status(403).json({ error: "No puedes consultar este pedido." });
      return;
    }
    res.json(await decorateOrder(order));
  } catch (error) {
    next(error);
  }
});

router.patch("/orders/:orderId", requireAuth, async (req, res, next) => {
  try {
    const { orderId } = UpdateOrderStatusParams.parse(req.params);
    const body = UpdateOrderStatusBody.parse(req.body);
    const user = (req as RequestWithUser).user;
    if (!user) {
      res.status(401).json({ error: "No autorizado." });
      return;
    }

    const [existingOrder] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .limit(1);

    if (!existingOrder) {
      res.status(404).json({ error: "Pedido no encontrado." });
      return;
    }

    // Auto-link customerId if null and current user is a customer
    if (!existingOrder.customerId && user.id) {
      await db
        .update(ordersTable)
        .set({ customerId: user.id })
        .where(eq(ordersTable.id, existingOrder.id));
      existingOrder.customerId = user.id;
    }

    // Role-based status transition checks
    if (user.role !== "admin" && user.role !== "merchant") {
      // Customer: can confirm delivery ('delivered') on their own order
      const isOwner = existingOrder.customerId === user.id;
      if (!isOwner) {
        res.status(403).json({ error: "No tienes permisos para modificar este pedido." });
        return;
      }
      if (body.status !== "delivered") {
        res.status(403).json({ error: "Como cliente solo puedes confirmar la entrega de tu pedido." });
        return;
      }
      if (!["paid", "preparing", "ready"].includes(existingOrder.status)) {
        res.status(400).json({ error: "El pedido debe haber sido pagado, estar en preparación o listo antes de confirmar su entrega." });
        return;
      }
    } else if (user.role === "merchant") {
      // Multitenancy: Merchant can only update status if order contains their products
      if (!user.merchantId) {
        res.status(403).json({ error: "No tienes perfil de comerciante asignado." });
        return;
      }
      const items = await db
        .select()
        .from(orderItemsTable)
        .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
        .where(and(eq(orderItemsTable.orderId, orderId), eq(productsTable.merchantId, user.merchantId)))
        .limit(1);

      if (items.length === 0) {
        res.status(403).json({ error: "No tienes permisos para modificar pedidos de otros comerciantes." });
        return;
      }
    }

    const [order] = await db
      .update(ordersTable)
      .set({ status: body.status })
      .where(eq(ordersTable.id, orderId))
      .returning();

    if (!order) {
      res.status(404).json({ error: "Pedido no encontrado." });
      return;
    }
    res.json(await decorateOrder(order));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /orders/:orderId/cancel - Customer self-cancellation for unpaid orders.
 *
 * Atomically transitions order status to 'cancelled' and refunds reserved stock
 * back to productsTable. Frees up inventory immediately without waiting for the 45m worker.
 */
router.post("/orders/:orderId/cancel", requireAuth, async (req, res, next) => {
  try {
    const { orderId } = GetOrderParams.parse(req.params);
    const user = (req as RequestWithUser).user;
    if (!user) {
      res.status(401).json({ error: "Debes iniciar sesión para cancelar este pedido." });
      return;
    }

    const [order] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "Pedido no encontrado." });
      return;
    }

    // Ownership & permission guard: customer who placed order OR platform admin
    const isOwner = order.customerId === user.id;
    const isStaff = user.role === "admin" || user.isMaster;
    if (!isOwner && !isStaff) {
      res.status(403).json({ error: "No tienes permiso para cancelar este pedido." });
      return;
    }

    // Status guard: Only unpaid pending orders can be cancelled with stock reversal
    if (order.status !== "pending_payment") {
      res.status(400).json({
        error: "Solo se pueden cancelar pedidos pendientes de pago. Si ya pagaste, contacta a soporte.",
      });
      return;
    }

    const cancelledOrder = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '4s'`);

      // Verify and lock order row
      const [lockedOrder] = await tx
        .select()
        .from(ordersTable)
        .where(and(eq(ordersTable.id, orderId), eq(ordersTable.status, "pending_payment")))
        .for("update");

      if (!lockedOrder) {
        const err = new Error("El pedido ya no está en estado pendiente de pago.");
        (err as any).statusCode = 409;
        throw err;
      }

      // Mark order cancelled
      const [updated] = await tx
        .update(ordersTable)
        .set({ status: "cancelled" })
        .where(eq(ordersTable.id, orderId))
        .returning();

      // Retrieve items
      const items = await tx
        .select()
        .from(orderItemsTable)
        .where(eq(orderItemsTable.orderId, orderId));

      // Sort items by productId to maintain deterministic locking sequence
      const sortedItems = [...items].sort((a, b) => a.productId.localeCompare(b.productId));

      // Atomically restore stock in catalog
      for (const item of sortedItems) {
        await tx
          .update(productsTable)
          .set({
            stock: sql`${productsTable.stock} + ${item.quantity}`,
            updatedAt: new Date(),
          })
          .where(eq(productsTable.id, item.productId));
      }

      return updated;
    });

    res.json(await decorateOrder(cancelledOrder));
  } catch (error: any) {
    if (error?.statusCode === 409) {
      res.status(409).json({ error: error.message });
      return;
    }
    next(error);
  }
});

// ==========================================
// Payments & Anti-Fraud Verification (Multitenancy Isolated)
// ==========================================

router.get("/payments", requireAuth, async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (user?.role !== "admin" && user?.role !== "merchant") {
      res.status(403).json({ error: "Solo administración o comerciantes pueden revisar pagos." });
      return;
    }
    const query = ListPaymentsQueryParams.parse(req.query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 12;

    // Multitenancy: Merchants ONLY see payments for orders that contain their products
    if (user.role === "merchant") {
      if (!user.merchantId) {
        res.json({ items: [], ...pageInfo(page, pageSize, 0) });
        return;
      }
      const merchantOrderItems = await db
        .select({ orderId: orderItemsTable.orderId })
        .from(orderItemsTable)
        .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
        .where(eq(productsTable.merchantId, user.merchantId));

      const orderIds = Array.from(new Set(merchantOrderItems.map((i) => i.orderId)));
      if (orderIds.length === 0) {
        res.json({ items: [], ...pageInfo(page, pageSize, 0) });
        return;
      }

      const pFilters = [inArray(paymentsTable.orderId, orderIds)];
      if (query.status) pFilters.push(eq(paymentsTable.status, query.status));

      const [items, totals] = await Promise.all([
        db
          .select()
          .from(paymentsTable)
          .where(and(...pFilters))
          .orderBy(desc(paymentsTable.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ value: count() }).from(paymentsTable).where(and(...pFilters)),
      ]);

      res.json({
        items: items.map((item) => ({ ...item, amountBs: Number(item.amountBs) })),
        ...pageInfo(page, pageSize, Number(totals[0]?.value ?? 0)),
      });
      return;
    }

    // Platform admin sees all payments
    const filters = query.status ? [eq(paymentsTable.status, query.status)] : [];

    const [items, totals] = await Promise.all([
      db
        .select()
        .from(paymentsTable)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(paymentsTable.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ value: count() }).from(paymentsTable).where(filters.length ? and(...filters) : undefined),
    ]);

    res.json({
      items: items.map((item) => ({ ...item, amountBs: Number(item.amountBs) })),
      ...pageInfo(page, pageSize, Number(totals[0]?.value ?? 0)),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /payments/upload-receipt
 * Uploads a payment receipt to Google Drive using a Service Account and returns the public webViewLink.
 */
router.post("/payments/upload-receipt", optionalUser, upload.single("receipt"), async (req, res, next) => {
  try {
    let fileBuffer: Buffer | null = null;
    let filename = "comprobante.jpg";
    let mimetype = "image/jpeg";

    if (req.file) {
      fileBuffer = req.file.buffer;
      filename = req.file.originalname;
      mimetype = req.file.mimetype;
    } else if (req.body?.fileData) {
      const raw = String(req.body.fileData);
      const matches = raw.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        mimetype = matches[1];
        fileBuffer = Buffer.from(matches[2], "base64");
      } else {
        fileBuffer = Buffer.from(raw, "base64");
      }
      filename = req.body.fileName || "comprobante.png";
    }

    if (!fileBuffer) {
      res.status(400).json({ error: "No se proporcionó ningún archivo de comprobante de pago." });
      return;
    }

    const result = await uploadReceiptToDrive(fileBuffer, filename, mimetype);
    res.json({
      success: true,
      webViewLink: result.webViewLink,
      fileId: result.fileId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * SECURITY HARDENING: POST /payments Anti-Fraud Validation
 * 1. Verify existence: Ensures the specified orderId actually exists.
 * 2. Ownership authorization: Order must belong to authenticated user OR caller must be admin.
 * 3. Status validation: Order must be in 'pending_payment' state (rejects if already paid/processed).
 * 4. Exact amount verification: Submitted amountBs must strictly equal order.totalBs to prevent payment tampering.
 * 5. Unique reference guarantee: Catches PostgreSQL 23505 unique constraint violation for duplicate payment references.
 * 6. Atomic transition: Creates payment and transitions order status to 'paid' in a single transaction.
 */
router.post("/payments", requireAuth, checkoutAndPaymentLimiter, async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (!user) {
      res.status(401).json({ error: "Debes iniciar sesión para reportar un pago." });
      return;
    }

    const body = SubmitPaymentBody.parse(req.body);
    const receiptUrl = (req.body as any)?.receiptUrl ? String((req.body as any).receiptUrl) : null;

    // Anti-fraud check 1: Verify order exists
    const [order] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, body.orderId))
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "El pedido especificado no existe." });
      return;
    }

    // Anti-fraud check 2: Verify user ownership or admin privilege
    let isOwner = order.customerId === user.id;
    const isAdmin = user.role === "admin";

    // If order was created without a customer id, bind it to the paying authenticated user
    if (!order.customerId && user.id) {
      await db.update(ordersTable).set({ customerId: user.id }).where(eq(ordersTable.id, order.id));
      order.customerId = user.id;
      isOwner = true;
    }

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: "No tienes permiso para reportar el pago de este pedido." });
      return;
    }

    // Anti-fraud check 3: Verify order status is pending_payment (reject if already paid)
    if (order.status !== "pending_payment") {
      res.status(400).json({
        error: `El pedido no se encuentra pendiente de pago (estado actual: ${order.status}).`,
      });
      return;
    }

    // Anti-fraud check 4: Verify amountBs matches order.totalBs exactly (prevent tampering)
    const submittedAmount = Number(Number(body.amountBs).toFixed(2));
    const requiredAmount = Number(Number(order.totalBs).toFixed(2));
    if (Math.abs(submittedAmount - requiredAmount) > 0.01) {
      res.status(400).json({
        error: `El monto reportado (Bs. ${submittedAmount}) no coincide con el total del pedido (Bs. ${requiredAmount}).`,
      });
      return;
    }

    // Save payment in 'pending' status.
    // NOTE: The order status remains 'pending_payment' until the merchant explicitly verifies
    // the bank transfer in their account and confirms the payment!
    const [payment] = await db
      .insert(paymentsTable)
      .values({
        orderId: body.orderId,
        bank: body.bank,
        identityNumber: body.identityNumber,
        reference: body.reference,
        phone: body.phone,
        amountBs: submittedAmount,
        receiptUrl,
        status: "pending",
      })
      .returning();

    res.status(201).json({ ...payment, amountBs: Number(payment.amountBs) });
  } catch (error: any) {
    // Check for duplicate payment reference error (PostgreSQL unique error 23505)
    if (error?.code === "23505") {
      res.status(409).json({ error: "Esta referencia de pago ya fue utilizada." });
      return;
    }
    next(error);
  }
});

/**
 * POST /payments/:paymentId/confirm
 * Merchant / Admin confirms the mobile payment after checking their bank account.
 * Atomically transitions payment to 'approved' and order status to 'paid'.
 */
router.post("/payments/:paymentId/confirm", requireAuth, async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (user?.role !== "admin" && user?.role !== "merchant") {
      res.status(403).json({ error: "Solo el comerciante vendedor o el administrador pueden confirmar pagos." });
      return;
    }

    const paymentId = String(req.params.paymentId);
    const [payment] = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.id, paymentId))
      .limit(1);

    if (!payment) {
      res.status(404).json({ error: "Pago no encontrado." });
      return;
    }

    // Multitenancy: Merchant can only confirm payment for orders containing their products
    if (user.role === "merchant") {
      if (!user.merchantId) {
        res.status(403).json({ error: "No tienes un perfil de comerciante asignado." });
        return;
      }

      const items = await db
        .select()
        .from(orderItemsTable)
        .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
        .where(and(eq(orderItemsTable.orderId, payment.orderId), eq(productsTable.merchantId, user.merchantId)))
        .limit(1);

      if (items.length === 0) {
        res.status(403).json({ error: "No tienes permiso para confirmar pagos de pedidos pertenecientes a otros comercios." });
        return;
      }
    }

    // Atomic update: Mark payment as 'approved' and order as 'paid'
    const result = await db.transaction(async (tx) => {
      const [updatedPayment] = await tx
        .update(paymentsTable)
        .set({ status: "approved" })
        .where(eq(paymentsTable.id, paymentId))
        .returning();

      const [updatedOrder] = await tx
        .update(ordersTable)
        .set({ status: "paid" })
        .where(eq(ordersTable.id, payment.orderId))
        .returning();

      return { payment: updatedPayment, order: updatedOrder };
    });

    res.json({
      message: "Pago confirmado y acreditado exitosamente.",
      payment: { ...result.payment, amountBs: Number(result.payment.amountBs) },
      order: await decorateOrder(result.order),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /payments/:paymentId/reject
 * Merchant / Admin rejects a fraudulent or invalid payment reference.
 */
router.post("/payments/:paymentId/reject", requireAuth, async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (user?.role !== "admin" && user?.role !== "merchant") {
      res.status(403).json({ error: "Solo el comerciante o el administrador pueden rechazar pagos." });
      return;
    }

    const paymentId = String(req.params.paymentId);
    const [payment] = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.id, paymentId))
      .limit(1);

    if (!payment) {
      res.status(404).json({ error: "Pago no encontrado." });
      return;
    }

    // Multitenancy: Merchant can only reject payment for orders containing their products
    if (user.role === "merchant") {
      if (!user.merchantId) {
        res.status(403).json({ error: "No tienes un perfil de comerciante asignado." });
        return;
      }

      const items = await db
        .select()
        .from(orderItemsTable)
        .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
        .where(and(eq(orderItemsTable.orderId, payment.orderId), eq(productsTable.merchantId, user.merchantId)))
        .limit(1);

      if (items.length === 0) {
        res.status(403).json({ error: "No tienes permiso para gestionar pagos de otros comercios." });
        return;
      }
    }

    const [updatedPayment] = await db
      .update(paymentsTable)
      .set({ status: "rejected" })
      .where(eq(paymentsTable.id, paymentId))
      .returning();

    res.json({
      message: "Pago rechazado.",
      payment: { ...updatedPayment, amountBs: Number(updatedPayment.amountBs) },
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// Merchant Profile Management
// ==========================================

router.get("/merchant/profile", requireAuth, async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (!user?.merchantId) {
      res.status(404).json({ error: "No tienes un perfil de comerciante asignado." });
      return;
    }
    const [merchant] = await db
      .select()
      .from(merchantsTable)
      .where(eq(merchantsTable.id, user.merchantId))
      .limit(1);

    if (!merchant) {
      res.status(404).json({ error: "Tienda de comerciante no encontrada." });
      return;
    }
    res.json(merchant);
  } catch (error) {
    next(error);
  }
});

router.patch("/merchant/profile", requireAuth, async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (!user?.merchantId) {
      res.status(404).json({ error: "No tienes un perfil de comerciante asignado." });
      return;
    }
    const allowed = [
      "name",
      "city",
      "businessName",
      "rif",
      "contactPhone",
      "address",
      "businessHours",
      "hasDelivery",
    ];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No se proporcionaron campos para actualizar." });
      return;
    }
    const [merchant] = await db
      .update(merchantsTable)
      .set(updates)
      .where(eq(merchantsTable.id, user.merchantId))
      .returning();

    if (!merchant) {
      res.status(404).json({ error: "Tienda no encontrada." });
      return;
    }
    res.json(merchant);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// Order Ratings & Reputation System (1 to 5 Stars)
// ==========================================

/**
 * POST /orders/:orderId/rate-merchant
 * Customer rates merchant (1 to 5 stars) after order delivery.
 */
router.post("/orders/:orderId/rate-merchant", requireAuth, async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (!user) {
      res.status(401).json({ error: "Debes iniciar sesión para calificar." });
      return;
    }

    const orderId = String(req.params.orderId);
    const { score, comment } = req.body;
    const numericScore = Math.round(Number(score));

    if (!numericScore || numericScore < 1 || numericScore > 5) {
      res.status(400).json({ error: "La calificación debe ser un número entero entre 1 y 5 estrellas." });
      return;
    }

    const [order] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "Pedido no encontrado." });
      return;
    }

    // Only the customer who placed the order can rate the merchant
    if (order.customerId !== user.id) {
      res.status(403).json({ error: "Solo el comprador de este pedido puede calificar al comercio." });
      return;
    }

    // REQUIREMENT: Rating is ONLY allowed after order has been delivered!
    if (order.status !== "delivered") {
      res.status(400).json({
        error: "Solo puedes calificar al comercio una vez que el pedido haya sido entregado ('delivered').",
      });
      return;
    }

    // Find the merchant from the order's items
    const [item] = await db
      .select({ merchantId: productsTable.merchantId })
      .from(orderItemsTable)
      .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
      .where(eq(orderItemsTable.orderId, order.id))
      .limit(1);

    if (!item?.merchantId) {
      res.status(400).json({ error: "No se encontró el comerciante vendedor asociado al pedido." });
      return;
    }

    // Insert or update rating
    const [rating] = await db
      .insert(orderRatingsTable)
      .values({
        orderId: order.id,
        targetType: "merchant",
        fromUserId: user.id,
        toMerchantId: item.merchantId,
        score: numericScore,
        comment: comment ? String(comment).trim().slice(0, 500) : null,
      })
      .onConflictDoUpdate({
        target: [orderRatingsTable.orderId, orderRatingsTable.targetType],
        set: {
          score: numericScore,
          comment: comment ? String(comment).trim().slice(0, 500) : null,
          createdAt: sql`now()`,
        },
      })
      .returning();

    res.status(201).json({
      message: "¡Calificación al comercio enviada con éxito!",
      rating,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /orders/:orderId/rate-customer
 * Merchant rates customer (1 to 5 stars) after order delivery.
 */
router.post("/orders/:orderId/rate-customer", requireAuth, async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (user?.role !== "admin" && user?.role !== "merchant") {
      res.status(403).json({ error: "Solo los comerciantes o administradores pueden calificar clientes." });
      return;
    }

    const orderId = String(req.params.orderId);
    const { score, comment } = req.body;
    const numericScore = Math.round(Number(score));

    if (!numericScore || numericScore < 1 || numericScore > 5) {
      res.status(400).json({ error: "La calificación debe ser un número entero entre 1 y 5 estrellas." });
      return;
    }

    const [order] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "Pedido no encontrado." });
      return;
    }

    // Multitenancy: Merchant must own the products in this order
    if (user.role === "merchant") {
      const items = await db
        .select()
        .from(orderItemsTable)
        .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
        .where(and(eq(orderItemsTable.orderId, order.id), eq(productsTable.merchantId, user.merchantId!)))
        .limit(1);

      if (items.length === 0) {
        res.status(403).json({ error: "No tienes permiso para calificar pedidos de otros comercios." });
        return;
      }
    }

    // REQUIREMENT: Rating is ONLY allowed after order has been delivered!
    if (order.status !== "delivered") {
      res.status(400).json({
        error: "Solo puedes calificar al cliente una vez que el pedido haya sido entregado ('delivered').",
      });
      return;
    }

    if (!order.customerId) {
      res.status(400).json({ error: "Este pedido no tiene un usuario cliente registrado para calificar." });
      return;
    }

    // Insert or update rating
    const [rating] = await db
      .insert(orderRatingsTable)
      .values({
        orderId: order.id,
        targetType: "customer",
        fromUserId: user.id,
        toCustomerId: order.customerId,
        score: numericScore,
        comment: comment ? String(comment).trim().slice(0, 500) : null,
      })
      .onConflictDoUpdate({
        target: [orderRatingsTable.orderId, orderRatingsTable.targetType],
        set: {
          score: numericScore,
          comment: comment ? String(comment).trim().slice(0, 500) : null,
          createdAt: sql`now()`,
        },
      })
      .returning();

    res.status(201).json({
      message: "¡Calificación al cliente enviada con éxito!",
      rating,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /merchant/reputation
 * Returns reputation metrics and rating statistics for the logged-in merchant.
 */
router.get("/merchant/reputation", requireAuth, async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (!user?.merchantId) {
      res.status(403).json({ error: "No tienes un perfil de comerciante asignado." });
      return;
    }

    const [stats] = await db
      .select({
        avgScore: sql<number>`ROUND(AVG(${orderRatingsTable.score})::numeric, 1)`,
        totalCount: sql<number>`COUNT(${orderRatingsTable.id})::int`,
        fiveStars: sql<number>`COUNT(CASE WHEN ${orderRatingsTable.score} = 5 THEN 1 END)::int`,
        fourStars: sql<number>`COUNT(CASE WHEN ${orderRatingsTable.score} = 4 THEN 1 END)::int`,
        threeStars: sql<number>`COUNT(CASE WHEN ${orderRatingsTable.score} = 3 THEN 1 END)::int`,
        twoStars: sql<number>`COUNT(CASE WHEN ${orderRatingsTable.score} = 2 THEN 1 END)::int`,
        oneStars: sql<number>`COUNT(CASE WHEN ${orderRatingsTable.score} = 1 THEN 1 END)::int`,
      })
      .from(orderRatingsTable)
      .where(eq(orderRatingsTable.toMerchantId, user.merchantId));

    const recentReviews = await db
      .select({
        id: orderRatingsTable.id,
        score: orderRatingsTable.score,
        comment: orderRatingsTable.comment,
        createdAt: orderRatingsTable.createdAt,
        orderId: orderRatingsTable.orderId,
      })
      .from(orderRatingsTable)
      .where(eq(orderRatingsTable.toMerchantId, user.merchantId))
      .orderBy(desc(orderRatingsTable.createdAt))
      .limit(10);

    res.json({
      avgScore: stats?.avgScore ? Number(stats.avgScore) : 5.0,
      totalCount: Number(stats?.totalCount ?? 0),
      distribution: {
        5: Number(stats?.fiveStars ?? 0),
        4: Number(stats?.fourStars ?? 0),
        3: Number(stats?.threeStars ?? 0),
        2: Number(stats?.twoStars ?? 0),
        1: Number(stats?.oneStars ?? 0),
      },
      recentReviews,
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// Admin User Management
// ==========================================

router.get("/admin/users", requireAuth, adminLimiter, async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (!isMaster(user)) {
      res.status(403).json({ error: "Solo el Admin Master puede administrar usuarios." });
      return;
    }
    const users = await db.select().from(usersTable).orderBy(usersTable.createdAt);
    res.json(users.map(publicUser));
  } catch (error) {
    next(error);
  }
});

router.patch("/admin/users/:userId/role", requireAuth, adminLimiter, async (req, res, next) => {
  try {
    const currentUser = (req as RequestWithUser).user;
    if (!isMaster(currentUser)) {
      res.status(403).json({ error: "Solo el Admin Master puede cambiar roles." });
      return;
    }
    const body = UpdateUserRoleBody.parse(req.body);
    const [target] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, String(req.params.userId)))
      .limit(1);

    if (!target) {
      res.status(404).json({ error: "Usuario no encontrado." });
      return;
    }
    if (target.isMaster || target.email.toLowerCase() === MASTER_EMAIL) {
      res.status(400).json({ error: "El Admin Master no puede perder sus permisos." });
      return;
    }

    let merchantId = body.merchantId ?? null;
    if (body.role === "merchant" && !merchantId) {
      const [merchant] = await db
        .insert(merchantsTable)
        .values({
          name: target.name || target.email,
          city: "Barinas",
          isVisible: true,
        })
        .returning();
      merchantId = merchant.id;
    }

    const [updated] = await db
      .update(usersTable)
      .set({
        role: body.role,
        merchantId: body.role === "merchant" ? merchantId : null,
      })
      .where(eq(usersTable.id, target.id))
      .returning();

    // =========================================================================
    // INVALIDACIÓN INMEDIATA DE CACHÉ (Zero-Latency Privilege Propagation)
    // En el mismo instante en que se actualiza la BD, purgamos la caché en memoria
    // de este userId específico y sincronizamos sus nuevos permisos con Clerk.
    // El siguiente request del usuario reflejará su nuevo rol al instante.
    // =========================================================================
    await invalidateUserCache(target.id, {
      role: body.role,
      merchantId: body.role === "merchant" ? merchantId : null,
    });
    if (String(req.params.userId) !== target.id) {
      await invalidateUserCache(String(req.params.userId));
    }

    res.json(publicUser(updated));
  } catch (error) {
    next(error);
  }
});

// ==========================================
// Merchant Profile Management
// ==========================================

router.get("/merchant/profile", requireAuth, async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (!user || user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Solo los comerciantes tienen un perfil comercial asignado." });
      return;
    }

    const [merchant] = await db
      .select()
      .from(merchantsTable)
      .where(eq(merchantsTable.id, user.merchantId))
      .limit(1);

    if (!merchant) {
      res.status(404).json({ error: "Perfil de tienda no encontrado." });
      return;
    }

    res.json(merchant);
  } catch (error) {
    next(error);
  }
});

router.patch("/merchant/profile", requireAuth, async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (!user || user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Solo los comerciantes pueden actualizar su perfil comercial." });
      return;
    }

    const { businessName, rif, contactPhone, address, businessHours, hasDelivery } = req.body;

    const [updated] = await db
      .update(merchantsTable)
      .set({
        businessName: businessName !== undefined ? String(businessName).trim() : undefined,
        rif: rif !== undefined ? String(rif).trim().toUpperCase() : undefined,
        contactPhone: contactPhone !== undefined ? String(contactPhone).trim() : undefined,
        address: address !== undefined ? String(address).trim() : undefined,
        businessHours: businessHours !== undefined ? String(businessHours).trim() : undefined,
        hasDelivery: hasDelivery !== undefined ? Boolean(hasDelivery) : undefined,
      })
      .where(eq(merchantsTable.id, user.merchantId))
      .returning();

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// Executive Dashboard Analytics (Admin & Merchant)
// ==========================================

router.get("/admin/analytics", requireAuth, async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (user?.role !== "admin" && user?.role !== "merchant") {
      res.status(403).json({ error: "Acceso denegado: solo administradores y comerciantes tienen acceso a analíticas." });
      return;
    }

    const isMerchantUser = user.role === "merchant" && !isMaster(user);
    const merchantId = user.merchantId;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const paidStatuses = ["paid", "preparing", "ready", "shipped", "delivered"];

    // 1. Counts
    const [customersCount, merchantsCount] = await Promise.all([
      db.select({ value: count() }).from(usersTable).where(eq(usersTable.role, "customer")),
      db.select({ value: count() }).from(merchantsTable).where(eq(merchantsTable.isVisible, true)),
    ]);

    // 2. Orders and Revenue
    const allPaidOrders = await db
      .select({
        id: ordersTable.id,
        totalUsd: ordersTable.totalUsd,
        totalBs: ordersTable.totalBs,
        deliveryCity: ordersTable.deliveryCity,
        pickupNotes: ordersTable.pickupNotes,
        status: ordersTable.status,
        createdAt: ordersTable.createdAt,
      })
      .from(ordersTable)
      .where(inArray(ordersTable.status, paidStatuses));

    let relevantOrders = allPaidOrders;
    if (isMerchantUser && merchantId) {
      const merchantItems = await db
        .select({ orderId: orderItemsTable.orderId })
        .from(orderItemsTable)
        .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
        .where(eq(productsTable.merchantId, merchantId));
      const mOrderIds = new Set(merchantItems.map((i) => i.orderId));
      relevantOrders = allPaidOrders.filter((o) => mOrderIds.has(o.id));
    }

    const revenue = {
      today: { usd: 0, bs: 0 },
      week: { usd: 0, bs: 0 },
      fortnight: { usd: 0, bs: 0 },
      month: { usd: 0, bs: 0 },
    };

    let deliveryCount = 0;
    let pickupCount = 0;

    for (const order of relevantOrders) {
      const orderDate = new Date(order.createdAt);
      const usdVal = Number(order.totalUsd);
      const bsVal = Number(order.totalBs);

      const isPickup =
        (order.deliveryCity && order.deliveryCity.toLowerCase().includes("retiro")) ||
        Boolean(order.pickupNotes);
      if (isPickup) {
        pickupCount++;
      } else {
        deliveryCount++;
      }

      if (orderDate >= startOfToday) {
        revenue.today.usd += usdVal;
        revenue.today.bs += bsVal;
      }
      if (orderDate >= sevenDaysAgo) {
        revenue.week.usd += usdVal;
        revenue.week.bs += bsVal;
      }
      if (orderDate >= fifteenDaysAgo) {
        revenue.fortnight.usd += usdVal;
        revenue.fortnight.bs += bsVal;
      }
      if (orderDate >= thirtyDaysAgo) {
        revenue.month.usd += usdVal;
        revenue.month.bs += bsVal;
      }
    }

    revenue.today.usd = Math.round(revenue.today.usd * 100) / 100;
    revenue.today.bs = Math.round(revenue.today.bs * 100) / 100;
    revenue.week.usd = Math.round(revenue.week.usd * 100) / 100;
    revenue.week.bs = Math.round(revenue.week.bs * 100) / 100;
    revenue.fortnight.usd = Math.round(revenue.fortnight.usd * 100) / 100;
    revenue.fortnight.bs = Math.round(revenue.fortnight.bs * 100) / 100;
    revenue.month.usd = Math.round(revenue.month.usd * 100) / 100;
    revenue.month.bs = Math.round(revenue.month.bs * 100) / 100;

    const totalOrdersCount = deliveryCount + pickupCount;
    const deliveryPercentage =
      totalOrdersCount > 0 ? Math.round((deliveryCount / totalOrdersCount) * 100) : 0;
    const pickupPercentage = totalOrdersCount > 0 ? 100 - deliveryPercentage : 0;

    // 3. Top 10 Most Sold and Top 10 Least Sold products
    const productFilters = isMerchantUser && merchantId ? [eq(productsTable.merchantId, merchantId)] : [];
    const allProducts = await db
      .select({
        id: productsTable.id,
        name: productsTable.name,
        sku: productsTable.sku,
        category: productsTable.category,
        priceUsd: productsTable.priceUsd,
        stock: productsTable.stock,
        imageUrl: productsTable.imageUrl,
      })
      .from(productsTable)
      .where(and(eq(productsTable.isVisible, true), ...productFilters));

    const orderItemsSold = await db
      .select({
        productId: orderItemsTable.productId,
        quantity: orderItemsTable.quantity,
        subtotalUsd: orderItemsTable.subtotalUsd,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(inArray(ordersTable.status, paidStatuses));

    const salesByProduct = new Map<string, { totalSold: number; totalRevenueUsd: number }>();
    for (const item of orderItemsSold) {
      const prev = salesByProduct.get(item.productId) || { totalSold: 0, totalRevenueUsd: 0 };
      prev.totalSold += item.quantity;
      prev.totalRevenueUsd += Number(item.subtotalUsd);
      salesByProduct.set(item.productId, prev);
    }

    const productsWithSales = allProducts.map((p) => {
      const sales = salesByProduct.get(p.id) || { totalSold: 0, totalRevenueUsd: 0 };
      return {
        ...p,
        priceUsd: Number(p.priceUsd),
        totalSold: sales.totalSold,
        totalRevenueUsd: Math.round(sales.totalRevenueUsd * 100) / 100,
      };
    });

    const topSoldProducts = [...productsWithSales]
      .sort((a, b) => b.totalSold - a.totalSold)
      .slice(0, 10);

    const leastSoldProducts = [...productsWithSales]
      .sort((a, b) => a.totalSold - b.totalSold)
      .slice(0, 10);

    res.json({
      revenue,
      totalCustomers: isMerchantUser ? 0 : Number(customersCount[0]?.value ?? 0),
      totalMerchants: isMerchantUser ? 0 : Number(merchantsCount[0]?.value ?? 0),
      totalOrders: totalOrdersCount,
      deliveryPercentage,
      pickupPercentage,
      topSoldProducts,
      leastSoldProducts,
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// Merchants Directory List (for Admin assigning sales)
// ==========================================

router.get("/merchants", requireAuth, async (req, res, next) => {
  try {
    const merchants = await db
      .select({
        id: merchantsTable.id,
        name: merchantsTable.name,
        businessName: merchantsTable.businessName,
        city: merchantsTable.city,
      })
      .from(merchantsTable)
      .where(eq(merchantsTable.isVisible, true))
      .orderBy(merchantsTable.name);

    res.json(merchants);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// Part Requests (Solicitudes de Repuestos)
// ==========================================

router.post("/part-requests", async (req, res, next) => {
  try {
    const { customerName, contactPhone, partDescription, motorcycleModel } = req.body;
    if (!customerName || !contactPhone || !partDescription || !motorcycleModel) {
      res.status(400).json({
        error: "Todos los campos son obligatorios: Nombre, Teléfono/WhatsApp, Modelo de moto y Repuesto solicitado.",
      });
      return;
    }

    const [created] = await db
      .insert(partRequestsTable)
      .values({
        customerName: String(customerName).trim(),
        contactPhone: String(contactPhone).trim(),
        partDescription: String(partDescription).trim(),
        motorcycleModel: String(motorcycleModel).trim(),
        status: "pending",
      })
      .returning();

    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

router.get("/part-requests", requireAuth, async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (user?.role !== "admin" && user?.role !== "merchant") {
      res.status(403).json({ error: "Acceso denegado a solicitudes de repuestos." });
      return;
    }

    const statusFilter = req.query.status ? String(req.query.status) : null;
    const filters = statusFilter ? [eq(partRequestsTable.status, statusFilter)] : [];

    const requests = await db
      .select()
      .from(partRequestsTable)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(partRequestsTable.createdAt));

    // PRIVACY & MULTITENANCY ISOLATION:
    // Merchants MUST NOT see customer phone numbers or customer personal contacts.
    // They only see the requested spare part details to communicate via Admin WhatsApp.
    if (user.role === "merchant" && !isMaster(user)) {
      const sanitized = requests.map((r) => ({
        id: r.id,
        partDescription: r.partDescription,
        motorcycleModel: r.motorcycleModel,
        status: r.status,
        createdAt: r.createdAt,
        customerName: "Cliente Ruta 44",
        contactPhone: "[Oculto - Vía Admin]",
        assignedMerchantId: r.assignedMerchantId,
        saleAmountUsd: r.assignedMerchantId === user.merchantId ? r.saleAmountUsd : null,
      }));
      res.json(sanitized);
      return;
    }

    // Admin view: enrich with merchant business name if already assigned
    const assignedIds = Array.from(
      new Set(requests.map((r) => r.assignedMerchantId).filter(Boolean))
    ) as string[];

    let merchantMap = new Map<string, string>();
    if (assignedIds.length > 0) {
      const merchants = await db
        .select({ id: merchantsTable.id, name: merchantsTable.name, businessName: merchantsTable.businessName })
        .from(merchantsTable)
        .where(inArray(merchantsTable.id, assignedIds));
      for (const m of merchants) {
        merchantMap.set(m.id, m.businessName || m.name);
      }
    }

    const enriched = requests.map((r) => ({
      ...r,
      merchantName: r.assignedMerchantId ? merchantMap.get(r.assignedMerchantId) || null : null,
    }));

    res.json(enriched);
  } catch (error) {
    next(error);
  }
});

router.patch("/part-requests/:requestId", requireAuth, async (req, res, next) => {
  try {
    const user = (req as RequestWithUser).user;
    if (user?.role !== "admin" && user?.role !== "merchant") {
      res.status(403).json({ error: "Acceso denegado para actualizar solicitudes." });
      return;
    }

    const { requestId } = req.params;
    const { status, merchantId, saleAmountUsd } = req.body;
    if (!["pending", "contacted", "resolved"].includes(status)) {
      res.status(400).json({ error: "Estado inválido. Opciones válidas: pending, contacted, resolved." });
      return;
    }

    // Only Admin Master can attribute sales or resolve directly
    if (user.role === "merchant" && !isMaster(user)) {
      res.status(403).json({
        error: "Los comerciantes deben coordinar la resolución y cotización del repuesto directamente por WhatsApp con el Administrador.",
      });
      return;
    }

    const [existingRequest] = await db
      .select()
      .from(partRequestsTable)
      .where(eq(partRequestsTable.id, String(requestId)))
      .limit(1);

    if (!existingRequest) {
      res.status(404).json({ error: "Solicitud no encontrada." });
      return;
    }

    // When Admin marks request as resolved and attributes it to a merchant:
    // Automatically creates an ad-hoc product and a delivered order for that merchant,
    // so it counts towards the merchant's sales metrics as a direct web sale.
    let createdOrderId: string | null = null;
    if (status === "resolved" && merchantId && Number(saleAmountUsd) > 0) {
      const parsedUsd = Math.round(Number(saleAmountUsd) * 100) / 100;

      const [todayRate] = await db
        .select()
        .from(exchangeRatesTable)
        .where(eq(exchangeRatesTable.effectiveDate, today()))
        .limit(1);
      const rateVal = todayRate ? Number(todayRate.rate) : 50;
      const totalBs = Math.round(parsedUsd * rateVal * 100) / 100;

      const [merchant] = await db
        .select()
        .from(merchantsTable)
        .where(eq(merchantsTable.id, String(merchantId)))
        .limit(1);

      const merchantLabel = merchant?.businessName || merchant?.name || "Comercio Aliado";

      // Ad-hoc product for the merchant
      const [directProduct] = await db
        .insert(productsTable)
        .values({
          merchantId: String(merchantId),
          name: existingRequest.partDescription,
          sku: `SOL-${existingRequest.id.slice(0, 6).toUpperCase()}`,
          category: "Solicitud de Repuesto",
          description: `Venta directa de repuesto para ${existingRequest.motorcycleModel}`,
          priceUsd: parsedUsd,
          stock: 0,
          imageUrl: null,
          isVisible: false,
          condition: "new",
        })
        .returning();

      // Delivered direct order
      const [directOrder] = await db
        .insert(ordersTable)
        .values({
          customerName: existingRequest.customerName,
          customerPhone: existingRequest.contactPhone,
          status: "delivered",
          totalUsd: parsedUsd,
          totalBs: totalBs,
          exchangeRate: rateVal,
          deliveryCity: merchant?.city || "Barinas",
          pickupNotes: `Venta directa por solicitud de repuesto atendida por ${merchantLabel}`,
        })
        .returning();

      createdOrderId = directOrder.id;

      // Order item
      await db.insert(orderItemsTable).values({
        orderId: directOrder.id,
        productId: directProduct.id,
        productName: existingRequest.partDescription,
        quantity: 1,
        unitPriceUsd: parsedUsd,
        subtotalUsd: parsedUsd,
      });
    }

    const updateData: any = { status };
    if (merchantId) updateData.assignedMerchantId = String(merchantId);
    if (saleAmountUsd !== undefined && Number(saleAmountUsd) > 0) {
      updateData.saleAmountUsd = Number(saleAmountUsd);
    }

    const [updated] = await db
      .update(partRequestsTable)
      .set(updateData)
      .where(eq(partRequestsTable.id, String(requestId)))
      .returning();

    res.json({
      ...updated,
      createdOrderId,
    });
  } catch (error) {
    next(error);
  }
});

export default router;