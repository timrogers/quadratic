import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { IssuedToken } from "@prisma/client";
import { prisma } from "../db";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      issuedToken?: IssuedToken;
    }
  }
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function requireRepositoryToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    res
      .status(401)
      .set("WWW-Authenticate", 'Bearer realm="quadratic"')
      .json({ error: "missing_bearer_token" });
    return;
  }

  const token = auth.slice("bearer ".length).trim();
  if (!token) {
    res.status(401).json({ error: "missing_bearer_token" });
    return;
  }

  const issued = await prisma.issuedToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (!issued || issued.revokedAt || issued.expiresAt.getTime() <= Date.now()) {
    res
      .status(401)
      .set(
        "WWW-Authenticate",
        'Bearer realm="quadratic", error="invalid_token"',
      )
      .json({ error: "invalid_token" });
    return;
  }

  req.issuedToken = issued;
  next();
}
