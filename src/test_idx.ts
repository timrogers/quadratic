import express from "express";
import session from "express-session";
import crypto from "crypto";
import path from "path";
import rateLimit from "express-rate-limit";
import { config } from "./config";
import { log } from "./logger";
import { requestLogger } from "./middleware/requestLogger";
import authRoutes from "./routes/auth";
import webhookRoutes from "./routes/webhook";
import repositoryRoutes from "./routes/repositories";
import issueRoutes from "./routes/issues";
import oauthRoutes from "./routes/oauth";
import apiIssueRoutes from "./routes/apiIssues";

const app = express();
app.use(requestLogger);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({ secret: config.session.secret, resave: false, saveUninitialized: false }));
app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.path.startsWith("/webhooks/")) return next();
  if (req.path.startsWith("/oauth/")) return next();
  if (req.path.startsWith("/api/")) return next();
  next();
});

const webhookLimiter = rateLimit({ windowMs: 60000, max: 120, standardHeaders: true, legacyHeaders: false });

app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/auth", authRoutes);
app.use("/webhooks/github", webhookLimiter, webhookRoutes);
app.use("/repositories", repositoryRoutes);
app.use("/issues", issueRoutes);
app.use("/oauth", oauthRoutes);
app.use("/api/issues", apiIssueRoutes);

const t0 = Date.now();
const s = app.listen(0, () => log.info("started", { port: (s.address() as any)?.port }));
process.on('beforeExit', () => console.log('BEFORE EXIT at', Date.now()-t0, 'ms listening:', s.listening));

app.get("/csrf-token", (req, res) => { res.json({csrfToken: "x"}); });
app.get("/health", (_req, res) => { res.json({status: "ok"}); });
export default app;
