/**
 * Cloudflare Access identity. Access sits in front of the Worker and signs a
 * JWT for every request it lets through (Cf-Access-Jwt-Assertion). The Worker
 * checks that token itself, rather than trusting a plain header, so the person
 * recorded on the ledger is the person Access signed in.
 */
export interface AccessConfig {
  /** e.g. small-band-b1e1.cloudflareaccess.com */
  teamDomain: string;
  /** Application audience (AUD) tag of the Access application. */
  aud: string;
}

export type AccessJwk = JsonWebKey & { kid: string };
export type CertFetcher = (url: string) => Promise<{ keys: AccessJwk[] }>;

export type AccessResult = { ok: true; email: string } | { ok: false; error: string };

const CERT_TTL_MS = 60 * 60 * 1000;
let cache: { url: string; at: number; keys: AccessJwk[] } | null = null;

/** Tests only: forget cached signing keys. */
export function resetAccessCache() {
  cache = null;
}

const defaultFetcher: CertFetcher = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Access certs returned ${res.status}.`);
  return (await res.json()) as { keys: AccessJwk[] };
};

async function keysFor(url: string, fetchCerts: CertFetcher, now: number, force: boolean): Promise<AccessJwk[]> {
  if (!force && cache && cache.url === url && now - cache.at < CERT_TTL_MS) return cache.keys;
  const { keys } = await fetchCerts(url);
  cache = { url, at: now, keys: Array.isArray(keys) ? keys : [] };
  return cache.keys;
}

function b64urlBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(s: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlBytes(s)));
}

/** Verify an Access JWT and return who it belongs to. */
export async function verifyAccessJwt(
  token: string,
  cfg: AccessConfig,
  fetchCerts: CertFetcher = defaultFetcher,
  now = Date.now(),
): Promise<AccessResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, error: "Malformed Access token." };
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    return { ok: false, error: "Malformed Access token." };
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return { ok: false, error: "Unexpected Access token algorithm." };

  const url = `https://${cfg.teamDomain}/cdn-cgi/access/certs`;
  let jwk = (await keysFor(url, fetchCerts, now, false)).find((k) => k.kid === header.kid);
  // Access rotates keys; refetch once before refusing an unknown key id.
  if (!jwk) jwk = (await keysFor(url, fetchCerts, now, true)).find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, error: "Unknown Access signing key." };

  const { kid: _kid, ...material } = jwk;
  const key = await crypto.subtle.importKey("jwk", material, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), signed);
  if (!valid) return { ok: false, error: "Access token signature is invalid." };

  const seconds = now / 1000;
  if (claims.iss !== `https://${cfg.teamDomain}`) return { ok: false, error: "Access token issuer does not match." };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(cfg.aud)) return { ok: false, error: "Access token is for another application." };
  if (typeof claims.exp !== "number" || claims.exp <= seconds) return { ok: false, error: "Access token has expired." };
  if (typeof claims.nbf === "number" && claims.nbf > seconds + 60) return { ok: false, error: "Access token is not valid yet." };

  // People carry an email; service tokens carry a common name.
  const who = typeof claims.email === "string" ? claims.email : typeof claims.common_name === "string" ? `service:${claims.common_name}` : null;
  if (!who) return { ok: false, error: "Access token names no one." };
  return { ok: true, email: who.slice(0, 254) };
}
