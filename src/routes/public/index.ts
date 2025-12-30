import type { FastifyInstance } from 'fastify';
import { registerPublicLocationRoutes } from './locations.js';

/**
 * Register all public routes (for npm package / API key users)
 * These routes use API key authentication and are part of the public API
 */
export async function registerPublicRoutes(app: FastifyInstance) {
  await app.register(registerPublicLocationRoutes);
}

