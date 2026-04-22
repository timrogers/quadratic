import express from "express";
import session from "express-session";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { config } from "./config";
import authRoutes from "./routes/auth";
import webhookRoutes from "./routes/webhook";
import repositoryRoutes from "./routes/repositories";
import issueRoutes from "./routes/issues";

const app = express();

// Parse JSON bodies
app.use(express.json());

// Session middleware
app.use(
  session({
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: "lax",
    },
  }),
);

// CSRF protection for state-changing requests (POST, PATCH, DELETE)
// Exempt the webhook endpoint since it uses signature verification instead
app.use((req, res, next) => {
  // Skip CSRF for safe methods and webhook endpoint
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }
  if (req.path.startsWith("/webhooks/")) {
    return next();
  }

  const csrfToken = req.headers["x-csrf-token"];
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  if (
    !csrfToken ||
    typeof csrfToken !== "string" ||
    csrfToken.length !== req.session.csrfToken.length ||
    !crypto.timingSafeEqual(
      Buffer.from(csrfToken),
      Buffer.from(req.session.csrfToken),
    )
  ) {
    res.status(403).json({ error: "Invalid or missing CSRF token" });
    return;
  }
  next();
});

// Rate limiting for webhook endpoint
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // limit each IP to 120 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
});

// Routes
app.use("/auth", authRoutes);
app.use("/webhooks/github", webhookLimiter, webhookRoutes);
app.use("/repositories", repositoryRoutes);
app.use("/issues", issueRoutes);

// CSRF token endpoint – clients call this to get a token for state-changing requests
app.get("/csrf-token", (req, res) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  res.json({ csrfToken: req.session.csrfToken });
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});

export default app;
