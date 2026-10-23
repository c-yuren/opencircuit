import { readFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { createAccessVerifier } from './access-jwt';

/** Optional explicit deployment config; never trusts a forwarded Host or Origin by itself. Localhost checks remain in the HTTP middleware. */
export async function createPreviewAuthorizer(
  configFile = new URL('../../.local/preview-access.json', import.meta.url),
  request: typeof fetch = fetch,
) {
  let publicOrigin = '';
  let host = '';
  let verify: ReturnType<typeof createAccessVerifier> | undefined;
  try {
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    const origin = new URL(config.origin);
    if (
      origin.protocol !== 'https:' ||
      origin.origin !== config.origin ||
      origin.username ||
      origin.password ||
      !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(config.issuer) ||
      !/^[a-f0-9]{64}$/.test(config.audience)
    )
      throw Error('Invalid preview Access configuration');
    publicOrigin = origin.origin;
    host = origin.host;
    verify = createAccessVerifier({ issuer: config.issuer, audience: config.audience, request });
  } catch {
    /* Missing/invalid config keeps the service localhost-only. */
  }
  return async (req: IncomingMessage): Promise<boolean> => {
    if (
      !verify ||
      req.headers.host !== host ||
      (req.headers.origin && req.headers.origin !== publicOrigin)
    )
      return false;
    if (
      ![req.socket.remoteAddress, req.socket.localAddress].every((address) =>
        ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? ''),
      )
    )
      return false;
    return verify(req.headers['cf-access-jwt-assertion']);
  };
}
