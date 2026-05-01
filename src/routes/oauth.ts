import { Router, Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../db";
import { config } from "../config";
import { verifyOidcJwt, OidcVerificationError, GitHubOidcClaims, resolveActorLogin, resolveActorId } from "../oidc/verify";
import { hashToken } from "../middleware/bearerToken";
import { log } from "../logger";

const router = Router();

const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const JWT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:jwt";
const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";

export const SUPPORTED_GRANT_TYPES = [
  TOKEN_EXCHANGE_GRANT,
  JWT_BEARER_GRANT,
] as const;

interface TokenExchangeBody {
  grant_type?: string;
  // RFC 8693 token exchange uses `subject_token`; RFC 7523 jwt-bearer uses `assertion`.
  subject_token?: string;
  subject_token_type?: string;
  assertion?: string;
  audience?: string;
  resource?: string;
  scope?: string;
  requested_token_type?: string;
}

function tokenExchangeError(
  res: Response,
  status: number,
  error: string,
  description: string,
): void {
  log.warn("oidc.exchange.rejected", { status, error, description });
  res
    .status(status)
    .set("Cache-Control", "no-store")
    .set("Pragma", "no-cache")
    .json({ error, error_description: description });
}

function pickRepoIdentifier(
  body: TokenExchangeBody,
  claims: GitHubOidcClaims,
): { githubId?: number; fullName?: string } {
  // Prefer an explicit `resource` parameter from the client, otherwise fall
  // back to repository claims in the JWT.
  if (body.resource) {
    const resource = body.resource;
    // resource may be a repo full name like "owner/repo" or a numeric id.
    if (/^\d+$/.test(resource)) {
      return { githubId: parseInt(resource, 10) };
    }
    if (resource.includes("/")) {
      return { fullName: resource };
    }
  }

  const repoIdClaim = claims.repo_id ?? claims.repository_id;
  if (repoIdClaim && /^\d+$/.test(String(repoIdClaim))) {
    return { githubId: parseInt(String(repoIdClaim), 10) };
  }

  const ownerClaim = claims.owner ?? claims.repository_owner;
  const repoClaim = claims.repo ?? claims.repository;
  if (ownerClaim && repoClaim) {
    // `repo`/`repository` may itself be "owner/repo" — handle both.
    const fullName = repoClaim.includes("/") ? repoClaim : `${ownerClaim}/${repoClaim}`;
    return { fullName };
  }

  return {};
}

// RFC 8693 token exchange and RFC 7523 jwt-bearer endpoint.
router.post("/token", async (req: Request, res: Response) => {
  const body: TokenExchangeBody = req.body || {};

  log.info("oidc.exchange.received", {
    grant_type: body.grant_type,
    subject_token_type: body.subject_token_type,
    requested_token_type: body.requested_token_type,
    audience: body.audience,
    resource: body.resource,
    scope: body.scope,
    has_subject_token: !!body.subject_token,
    has_assertion: !!body.assertion,
    subject_token_length: body.subject_token?.length,
    assertion_length: body.assertion?.length,
  });

  log.debug("oidc.exchange.step", { step: "validate_parameters" });
  const isTokenExchange = body.grant_type === TOKEN_EXCHANGE_GRANT;
  const isJwtBearer = body.grant_type === JWT_BEARER_GRANT;
  if (!isTokenExchange && !isJwtBearer) {
    return tokenExchangeError(
      res,
      400,
      "unsupported_grant_type",
      `grant_type must be one of ${SUPPORTED_GRANT_TYPES.join(", ")}`,
    );
  }

  // RFC 8693 puts the JWT in `subject_token` (with `subject_token_type`).
  // RFC 7523 puts the JWT in `assertion`.
  const jwt = isTokenExchange ? body.subject_token : body.assertion;
  if (!jwt) {
    return tokenExchangeError(
      res,
      400,
      "invalid_request",
      isTokenExchange
        ? "subject_token is required"
        : "assertion is required",
    );
  }
  if (isTokenExchange && body.subject_token_type !== JWT_TOKEN_TYPE) {
    return tokenExchangeError(
      res,
      400,
      "invalid_request",
      `subject_token_type must be ${JWT_TOKEN_TYPE}`,
    );
  }
  if (
    body.requested_token_type &&
    body.requested_token_type !== ACCESS_TOKEN_TYPE
  ) {
    return tokenExchangeError(
      res,
      400,
      "invalid_request",
      `requested_token_type must be ${ACCESS_TOKEN_TYPE}`,
    );
  }

  log.debug("oidc.exchange.step", {
    step: "verify_subject_token",
    issuer: config.oidc.issuer,
    audience: config.oidc.audience,
    grant_type: body.grant_type,
  });
  let claims: GitHubOidcClaims;
  try {
    claims = await verifyOidcJwt(
      jwt,
      config.oidc.issuer,
      config.oidc.audience,
    );
  } catch (err) {
    if (err instanceof OidcVerificationError) {
      return tokenExchangeError(res, 401, err.code, err.message);
    }
    log.error("oidc.exchange.verify.unexpected_error", {
      message: err instanceof Error ? err.message : String(err),
    });
    return tokenExchangeError(res, 500, "server_error", "Failed to verify subject_token");
  }

  log.debug("oidc.exchange.step", { step: "resolve_repository" });
  const { githubId, fullName } = pickRepoIdentifier(body, claims);
  log.debug("oidc.exchange.repository.identifier", { githubId, fullName });
  if (!githubId && !fullName) {
    return tokenExchangeError(
      res,
      400,
      "invalid_target",
      "Unable to determine target repository from claims or `resource` parameter",
    );
  }

  const repository = await prisma.repository.findFirst({
    where: githubId ? { githubId } : { fullName: fullName! },
  });

  if (!repository) {
    return tokenExchangeError(
      res,
      400,
      "invalid_target",
      "Repository is not registered with this service",
    );
  }
  log.debug("oidc.exchange.repository.resolved", {
    repositoryId: repository.id,
    fullName: repository.fullName,
    githubId: repository.githubId,
  });

  log.debug("oidc.exchange.step", { step: "issue_access_token" });
  // Generate an opaque random access token. We never store the raw value;
  // only the SHA-256 hash is persisted.
  const accessToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(accessToken);
  const expiresIn = config.oidc.tokenLifetimeSeconds;
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  const scope = `issues:repository:${repository.id}`;

  const actorLogin = resolveActorLogin(claims);
  const actorId = resolveActorId(claims);

  const issued = await prisma.issuedToken.create({
    data: {
      tokenHash,
      scope,
      repositoryId: repository.id,
      agent: claims.agent ?? null,
      actor: actorLogin ?? null,
      actorId: actorId ?? null,
      subject: claims.sub,
      jti: claims.jti ?? null,
      expiresAt,
    },
  });

  log.info("oidc.exchange.issued", {
    issuedTokenId: issued.id,
    repositoryId: repository.id,
    repositoryFullName: repository.fullName,
    scope,
    expiresAt: expiresAt.toISOString(),
    expiresIn,
    agent: claims.agent,
    actor: actorLogin,
    actorId,
    subject: claims.sub,
    jti: claims.jti,
  });

  res
    .status(200)
    .set("Cache-Control", "no-store")
    .set("Pragma", "no-cache")
    .json({
      access_token: accessToken,
      issued_token_type: ACCESS_TOKEN_TYPE,
      token_type: "Bearer",
      expires_in: expiresIn,
      scope,
    });
});

interface RevokeBody {
  token?: string;
  token_type_hint?: string;
}

// RFC 7009 revocation endpoint.
router.post("/revoke", async (req: Request, res: Response) => {
  const body: RevokeBody = req.body || {};

  log.info("oidc.revoke.received", {
    has_token: !!body.token,
    token_type_hint: body.token_type_hint,
  });

  if (!body.token) {
    // RFC 7009 §2.1 — invalid_request for missing token.
    log.warn("oidc.revoke.rejected", { reason: "missing_token" });
    res.status(400).json({ error: "invalid_request", error_description: "token is required" });
    return;
  }

  // RFC 7009 §2.2 requires a 200 response even when the token is unknown,
  // already expired, or already revoked.
  const result = await prisma.issuedToken.updateMany({
    where: { tokenHash: hashToken(body.token), revokedAt: null },
    data: { revokedAt: new Date() },
  });

  log.info("oidc.revoke.completed", { revokedCount: result.count });

  res.status(200).set("Cache-Control", "no-store").send();
});

export default router;
