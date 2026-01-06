import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma as db } from '../../db.js';
import { requireAuth } from '../../utils/auth.js';
import { zodToJsonSchemaFastify } from '../../utils/zod-to-json-schema.js';

/**
 * Internal routes for user management
 * These require Auth0 authentication
 */
export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  // Verify user by email
  app.post(
    '/users/verify',
    {
      schema: {
        tags: ['Internal - Users'],
        summary: '[Internal] Verify user by email',
        description: 'Verify if a user exists by email address. Requires Auth0 authentication.',
        body: zodToJsonSchemaFastify(
          z.object({
            email: z.string().email(),
          })
        ),
        response: {
          200: zodToJsonSchemaFastify(
            z.union([
              z.object({
                exists: z.literal(true),
                user: z.object({
                  id: z.string(),
                  email: z.string(),
                  name: z.string().nullable(),
                }),
              }),
              z.object({
                exists: z.literal(false),
              }),
            ])
          ),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireAuth(request, reply);
      const body = request.body as { email: string };

      const user = await db.users.findUnique({
        where: { email: body.email },
      });

      if (user) {
        reply.send({
          exists: true as const,
          user: {
            id: user.id,
            email: user.email,
            name: user.name ?? null,
          },
        });
      } else {
        reply.send({
          exists: false as const,
        });
      }
    }
  );
}
