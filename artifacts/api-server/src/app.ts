import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { globalLimiter } from "./middlewares/rateLimiters";

const app: Express = express();

// Trust reverse proxies (Cloudflare, Load Balancers, Replit edge) to read real client IPs
app.set("trust proxy", 1);

// HTTP Security headers (X-Frame-Options, XSS, HSTS, Content-Type sniffing prevention)
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  })
);

// Gzip / Deflate compression for response payloads (speeds up JSON responses for high concurrency)
app.use(compression());

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:4173",
].filter(Boolean) as string[];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      try {
        const hostname = new URL(origin).hostname;
        if (
          allowedOrigins.includes(origin) ||
          hostname.endsWith(".vercel.app") ||
          hostname === "localhost" ||
          hostname === "127.0.0.1" ||
          process.env.NODE_ENV !== "production"
        ) {
          return callback(null, true);
        }
      } catch {
        // Fallback for non-standard origin URLs
      }
      return callback(null, origin);
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

const DEFAULT_CLERK_PUBLISHABLE_KEY = "pk_test_ZmFzdC1sYWItODQzNS5jbGVyay5hY2NvdW50cy5kZXYk";
const DEFAULT_CLERK_SECRET_KEY = "sk_test_ISfR1sQtUfPBhoqg4THFjG4ZebQfMfoOPYOR4xbVe7";

const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY || DEFAULT_CLERK_PUBLISHABLE_KEY;
const clerkSecretKey = process.env.CLERK_SECRET_KEY || DEFAULT_CLERK_SECRET_KEY;

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      clerkPublishableKey,
    ),
    secretKey: clerkSecretKey,
  })),
);

// Payload limit: Allow up to 10mb for receipts, images and CSV/Excel uploads
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Rate limiting: Global tier for all API endpoints
app.use("/api", globalLimiter);

app.use("/api", router);

export default app;
