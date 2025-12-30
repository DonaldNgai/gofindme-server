import { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { registerCors } from './plugins/cors.js';
import { registerHelmet } from './plugins/helmet.js';
import { healthRoutes } from './routes/health.js';
import { registerApiKeyRoutes } from './routes/api-keys.js';
import { registerGroupRoutes } from './routes/groups.js';
import { registerLocationRoutes } from './routes/locations.js';
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
        title: 'FleetLink Location API',
        version: env.API_VERSION ?? '1.0.0',
        description: 'Receive, store, and relay location updates from mobile clients.',
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

  // OpenAPI spec endpoint for Readme.com integration
  fastify.get('/openapi.json', async (_request, reply) => {
    const spec = (fastify as any).swagger();
    reply.type('application/json').send(spec);
  });

  // Readme.com webhook endpoint for automatic spec updates
  fastify.post('/readme/webhook', async (request, reply) => {
    const readmeApiKey = env.README_API_KEY;
    const providedKey = request.headers['x-readme-api-key'];

    // Verify Readme.com API key if configured
    if (readmeApiKey && providedKey !== readmeApiKey) {
      reply.code(401);
      reply.send({ error: 'Invalid Readme.com API key' });
      return;
    }

    // Return the OpenAPI spec for Readme.com to consume
    const spec = (fastify as any).swagger();
    reply.type('application/json').send(spec);
  });

  // Register routes
  await fastify.register(healthRoutes, { prefix: env.API_PREFIX });
  await fastify.register(registerGroupRoutes);
  await fastify.register(registerApiKeyRoutes);
  await fastify.register(registerLocationRoutes);

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

