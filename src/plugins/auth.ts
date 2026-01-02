import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../utils/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: Awaited<ReturnType<typeof requireAuth>>;
  }
}

export async function authPlugin(fastify: FastifyInstance): Promise<void> {
  // Add a decorator to easily access authenticated user
  fastify.decorateRequest('user', {
    getter() {
      return undefined;
    },
  });

  // Optional: Add a helper method to get user
  // The actual auth check is done in requireAuth() which is called in routes
}
