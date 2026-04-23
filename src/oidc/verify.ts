import jwt, { JwtHeader, JwtPayload, VerifyErrors } from "jsonwebtoken";
import { getSigningKey } from "./jwks";
import { log } from "../logger";

export interface GitHubOidcClaims extends JwtPayload {
  sub: string;
  agent?: string;
  actor?: string;
  actor_id?: string;
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
          actor: claims.actor,
          actor_id: claims.actor_id,
          owner: claims.owner ?? claims.repository_owner,
          repo: claims.repo ?? claims.repository,
          repo_id: claims.repo_id ?? claims.repository_id,
        });
        resolve(claims);
      },
    );
  });
}
