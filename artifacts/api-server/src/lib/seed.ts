import { count, eq, sql } from "drizzle-orm";
import {
  db,
  deliveryLocationsTable,
  exchangeRatesTable,
  merchantsTable,
  paymentReceiverSettingsTable,
  productsTable,
  usersTable,
} from "@workspace/db";

const today = () => new Date().toISOString().slice(0, 10);
const masterEmail = "alexaelperdomo2410@gmail.com";
// Password hygiene: strictly read credentials from environment variables without hardcoded fallbacks
const masterInitialPassword = process.env.MASTER_INITIAL_PASSWORD || "";

export async function ensureMarketplaceSeed() {
  try {
    await db.execute(sql`
      ALTER TABLE "part_requests" ADD COLUMN IF NOT EXISTS "assigned_merchant_id" text;
      ALTER TABLE "part_requests" ADD COLUMN IF NOT EXISTS "sale_amount_usd" numeric(14, 2);
    `);
  } catch (err) {
    // Non-fatal if table doesn't exist yet or columns already exist
    console.warn("Notice: part_requests migration check:", err);
  }

  const [master] = await db.select().from(usersTable).where(eq(usersTable.email, masterEmail)).limit(1);
  if (!master) {
    await db.insert(usersTable).values({
      id: `master-seed:${masterEmail}`,
      email: masterEmail,
      name: "Admin Master",
      role: "admin",
      isMaster: true,
    });
  } else if (master.role !== "admin" || !master.isMaster) {
    await db.update(usersTable).set({ role: "admin", isMaster: true, name: "Admin Master" })
      .where(eq(usersTable.email, masterEmail));
  }

  const [merchantCount] = await db.select({ value: count() }).from(merchantsTable);
  if (Number(merchantCount?.value ?? 0) === 0) {
    const [merchant] = await db.insert(merchantsTable).values({
      name: "Autopartes Caracas",
      city: "Caracas",
      isVisible: true,
    }).returning();
    await db.insert(productsTable).values([
      {
        merchantId: merchant.id,
        name: "Kit de pastillas de freno delantero",
        sku: "BRK-2048",
        category: "Frenos",
        description: "Juego cerámico de alta duración para uso urbano.",
        priceUsd: 42,
        stock: 12,
        imageUrl: null,
        isVisible: true,
        condition: "new",
      },
      {
        merchantId: merchant.id,
        name: "Filtro de aceite premium",
        sku: "FIL-1170",
        category: "Mantenimiento",
        description: "Filtro de aceite con sello reforzado y mayor capacidad.",
        priceUsd: 8.5,
        stock: 31,
        imageUrl: null,
        isVisible: true,
        condition: "new",
      },
      {
        merchantId: merchant.id,
        name: "Batería 12V 700 CCA",
        sku: "BAT-700C",
        category: "Eléctrico",
        description: "Batería sellada para arranque confiable en cualquier clima.",
        priceUsd: 96,
        stock: 6,
        imageUrl: null,
        isVisible: true,
        condition: "new",
      },
    ]);
  }
  const [rate] = await db.select().from(exchangeRatesTable)
    .where(eq(exchangeRatesTable.effectiveDate, today())).limit(1);
  if (!rate) {
    await db.insert(exchangeRatesTable).values({
      value: 145.25,
      currency: "USD",
      effectiveDate: today(),
      updatedBy: null,
    });
  }

  const [receiver] = await db.select().from(paymentReceiverSettingsTable).where(eq(paymentReceiverSettingsTable.isActive, true)).limit(1);
  if (!receiver) {
    await db.insert(paymentReceiverSettingsTable).values({
      bank: "Configurar en Ajustes",
      phone: "Por configurar",
      identityNumber: "Por configurar",
      isActive: true,
    });
  }

  const [barinas] = await db.select().from(deliveryLocationsTable)
    .where(eq(deliveryLocationsTable.city, "Barinas")).limit(1);
  if (!barinas) {
    await db.insert(deliveryLocationsTable).values({
      state: "Barinas",
      city: "Barinas",
      isEnabled: true,
    });
  }
}