import type { FastifyInstance } from 'fastify';
import { registerInternalApiKeyRoutes } from './api-keys.js';
import { registerInternalGroupRoutes } from './groups.js';
import { registerGroupInvitationRoutes } from './group-invitations.js';
import { registerLocationShareRoutes } from './location-shares.js';
import { registerUserRoutes } from './users.js';

/**
 * Register all internal routes (for Next.js frontend / Auth0 users)
 * These routes require Auth0 authentication and are NOT part of the public npm package
 *
 * Note: This function is registered with prefix '/api/internal' in app.ts
 * Since we're already in a scoped context with the prefix, we can call the
 * route registration functions directly - they will register routes relative to '/api/internal'
 */
export async function registerInternalRoutes(app: FastifyInstance): Promise<void> {
  // Register group routes directly (we're already in the /api/internal scope)
  await registerInternalGroupRoutes(app);

  // Register API key routes directly (we're already in the /api/internal scope)
  await registerInternalApiKeyRoutes(app);

  // Register group invitation routes
  await registerGroupInvitationRoutes(app);

  // Register location share routes
  await registerLocationShareRoutes(app);

  // Register user routes
  await registerUserRoutes(app);
}
