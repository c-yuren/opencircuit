import { createPublicKey, verify, type KeyObject } from 'node:crypto';

// Deployment metadata is supplied from local configuration; no user tokens are stored.
export function createAccessVerifier({
  issuer,
  audience,
  request = fetch,
}: {
  issuer: string;
  audience: string;
  request?: typeof fetch;
}) {
  let keys = new Map<string, KeyObject>();
  let expires = 0;
  let loading: Promise<void> | undefined;
  return async function allows(token: unknown) {
    try {
      if (typeof token !== 'string' || token.length > 16384) return false;
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      const now = Date.now() / 1000;
      if (
        header.alg !== 'RS256' ||
        typeof header.kid !== 'string' ||
        claims.iss !== issuer ||
        !(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(audience) ||
        typeof claims.exp !== 'number' ||
        claims.exp <= now ||
        (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now + 5)) ||
        typeof claims.sub !== 'string' ||
        !claims.sub
      )
        return false;
      if (Date.now() >= expires) {
        loading ??= (async () => {
          const response = await request(issuer + '/cdn-cgi/access/certs', {
            signal: AbortSignal.timeout(5000),
            redirect: 'error',
          });
          if (!response.ok || !response.body) throw new Error('Access keys unavailable');
          let body = '';
          const reader = response.body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              body += Buffer.from(value).toString('utf8');
              if (Buffer.byteLength(body) > 65536) throw new Error('Key response too large');
            }
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
          const jwks = JSON.parse(body);
          if (!Array.isArray(jwks.keys) || jwks.keys.length > 32) throw new Error('Invalid keys');
          const next = new Map();
          for (const key of jwks.keys)
            if (
              key.kty === 'RSA' &&
              typeof key.kid === 'string' &&
              (!key.alg || key.alg === 'RS256') &&
              (!key.use || key.use === 'sig')
            )
              next.set(key.kid, createPublicKey({ key, format: 'jwk' }));
          if (!next.size) throw new Error('No keys');
          keys = next;
          expires = Date.now() + 300000;
        })().finally(() => {
          loading = undefined;
        });
        await loading;
      }
      const key = keys.get(header.kid);
      return (
        !!key &&
        verify(
          'RSA-SHA256',
          Buffer.from(parts[0] + '.' + parts[1]),
          key,
          Buffer.from(parts[2], 'base64url'),
        )
      );
    } catch {
      return false;
    }
  };
}
