import { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { registerCors } from './plugins/cors.js';
import { registerHelmet } from './plugins/helmet.js';
import { healthRoutes } from './routes/health.js';
import { registerInternalRoutes } from './routes/internal/index.js';
import { registerPublicRoutes } from './routes/public/index.js';
import { registerReadmeRoutes } from './routes/readme.js';
import { env } from './config/env.js';

export async function buildApp(fastify: FastifyInstance) {
  // Register plugins
  await registerHelmet(fastify);
  await registerCors(fastify);

  // Register rate limiting
  await fastify.register(rateLimit, {
    max: env.RATE_LIMIT_MAX ?? 300,
    timeWindow: env.RATE_LIMIT_WINDOW ?? '1 minute',
  });

  // Register Swagger with enhanced config
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'GoFindMe Location API',
        version: env.API_VERSION ?? '1.0.0',
        description:
          'Public API for location tracking. Internal endpoints (tagged with "Internal") require Auth0 authentication and are for admin use only.',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
          apiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'x-api-key',
          },
        },
      },
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // Health check endpoint (no prefix)
  fastify.get('/health', async () => ({ status: 'ok' }));

  // Auth test endpoint (protected)
  fastify.get(
    '/auth/test',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Test authentication endpoint',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              authenticated: { type: 'boolean' },
              user: {
                type: 'object',
                properties: {
                  sub: { type: 'string' },
                  email: { type: 'string' },
                  name: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { requireAuth } = await import('./utils/auth.js');
      const user = await requireAuth(request, reply);
      return {
        authenticated: true,
        user: {
          sub: user.sub,
          email: user.email,
          name: user.name,
        },
      };
    }
  );

  // Register Readme.com integration routes (no prefix - root level)
  await fastify.register(registerReadmeRoutes);

  // Register public routes (for npm package / API key users)
  // These are documented in Swagger and part of the public API
  await fastify.register(healthRoutes, { prefix: env.API_PREFIX });
  await fastify.register(registerPublicRoutes, { prefix: env.API_PREFIX });

  // Register internal routes (for Next.js frontend / Auth0 users)
  // These require Auth0 authentication and are NOT in the public npm package
  // Tagged as "Internal" in Swagger but still accessible if you have Auth0 token
  await fastify.register(registerInternalRoutes, { prefix: env.INTERNAL_API_PREFIX });

  // Global error handler
  fastify.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    fastify.log.error(error);

    const statusCode = error.statusCode ?? 500;
    const message = error.message ?? 'Internal Server Error';

    reply.status(statusCode).send({
      error: {
        statusCode,
        message,
        ...(env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  });

  return fastify;
}
