import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
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
    appSlug: required("GITHUB_APP_SLUG"),
  },
  session: {
    secret: required("SESSION_SECRET"),
  },
};
