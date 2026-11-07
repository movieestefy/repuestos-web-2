import { Router, type IRouter, type RequestHandler, type Request } from "express";
import { getAuth, createClerkClient } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";

export const MASTER_EMAIL = "alexaelperdomo2410@gmail.com";

// In-memory cache for Clerk user details with 5-minute TTL to reduce API rate limits and latency
interface CachedClerkUser {
  email: string;
  name: string;
  cachedAt: number;
}

const CLERK_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL
const clerkUserCache = new Map<string, CachedClerkUser>();

// In-memory cache for resolved database users to avoid redundant DB queries per request
interface CachedResolvedUser {
  user: typeof usersTable.$inferSelect;
  cachedAt: number;
}

const RESOLVED_USER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL
const resolvedUserCache = new Map<string, CachedResolvedUser>();

const DEFAULT_CLERK_SECRET_KEY = "sk_test_ISfR1sQtUfPBhoqg4THFjG4ZebQfMfoOPYOR4xbVe7";
const clerkSecretKey = process.env.CLERK_SECRET_KEY || DEFAULT_CLERK_SECRET_KEY;
export const clerk = createClerkClient({ secretKey: clerkSecretKey });

/**
 * Purgado e invalidación inmediata de caché de usuario (Zero-Latency Privilege Propagation).
 * Elimina las entradas en caché de Clerk y de la base de datos para el userId especificado.
 * Opcionalmente sincroniza los metadatos públicos en la API de Clerk si hay credenciales configuradas.
 * 
 * Debe invocarse inmediatamente al cambiar roles o permisos (ej. en PATCH /admin/users/:userId/role).
 */
export async function invalidateUserCache(
  userId: string,
  clerkMetadata?: { role?: string; merchantId?: string | null }
): Promise<void> {
  // 1. Invalidar caché en memoria de Clerk
  clerkUserCache.delete(userId);

  // 2. Invalidar caché en memoria del usuario resuelto (por id y claves relacionadas)
  resolvedUserCache.delete(userId);
  for (const [key, cached] of resolvedUserCache.entries()) {
    if (cached.user.id === userId || cached.user.email === userId) {
      resolvedUserCache.delete(key);
    }
  }

  // 3. Sincronizar metadatos públicos en Clerk si se suministran y la clave está disponible
  if (clerkMetadata && process.env.CLERK_SECRET_KEY) {
    try {
      await clerk.users.updateUserMetadata(userId, {
        publicMetadata: clerkMetadata,
      });
    } catch (err) {
      console.warn(`[auth] Aviso: no se pudieron sincronizar metadatos con Clerk para ${userId}:`, err);
    }
  }
}

/**
 * Retrieves user profile (email and full name) from Clerk API with in-memory caching.
 * Resolves the issue where default Clerk JWT session claims do not include the email address.
 */
async function getClerkUserData(
  userId: string,
  claims?: { email?: string; name?: string }
): Promise<{ email: string; name: string }> {
  const cached = clerkUserCache.get(userId);
  const now = Date.now();
  if (cached && now - cached.cachedAt < CLERK_CACHE_TTL_MS) {
    return { email: cached.email, name: cached.name };
  }

  try {
    const clerkUser = await clerk.users.getUser(userId);

    // 1. Extract email from user's primary email addresses list
    const email =
      clerkUser.emailAddresses?.[0]?.emailAddress ??
      claims?.email ??
      "cliente@repuestos.local";

    // 2. Extract full name from firstName + lastName, or fallback to username
    const firstName = clerkUser.firstName?.trim() ?? "";
    const lastName = clerkUser.lastName?.trim() ?? "";
    const fullName = [firstName, lastName].filter(Boolean).join(" ");
    const name =
      fullName ||
      clerkUser.username ||
      claims?.name ||
      "Cliente";

    const userData: CachedClerkUser = { email, name, cachedAt: now };
    clerkUserCache.set(userId, userData);
    return { email, name };
  } catch (error) {
    console.error(`[auth] Error fetching Clerk user ${userId}:`, error);
    if (cached) {
      return { email: cached.email, name: cached.name };
    }
    const fallbackEmail = claims?.email ?? "cliente@repuestos.local";
    const fallbackName = claims?.name ?? "Cliente";
    return { email: fallbackEmail, name: fallbackName };
  }
}

