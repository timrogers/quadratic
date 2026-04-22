import express from "express";
import session from "express-session";
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
    },
  }),
);

// Routes
app.use("/auth", authRoutes);
app.use("/webhooks/github", webhookRoutes);
app.use("/repositories", repositoryRoutes);
app.use("/issues", issueRoutes);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});

export default app;
