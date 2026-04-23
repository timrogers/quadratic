import express from "express";
import session from "express-session";
import crypto from "crypto";
import path from "path";
import rateLimit from "express-rate-limit";
import { config } from "./config";
import { log } from "./logger";
import { requestLogger } from "./middleware/requestLogger";
import authRoutes from "./routes/auth";
import sessionRoutes from "./routes/session";
import webhookRoutes from "./routes/webhook";
import repositoryRoutes from "./routes/repositories";
import issueRoutes from "./routes/issues";
import oauthRoutes, { SUPPORTED_GRANT_TYPES } from "./routes/oauth";
import apiIssueRoutes from "./routes/apiIssues";
import mcpRoutes from "./routes/mcp";

const app = express();

// In production we run behind a TLS-terminating reverse proxy. Trust the
// first proxy hop so that `req.secure` reflects the original scheme and
// `express-session` will issue the `Set-Cookie` header for our `secure: true`
// session cookie.
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// Log every incoming HTTP request (must be first so all downstream
// middleware/handlers run inside the request-scoped log context).
app.use(requestLogger);

// Parse JSON bodies
app.use(express.json());
// RFC 8693 / RFC 7009 expect application/x-www-form-urlencoded.
app.use(express.urlencoded({ extended: false }));

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
  // OAuth/OIDC endpoints are authenticated by the JWT (token exchange) or
  // by the token itself (revocation), not by session, so skip CSRF.
  if (req.path.startsWith("/oauth/")) {
    return next();
  }
  // Bearer-token-authenticated external API doesn't use sessions or CSRF.
  if (req.path.startsWith("/api/external/")) {
    return next();
  }
  // MCP endpoint is bearer-token authenticated; no CSRF needed.
  if (req.path === "/mcp" || req.path.startsWith("/mcp/")) {
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

// Serve the static frontend
app.use(express.static(path.join(__dirname, "..", "public")));

// Routes
app.use("/auth", authRoutes);
app.use("/api", sessionRoutes);
app.use("/webhooks/github", webhookLimiter, webhookRoutes);
app.use("/api/repositories", repositoryRoutes);
app.use("/api/issues", issueRoutes);
app.use("/oauth", oauthRoutes);
app.use("/api/external/issues", apiIssueRoutes);
app.use("/mcp", mcpRoutes);

// CSRF token endpoint – clients call this to get a token for state-changing requests
app.get("/api/csrf-token", (req, res) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  res.json({ csrfToken: req.session.csrfToken });
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// RFC 8414 OAuth 2.0 Authorization Server Metadata. We expose this both at
// the canonical path and at `/<resource>` suffixes (per RFC 8414 §3.1) so
// that MCP clients which derive the discovery URL from the protected
// resource path (e.g. `/.well-known/oauth-authorization-server/mcp`) can
// also discover us. Only the token-exchange / jwt-bearer flows are
// supported — there is no interactive authorization endpoint because the
// caller already holds a verifiable OIDC JWT (typically from GitHub
// Actions OIDC).
function authorizationServerMetadata() {
  const issuer = config.baseUrl.replace(/\/$/, "");
  return {
    issuer,
    token_endpoint: `${issuer}/oauth/token`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    grant_types_supported: SUPPORTED_GRANT_TYPES,
    response_types_supported: [],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    subject_token_types_supported: ["urn:ietf:params:oauth:token-type:jwt"],
  };
}

app.get(
  /^\/\.well-known\/oauth-authorization-server(\/.*)?$/,
  (_req, res) => {
    res
      .status(200)
      .set("Cache-Control", "public, max-age=300")
      .json(authorizationServerMetadata());
  },
);

// SPA fallback: serve index.html for client-side routes (e.g. /issues/:id).
// Any non-API, non-auth, non-webhook GET that doesn't match a static file
// falls through to the SPA so client-side routing can take over.
app.get(/^\/(?!api\/|auth\/|oauth\/|webhooks\/|mcp(\/|$)|\.well-known\/|health$).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(config.port, () => {
  log.info("server.started", { port: config.port });
});

export default app;
