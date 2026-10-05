import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Long random secret for links and refresh tokens. */
export const randomToken = () => randomBytes(32).toString('base64url');

/** Six digits, zero-padded, for typing on a phone. */
export const randomCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Tokens and codes are stored only as hashes, so a database leak doesn't hand out sign-ins. */
export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('base64url');

export const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export type AccessClaims = { userId: string; sessionId: string; expiresAt: number };

/**
 * Short-lived access tokens: `v1.<payload>.<signature>`, HMAC-SHA256 over the payload.
 * Checking one needs no database lookup; revocation takes effect when it expires.
 */
export function signAccessToken(claims: AccessClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ sub: claims.userId, sid: claims.sessionId, exp: claims.expiresAt })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `v1.${payload}.${signature}`;
}

export function verifyAccessToken(token: string, secret: string, now: number): AccessClaims | null {
  const [version, payload, signature] = token.split('.');
  if (version !== 'v1' || !payload || !signature) return null;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  if (!sameSecret(signature, expected)) return null;
  try {
    const { sub, sid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof sub !== 'string' || typeof sid !== 'string' || typeof exp !== 'number' || exp <= now) return null;
    return { userId: sub, sessionId: sid, expiresAt: exp };
  } catch {
    return null;
  }
}
