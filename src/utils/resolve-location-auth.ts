import type { FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from './auth.js';
import { validateAnonymousSession } from '../services/anonymous-sessions.js';
import { validateShareLink } from '../services/share-links.js';
import { getDefaultAnonymousGroupId } from '../services/default-anonymous-group.js';

export type LocationAuth =
  | { type: 'auth0'; userId: string; email?: string; name?: string }
  | { type: 'anonymous'; groupId: string }
  | { type: 'share'; groupId: string };

const LOCATION_TOKEN_HEADER = 'x-location-token';

function looksLikeJwt(value: string): boolean {
  return value.split('.').length === 3;
}

/**
 * Resolves location submission auth from:
 * - X-Location-Token: anonymous or share-link token
 * - Authorization: Bearer — Auth0 JWT, or our opaque token (anon/share)
 *
 * Returns LocationAuth or sends 401 and throws.
 */
export async function resolveLocationAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<LocationAuth> {
  const locationToken = request.headers[LOCATION_TOKEN_HEADER];
  const raw =
    typeof locationToken === 'string'
      ? locationToken
      : Array.isArray(locationToken)
        ? locationToken[0]
        : undefined;

  if (raw) {
    const auth = await resolveOurToken(raw, reply);
    if (auth) return auth;
    reply.code(401);
    reply.send({ error: 'Invalid or expired location token' });
    throw new Error('Invalid location token');
  }

  const authHeader = request.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

  if (!bearer) {
    reply.code(401);
    reply.send({
      error:
        'Missing authentication. Use Authorization: Bearer <token> or X-Location-Token header.',
    });
    throw new Error('Missing auth');
  }

  if (looksLikeJwt(bearer)) {
    try {
      const auth0 = await requireAuth(request, reply);
      return {
        type: 'auth0',
        userId: auth0.sub,
        email: auth0.email,
        name: auth0.name,
      };
    } catch {
      throw new Error('Auth0 verification failed');
    }
  }

  const ourAuth = await resolveOurToken(bearer, reply);
  if (ourAuth) return ourAuth;

  reply.code(401);
  reply.send({ error: 'Invalid or expired token' });
  throw new Error('Invalid token');
}

async function resolveOurToken(
  token: string,
  reply: FastifyReply
): Promise<LocationAuth | null> {
  const isShare = token.startsWith('share_');

  if (isShare) {
    const result = await validateShareLink(token);
    if (!result.valid) return null;
    return { type: 'share', groupId: result.groupId };
  }

  const anon = await validateAnonymousSession(token);
  if (!anon.valid) return null;
  const groupId = await getDefaultAnonymousGroupId();
  return { type: 'anonymous', groupId };
}
