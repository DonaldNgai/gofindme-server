import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { requireAuth } from '../utils/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: Awaited<ReturnType<typeof requireAuth>>;
  }
}

export async function authPlugin(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions
): Promise<void> {
  // Add a decorator to easily access authenticated user
  fastify.decorateRequest('user', null);

  // Optional: Add a helper method to get user
  fastify.addHook('onRequest', async (request, reply) => {
    // This hook runs before route handlers
    // The actual auth check is done in requireAuth() which is called in routes
  });
}

