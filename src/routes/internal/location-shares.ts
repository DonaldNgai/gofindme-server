import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { prisma as db } from '../../db.js';
import { requireAuth } from '../../utils/auth.js';
import { findOrCreateUser } from '../../utils/user-helpers.js';
import { zodToJsonSchemaFastify } from '../../utils/zod-to-json-schema.js';

const locationShareResponse = z.object({
  id: z.string(),
  userId: z.string(),
  groupId: z.string(),
  deviceId: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Internal routes for location shares
 * These require Auth0 authentication
 */
export async function registerLocationShareRoutes(app: FastifyInstance): Promise<void> {
  // Create a location share
  app.post(
    '/location-shares',
    {
      schema: {
        tags: ['Internal - Location Shares'],
        summary: '[Internal] Create a location share',
        description: 'Start sharing location with a group. Requires Auth0 authentication.',
        body: zodToJsonSchemaFastify(
          z.object({
            groupId: z.string().min(4),
            deviceId: z.string().optional(),
          })
        ),
        response: {
          201: zodToJsonSchemaFastify(locationShareResponse),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const body = request.body as { groupId: string; deviceId?: string };

      const userId = auth.sub;

      // Find or create user
      const user = await findOrCreateUser(userId, auth.email, auth.name);

      // Verify group exists
      const group = await db.groups.findUnique({
        where: { id: body.groupId },
      });

      if (!group) {
        reply.code(404);
        throw new Error('Group not found');
      }

      // Check if user is a member of the group
      const membership = await db.group_members.findUnique({
        where: {
          group_id_user_id: {
            group_id: body.groupId,
            user_id: user.id,
          },
        },
      });

      if (!membership || membership.status !== 'active') {
        reply.code(403);
        throw new Error('You must be an active member of the group to share location');
      }

      // End any existing active shares for this user/group
      await db.location_shares.updateMany({
        where: {
          user_id: user.id,
          group_id: body.groupId,
          is_active: true,
        },
        data: {
          is_active: false,
          ended_at: new Date(),
          updated_at: new Date(),
        },
      });

      // Create new location share
      const share = await db.location_shares.create({
        data: {
          id: nanoid(),
          user_id: user.id,
          group_id: body.groupId,
          device_id: body.deviceId,
          is_active: true,
          updated_at: new Date(),
        },
      });

      reply.code(201).send({
        id: share.id,
        userId: share.user_id,
        groupId: share.group_id,
        deviceId: share.device_id ?? null,
        startedAt: share.started_at.toISOString(),
        endedAt: share.ended_at?.toISOString() ?? null,
        isActive: share.is_active,
        createdAt: share.created_at.toISOString(),
        updatedAt: share.updated_at.toISOString(),
      });
    }
  );

  // List active location shares for a group
  app.get(
    '/groups/:groupId/location-shares',
    {
      schema: {
        tags: ['Internal - Location Shares'],
        summary: '[Internal] List active location shares for a group',
        description: 'Get all active location shares for a group. Requires Auth0 authentication.',
        params: zodToJsonSchemaFastify(z.object({ groupId: z.string().min(4) })),
        querystring: zodToJsonSchemaFastify(
          z.object({
            activeOnly: z.coerce.boolean().default(true).optional(),
          })
        ),
        response: {
          200: zodToJsonSchemaFastify(z.object({ items: z.array(locationShareResponse) })),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const { groupId } = request.params as { groupId: string };
      const query = request.query as { activeOnly?: boolean };

      const userId = auth.sub;

      // Find or create user
      const user = await findOrCreateUser(userId, auth.email, auth.name);

      // Verify group exists
      const group = await db.groups.findUnique({
        where: { id: groupId },
      });

      if (!group) {
        reply.code(404);
        throw new Error('Group not found');
      }

      // Check if user is a member or owner
      const membership = await db.group_members.findUnique({
        where: {
          group_id_user_id: {
            group_id: groupId,
            user_id: user.id,
          },
        },
      });

      const isOwner = group.owner_id === user.id;
      const isMember = membership?.status === 'active';

      if (!isOwner && !isMember) {
        reply.code(403);
        throw new Error('You must be a member or owner of the group to view location shares');
      }

      const where: { group_id: string; is_active?: boolean } = {
        group_id: groupId,
      };

      if (query.activeOnly !== false) {
        where.is_active = true;
      }

      const shares = await db.location_shares.findMany({
        where,
        orderBy: { started_at: 'desc' },
      });

      reply.send({
        items: shares.map((share) => ({
          id: share.id,
          userId: share.user_id,
          groupId: share.group_id,
          deviceId: share.device_id ?? null,
          startedAt: share.started_at.toISOString(),
          endedAt: share.ended_at?.toISOString() ?? null,
          isActive: share.is_active,
          createdAt: share.created_at.toISOString(),
          updatedAt: share.updated_at.toISOString(),
        })),
      });
    }
  );

  // List location shares for current user
  app.get(
    '/location-shares',
    {
      schema: {
        tags: ['Internal - Location Shares'],
        summary: '[Internal] List my location shares',
        description:
          'Get all location shares for the authenticated user. Requires Auth0 authentication.',
        querystring: zodToJsonSchemaFastify(
          z.object({
            activeOnly: z.coerce.boolean().default(true).optional(),
            groupId: z.string().optional(),
          })
        ),
        response: {
          200: zodToJsonSchemaFastify(z.object({ items: z.array(locationShareResponse) })),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const query = request.query as { activeOnly?: boolean; groupId?: string };

      const userId = auth.sub;

      // Find or create user
      const user = await findOrCreateUser(userId, auth.email, auth.name);

      const where: { user_id: string; is_active?: boolean; group_id?: string } = {
        user_id: user.id,
      };

      if (query.activeOnly !== false) {
        where.is_active = true;
      }

      if (query.groupId) {
        where.group_id = query.groupId;
      }

      const shares = await db.location_shares.findMany({
        where,
        orderBy: { started_at: 'desc' },
      });

      reply.send({
        items: shares.map((share) => ({
          id: share.id,
          userId: share.user_id,
          groupId: share.group_id,
          deviceId: share.device_id ?? null,
          startedAt: share.started_at.toISOString(),
          endedAt: share.ended_at?.toISOString() ?? null,
          isActive: share.is_active,
          createdAt: share.created_at.toISOString(),
          updatedAt: share.updated_at.toISOString(),
        })),
      });
    }
  );

  // End a location share
  app.post(
    '/location-shares/:shareId/end',
    {
      schema: {
        tags: ['Internal - Location Shares'],
        summary: '[Internal] End a location share',
        description: 'Stop sharing location. Requires Auth0 authentication.',
        params: zodToJsonSchemaFastify(z.object({ shareId: z.string().min(4) })),
        response: {
          200: zodToJsonSchemaFastify(locationShareResponse),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const { shareId } = request.params as { shareId: string };

      const userId = auth.sub;

      // Find or create user
      const user = await findOrCreateUser(userId, auth.email, auth.name);

      // Find location share
      const share = await db.location_shares.findUnique({
        where: { id: shareId },
      });

      if (!share) {
        reply.code(404);
        throw new Error('Location share not found');
      }

      // Verify share belongs to user
      if (share.user_id !== user.id) {
        reply.code(403);
        throw new Error('This location share does not belong to you');
      }

      // Update share
      const updated = await db.location_shares.update({
        where: { id: shareId },
        data: {
          is_active: false,
          ended_at: new Date(),
          updated_at: new Date(),
        },
      });

      reply.send({
        id: updated.id,
        userId: updated.user_id,
        groupId: updated.group_id,
        deviceId: updated.device_id ?? null,
        startedAt: updated.started_at.toISOString(),
        endedAt: updated.ended_at?.toISOString() ?? null,
        isActive: updated.is_active,
        createdAt: updated.created_at.toISOString(),
        updatedAt: updated.updated_at.toISOString(),
      });
    }
  );
}
