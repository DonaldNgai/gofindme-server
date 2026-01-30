import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma as db } from '../../db.js';
import { createShareLink } from '../../services/share-links.js';
import { requireAuth } from '../../utils/auth.js';
import { findOrCreateUser } from '../../utils/user-helpers.js';
import { zodToJsonSchemaFastify } from '../../utils/zod-to-json-schema.js';

const createShareLinkBody = z.object({
  groupId: z.string().min(4),
  reason: z.string().max(500).optional().nullable(),
  expiresInSeconds: z.number().int().min(60).max(365 * 24 * 60 * 60).optional(),
});

export async function registerInternalShareLinkRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/share-links',
    {
      schema: {
        tags: ['Internal - Share Links'],
        summary: '[Internal] Create a share token for a group',
        description:
          'Create a share token that allows anyone with the token to submit location to the group without logging in. ' +
          'Optionally include a reason/message for the request. The app constructs the URL. Requires Auth0 authentication.',
        body: zodToJsonSchemaFastify(createShareLinkBody),
        response: {
          201: zodToJsonSchemaFastify(
            z.object({
              token: z.string(),
              expiresAt: z.string().nullable(),
            })
          ),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const body = createShareLinkBody.parse(request.body);

      const user = await findOrCreateUser(auth.sub, auth.email, auth.name);

      const group = await db.groups.findUnique({
        where: { id: body.groupId },
      });

      if (!group) {
        reply.code(404);
        throw new Error('Group not found');
      }

      const isOwner = group.owner_id === user.id;
      const membership = await db.group_members.findUnique({
        where: {
          group_id_user_id: {
            group_id: body.groupId,
            user_id: user.id,
          },
        },
      });

      const isActiveMember = membership && ['active', 'accepted'].includes(membership.status);

      if (!isOwner && !isActiveMember) {
        reply.code(403);
        throw new Error('You must be the group owner or an active member to create a share link');
      }

      const result = await createShareLink({
        groupId: body.groupId,
        reason: body.reason ?? null,
        createdByUserId: user.id,
        expiresInSeconds: body.expiresInSeconds,
      });

      reply.code(201).send({
        token: result.token,
        expiresAt: result.expiresAt?.toISOString() ?? null,
      });
    }
  );
}
