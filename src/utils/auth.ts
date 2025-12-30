import { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export interface Auth0Config {
  domain: string;
  audience: string;
}

function getAuth0Config(): Auth0Config {
  // Support both AUTH0_DOMAIN and AUTH0_ISSUER_BASE_URL for flexibility
  const domain =
    process.env.AUTH0_DOMAIN ||
    process.env.AUTH0_ISSUER_BASE_URL?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const audience = process.env.AUTH0_AUDIENCE;

  if (!domain) {
    throw new Error(
      'AUTH0_DOMAIN or AUTH0_ISSUER_BASE_URL must be configured. Example: your-tenant.auth0.com'
    );
  }
  if (!audience) {
    throw new Error(
      'AUTH0_AUDIENCE must be configured. This is your API identifier from Auth0 dashboard.'
    );
  }

  return { domain, audience };
}

function getIssuerUrl(domain: string): string {
  // Ensure proper format: https://domain/
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${cleanDomain}/`;
}

async function getJwks() {
  if (!jwks) {
    const config = getAuth0Config();
    const issuerUrl = getIssuerUrl(config.domain);
    const jwksUrl = `${issuerUrl}.well-known/jwks.json`;

    jwks = createRemoteJWKSet(new URL(jwksUrl));
  }
  return jwks;
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<JWTPayload & { sub: string; email?: string; name?: string }> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    reply.code(401);
    reply.send({ error: 'Missing or invalid authorization header. Expected: Bearer <token>' });
    throw new Error('Missing bearer token');
  }

  const token = header.slice(7);

  if (!token) {
    reply.code(401);
    reply.send({ error: 'Token is empty' });
    throw new Error('Empty token');
  }

  try {
    const config = getAuth0Config();
    const issuerUrl = getIssuerUrl(config.domain);

    const { payload } = await jwtVerify(token, await getJwks(), {
      issuer: issuerUrl,
      audience: config.audience,
    });

    // Ensure required claims exist
    if (!payload.sub) {
      reply.code(401);
      reply.send({ error: 'Token missing required claim: sub' });
      throw new Error('Token missing sub claim');
    }

    return payload as JWTPayload & { sub: string; email?: string; name?: string };
  } catch (error) {
    if (error instanceof Error) {
      // Provide more helpful error messages
      if (error.message.includes('expired')) {
        reply.code(401);
        reply.send({ error: 'Token has expired' });
      } else if (error.message.includes('signature')) {
        reply.code(401);
        reply.send({ error: 'Invalid token signature' });
      } else if (error.message.includes('audience')) {
        reply.code(401);
        reply.send({ error: 'Invalid token audience' });
      } else {
        reply.code(401);
        reply.send({ error: `Authentication failed: ${error.message}` });
      }
    } else {
      reply.code(401);
      reply.send({ error: 'Authentication failed' });
    }
    throw error;
  }
}
