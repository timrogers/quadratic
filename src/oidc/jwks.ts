import crypto from "crypto";
import { log } from "../logger";

interface JsonWebKey {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
  crv?: string;
}

interface Jwks {
  keys: JsonWebKey[];
}

interface CachedJwks {
  keys: Map<string, crypto.KeyObject>;
  fetchedAt: number;
}

const JWKS_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map<string, CachedJwks>();

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function loadJwks(issuer: string): Promise<CachedJwks> {
  const discoveryUrl = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  log.debug("oidc.jwks.discovery.fetch", { issuer, discoveryUrl });
  const config = await fetchJson<{ jwks_uri: string }>(discoveryUrl);
  if (!config.jwks_uri) {
    throw new Error(`Issuer ${issuer} did not advertise a jwks_uri`);
  }
  log.debug("oidc.jwks.discovery.resolved", { issuer, jwksUri: config.jwks_uri });

  const jwks = await fetchJson<Jwks>(config.jwks_uri);
  const keys = new Map<string, crypto.KeyObject>();
  for (const jwk of jwks.keys) {
    if (!jwk.kid) continue;
    try {
      const key = crypto.createPublicKey({
        key: jwk as crypto.JsonWebKeyInput["key"],
        format: "jwk",
      });
      keys.set(jwk.kid, key);
    } catch (err) {
      log.warn("oidc.jwks.key.skipped", {
        kid: jwk.kid,
        kty: jwk.kty,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info("oidc.jwks.loaded", {
    issuer,
    keyCount: keys.size,
    kids: Array.from(keys.keys()),
  });

  return { keys, fetchedAt: Date.now() };
}

export async function getSigningKey(
  issuer: string,
  kid: string,
): Promise<crypto.KeyObject> {
  let entry = cache.get(issuer);
  const cacheHit = !!entry && Date.now() - entry.fetchedAt <= JWKS_TTL_MS && entry.keys.has(kid);
  if (!entry || Date.now() - entry.fetchedAt > JWKS_TTL_MS || !entry.keys.has(kid)) {
    log.debug("oidc.jwks.cache.miss", {
      issuer,
      kid,
      reason: !entry
        ? "no-cache-entry"
        : Date.now() - entry.fetchedAt > JWKS_TTL_MS
          ? "expired"
          : "kid-not-found",
    });
    entry = await loadJwks(issuer);
    cache.set(issuer, entry);
  } else {
    log.debug("oidc.jwks.cache.hit", { issuer, kid });
  }
  void cacheHit;
  const key = entry.keys.get(kid);
  if (!key) {
    throw new Error(`No signing key found for kid=${kid} at issuer ${issuer}`);
  }
  return key;
}

export function clearJwksCache(): void {
  cache.clear();
}
