import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://user:password@localhost:5432/quadratic?schema=public";

const adapter = new PrismaPg({ connectionString });
export const prisma = new PrismaClient({ adapter });
