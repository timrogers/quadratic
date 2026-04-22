import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// GitHub App slugs are lowercase alphanumeric with hyphens, 1–39 chars
const GITHUB_APP_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;

function requiredAppSlug(name: string): string {
  const value = required(name);
  if (!GITHUB_APP_SLUG_RE.test(value)) {
    throw new Error(
      `${name} must be a valid GitHub App slug (lowercase alphanumeric and hyphens)`,
    );
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  baseUrl: required("BASE_URL"),
  databaseUrl: required("DATABASE_URL"),
  github: {
    appId: required("GITHUB_APP_ID"),
    privateKey: required("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n"),
    webhookSecret: required("GITHUB_APP_WEBHOOK_SECRET"),
    clientId: required("GITHUB_CLIENT_ID"),
    clientSecret: required("GITHUB_CLIENT_SECRET"),
    appSlug: requiredAppSlug("GITHUB_APP_SLUG"),
  },
  session: {
    secret: required("SESSION_SECRET"),
  },
  oidc: {
    // The OIDC issuer that signs the incoming JWTs (e.g. GitHub Actions OIDC).
    issuer: process.env.OIDC_ISSUER || "https://token.actions.githubusercontent.com",
    // The audience this service expects in incoming OIDC JWTs.
    audience: required("OIDC_AUDIENCE"),
    // Lifetime of issued access tokens in seconds.
    tokenLifetimeSeconds: parseInt(process.env.OIDC_TOKEN_LIFETIME_SECONDS || "3600", 10),
  },
};
