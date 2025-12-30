import type { FastifyInstance } from 'fastify';
import { registerInternalApiKeyRoutes } from './api-keys.js';
import { registerInternalGroupRoutes } from './groups.js';

/**
 * Register all internal routes (for Next.js frontend / Auth0 users)
 * These routes require Auth0 authentication and are NOT part of the public npm package
 */
export async function registerInternalRoutes(app: FastifyInstance) {
  await app.register(registerInternalGroupRoutes);
  await app.register(registerInternalApiKeyRoutes);
}