/**
 * Resolves or syncs the authenticated Clerk user to the local PostgreSQL database.
 * Assigns master admin permissions when the email matches MASTER_EMAIL.
 */
async function resolveUser(auth: ReturnType<typeof getAuth>) {
  const userId = auth?.userId;
  if (!userId) return null;

  const now = Date.now();
  const cached = resolvedUserCache.get(userId);
  if (cached && now - cached.cachedAt < RESOLVED_USER_CACHE_TTL_MS) {
    return cached.user;
  }

  const claims = auth.sessionClaims as { email?: string; name?: string } | undefined;
  const { email, name } = await getClerkUserData(userId, claims);

  const isMasterUser = email.toLowerCase() === MASTER_EMAIL.toLowerCase();

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(or(eq(usersTable.id, userId), eq(usersTable.email, email)))
    .limit(1);

  if (existing) {
    // If the master user logged in with a different Clerk ID, migrate their record
    if (existing.id !== userId && isMasterUser) {
      const [migrated] = await db
        .update(usersTable)
        .set({
          id: userId,
          name,
          email,
          role: "admin",
          isMaster: true,
        })
        .where(eq(usersTable.id, existing.id))
        .returning();
      resolvedUserCache.set(userId, { user: migrated, cachedAt: now });
      return migrated;
    }

    // Ensure master user always holds the admin role and isMaster flag
    if (isMasterUser && (!existing.isMaster || existing.role !== "admin")) {
      const [promoted] = await db
        .update(usersTable)
        .set({
          role: "admin",
          isMaster: true,
          email,
          name: name || existing.name,
        })
        .where(eq(usersTable.id, existing.id))
        .returning();
      resolvedUserCache.set(userId, { user: promoted, cachedAt: now });
      return promoted;
    }

    // Sync real email and name if placeholder was previously stored
    if (existing.email === "cliente@repuestos.local" && email !== "cliente@repuestos.local") {
      const [synced] = await db
        .update(usersTable)
        .set({
          email,
          name: name || existing.name,
        })
        .where(eq(usersTable.id, existing.id))
        .returning();
      resolvedUserCache.set(userId, { user: synced, cachedAt: now });
      return synced;
    }

    resolvedUserCache.set(userId, { user: existing, cachedAt: now });
    return existing;
  }

  // Register newly authenticated user
  const [created] = await db
    .insert(usersTable)
    .values({
      id: userId,
      email,
      name,
      role: isMasterUser ? "admin" : "customer",
      isMaster: isMasterUser,
    })
    .returning();

  resolvedUserCache.set(userId, { user: created, cachedAt: now });
  return created;
}

function safeGetAuth(req: Request) {
  try {
    return getAuth(req);
  } catch {
    return (req as any).auth || null;
  }
}

export const optionalUser: RequestHandler = async (req, _res, next) => {
  const auth = safeGetAuth(req);
  try {
    (req as RequestWithUser).user = await resolveUser(auth);
    next();
  } catch (error) {
    next(error);
  }
};

export const requireAuth: RequestHandler = async (req, res, next) => {
  const auth = safeGetAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Debes iniciar sesión para continuar." });
    return;
  }
  try {
    const user = await resolveUser(auth);
    (req as RequestWithUser).user = user;
    next();
  } catch (error) {
    next(error);
  }
};

export type RequestWithUser = Request & {
  user?: typeof usersTable.$inferSelect | null;
};

const router: IRouter = Router();

router.get("/auth/me", optionalUser, (req, res) => {
  const user = (req as RequestWithUser).user;
  if (!user) {
    res.json(null);
    return;
  }
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isMaster: user.isMaster,
    merchantId: user.merchantId,
  });
});

export default router;