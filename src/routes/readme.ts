import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

/**
 * Readme.com integration routes
 * These routes provide OpenAPI specification for documentation tools
 */
export async function registerReadmeRoutes(app: FastifyInstance) {
  // OpenAPI spec endpoint for Readme.com integration
  app.get(
    '/openapi.json',
    {
      schema: {
        tags: ['Readme'],
        summary: 'Get OpenAPI specification',
        description: 'Returns the OpenAPI 3.0 specification in JSON format. Used by Readme.com and other API documentation tools.',
        response: {
          200: {
            type: 'object',
            description: 'OpenAPI 3.0 specification',
          },
        },
      },
    },
    async (_request, reply) => {
      const spec = (app as any).swagger();
      reply.type('application/json').send(spec);
    }
  );

  // Readme.com webhook endpoint for automatic spec updates
  app.post(
    '/readme/webhook',
    {
      schema: {
        tags: ['Readme'],
        summary: 'Readme.com webhook for spec updates',
        description:
          'Webhook endpoint for Readme.com to automatically fetch the latest OpenAPI specification. Requires X-Readme-API-Key header if README_API_KEY is configured.',
        headers: {
          type: 'object',
          properties: {
            'x-readme-api-key': {
              type: 'string',
              description: 'Readme.com API key for authentication',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            description: 'OpenAPI 3.0 specification',
          },
          401: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const readmeApiKey = env.README_API_KEY;
      const providedKey = request.headers['x-readme-api-key'];

      // Verify Readme.com API key if configured
      if (readmeApiKey && providedKey !== readmeApiKey) {
        reply.code(401);
        reply.send({ error: 'Invalid Readme.com API key' });
        return;
      }

      // Return the OpenAPI spec for Readme.com to consume
      const spec = (app as any).swagger();
      reply.type('application/json').send(spec);
    }
  );
}
