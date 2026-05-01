import jwt, { JwtHeader, JwtPayload, VerifyErrors } from "jsonwebtoken";
import { getSigningKey } from "./jwks";
import { log } from "../logger";

export interface GitHubOidcClaims extends JwtPayload {
  sub: string;
  agent?: string;
  actor?: string;
  actor_id?: string;
  // GitHub Apps user-to-server OIDC tokens convey the acting user via
  // `preferred_username` (login) and `user_id` (numeric GitHub id) instead
  // of the Actions-style `actor`/`actor_id` claims. The standard nested
  // `act.sub` claim (RFC 8693) is also emitted in the form `user_id:<id>`.
  preferred_username?: string;
  user_id?: string;
  act?: { sub?: string };
  owner?: string;
  owner_id?: string;
  repo?: string;
  repo_id?: string;
  // GitHub Actions OIDC also commonly emits these (kept as fallbacks).
  repository?: string;
  repository_id?: string;
  repository_owner?: string;
  repository_owner_id?: string;
}

// Resolve the acting user's GitHub login from an OIDC payload. Prefers
// the explicit `actor` claim (Actions OIDC) and falls back to
// `preferred_username` (GitHub App user-to-server OIDC).
export function resolveActorLogin(
  claims: GitHubOidcClaims,
): string | undefined {
  return claims.actor ?? claims.preferred_username ?? undefined;
}

// Resolve the acting user's numeric GitHub id from an OIDC payload.
// Prefers `actor_id` (Actions OIDC), then `user_id`, then parses the
// numeric suffix from `act.sub` (formatted as `user_id:<id>`).
export function resolveActorId(
  claims: GitHubOidcClaims,
): string | undefined {
  if (claims.actor_id != null) return String(claims.actor_id);
  if (claims.user_id != null) return String(claims.user_id);
  const actSub = claims.act?.sub;
  if (typeof actSub === "string") {
    const match = /^user_id:(\d+)$/.exec(actSub);
    if (match) return match[1];
  }
  return undefined;
}

export class OidcVerificationError extends Error {
  constructor(
    public code:
      | "invalid_token"
      | "invalid_request"
      | "invalid_target"
      | "unauthorized_client",
    message: string,
  ) {
    super(message);
    this.name = "OidcVerificationError";
  }
}

export async function verifyOidcJwt(
  token: string,
  issuer: string,
  audience: string,
): Promise<GitHubOidcClaims> {
  log.debug("oidc.verify.start", {
    issuer,
    audience,
    tokenLength: token.length,
  });

  // Decode (without verifying) to surface the issuer/audience/kid in logs.
  // This makes issuer/JWKS mismatches obvious before we attempt signature
  // verification.
  try {
    const unverified = jwt.decode(token, { complete: true });
    if (unverified && typeof unverified === "object") {
      log.info("oidc.verify.unverified_claims", {
        header: unverified.header,
        payload: unverified.payload,
        expected_issuer: issuer,
        expected_audience: audience,
      });
    }
  } catch {
    // Decoding is best-effort logging; ignore failures.
  }

  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      (header: JwtHeader, callback) => {
        log.debug("oidc.verify.header", {
          alg: header.alg,
          kid: header.kid,
          typ: header.typ,
        });
        if (!header.kid) {
          callback(new Error("JWT header is missing a kid"));
          return;
        }
        getSigningKey(issuer, header.kid)
          .then((key) => {
            log.debug("oidc.verify.signing_key.resolved", { kid: header.kid });
            callback(
              null,
              key.export({ type: "spki", format: "pem" }) as unknown as string,
            );
          })
          .catch((err) => {
            log.warn("oidc.verify.signing_key.failed", {
              kid: header.kid,
              reason: err instanceof Error ? err.message : String(err),
            });
            callback(err as Error);
          });
      },
      {
        algorithms: ["RS256"],
        issuer,
        audience,
      },
      (err: VerifyErrors | null, decoded) => {
        if (err) {
          log.warn("oidc.verify.failed", {
            name: err.name,
            message: err.message,
          });
          reject(new OidcVerificationError("invalid_token", err.message));
          return;
        }
        if (!decoded || typeof decoded === "string") {
          log.warn("oidc.verify.failed", {
            reason: "payload_not_object",
          });
          reject(
            new OidcVerificationError(
              "invalid_token",
              "JWT payload is not an object",
            ),
          );
          return;
        }
        const claims = decoded as GitHubOidcClaims;
        log.info("oidc.verify.succeeded", {
          iss: claims.iss,
          aud: claims.aud,
          sub: claims.sub,
          jti: claims.jti,
          exp: claims.exp,
          iat: claims.iat,
          agent: claims.agent,
          actor: resolveActorLogin(claims),
          actor_id: resolveActorId(claims),
          owner: claims.owner ?? claims.repository_owner,
          repo: claims.repo ?? claims.repository,
          repo_id: claims.repo_id ?? claims.repository_id,
        });
        resolve(claims);
      },
    );
  });
}
