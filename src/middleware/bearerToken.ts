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
  const tag = `[bearerAuth] ${req.method} ${req.originalUrl}`;
  const auth = req.headers.authorization;

  if (!auth) {
    console.warn(`${tag} reject: no Authorization header present`);
    res
      .status(401)
      .set("WWW-Authenticate", 'Bearer realm="quadratic"')
      .json({ error: "missing_bearer_token" });
    return;
  }

  if (!auth.toLowerCase().startsWith("bearer ")) {
    const scheme = auth.split(/\s+/, 1)[0] ?? "";
    console.warn(
      `${tag} reject: Authorization header present but scheme is "${scheme}", expected "Bearer"`,
    );
    res
      .status(401)
      .set("WWW-Authenticate", 'Bearer realm="quadratic"')
      .json({ error: "missing_bearer_token" });
    return;
  }

  const token = auth.slice("bearer ".length).trim();
  if (!token) {
    console.warn(`${tag} reject: Bearer scheme present but token is empty`);
    res.status(401).json({ error: "missing_bearer_token" });
    return;
  }

  const tokenHash = hashToken(token);
  const tokenPreview = `${token.slice(0, 4)}…${token.slice(-4)} (len=${token.length})`;
  console.log(
    `${tag} attempting to validate token ${tokenPreview} hash=${tokenHash.slice(0, 12)}…`,
  );

  const issued = await prisma.issuedToken.findUnique({
    where: { tokenHash },
  });

  if (!issued) {
    console.warn(
      `${tag} reject: no IssuedToken row matches hash ${tokenHash.slice(0, 12)}… (token not found in DB)`,
    );
    res
      .status(401)
      .set(
        "WWW-Authenticate",
        'Bearer realm="quadratic", error="invalid_token"',
      )
      .json({ error: "invalid_token" });
    return;
  }

  const now = Date.now();
  if (issued.revokedAt) {
    console.warn(
      `${tag} reject: IssuedToken id=${issued.id} was revoked at ${issued.revokedAt.toISOString()} (actor=${issued.actor ?? "<none>"}, repositoryId=${issued.repositoryId})`,
    );
    res
      .status(401)
      .set(
        "WWW-Authenticate",
        'Bearer realm="quadratic", error="invalid_token"',
      )
      .json({ error: "invalid_token" });
    return;
  }

  if (issued.expiresAt.getTime() <= now) {
    const ageSec = Math.round((now - issued.expiresAt.getTime()) / 1000);
    console.warn(
      `${tag} reject: IssuedToken id=${issued.id} expired at ${issued.expiresAt.toISOString()} (${ageSec}s ago) (actor=${issued.actor ?? "<none>"}, repositoryId=${issued.repositoryId})`,
    );
    res
      .status(401)
      .set(
        "WWW-Authenticate",
        'Bearer realm="quadratic", error="invalid_token"',
      )
      .json({ error: "invalid_token" });
    return;
  }

  console.log(
    `${tag} accept: IssuedToken id=${issued.id} actor=${issued.actor ?? "<none>"} repositoryId=${issued.repositoryId} expiresAt=${issued.expiresAt.toISOString()}`,
  );

  req.issuedToken = issued;
  next();
}
