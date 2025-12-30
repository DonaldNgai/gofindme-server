import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma as db } from '../../db.js';
import { requireAuth, getUserFromAuth0 } from '../../utils/auth.js';
import { zodToJsonSchemaFastify } from '../../utils/zod-to-json-schema.js';

const groupResponse = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  apiBaseUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Internal routes for group management
 * These are only accessible to authenticated users via Auth0 (your Next.js frontend)
 * NOT exposed in the public npm package
 */
export async function registerInternalGroupRoutes(app: FastifyInstance) {
  // Create a new group
  app.post(
    '/groups',
    {
      schema: {
        tags: ['Internal - Groups'],
        summary: '[Internal] Create a new location group',
        description: 'Internal endpoint for creating groups. Requires Auth0 authentication.',
        body: zodToJsonSchemaFastify(
          z.object({
            name: z.string().min(3),
            description: z.string().optional(),
            apiBaseUrl: z.string().url().optional(),
          })
        ),
        response: {
          201: zodToJsonSchemaFastify(groupResponse),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Verify Auth0 access token and get user's sub
      const auth = await requireAuth(request, reply);
      const body = request.body as { name: string; description?: string; apiBaseUrl?: string };

      // auth.sub is guaranteed to exist from requireAuth
      const userId = auth.sub;

      // Find or create user using the sub from token
      let user = await db.users.findFirst({
        where: {
          OR: [{ email: auth.email as string }, { id: userId }],
        },
      });

      if (!user) {
        // If email is not in token, query Auth0 Management API to get user info
        let userEmail = auth.email;
        let userName = auth.name;

        if (!userEmail) {
          const auth0User = await getUserFromAuth0(userId);
          if (auth0User) {
            userEmail = auth0User.email;
            userName = auth0User.name || userName;
          }
        }

        // Fallback to generated email if still not available
        if (!userEmail) {
          userEmail = `${userId}@auth0.local`;
        }

        // Create user if doesn't exist, using sub from Auth0 token
        user = await db.users.create({
          data: {
            id: userId, // Use Auth0 sub as the user ID
            email: userEmail,
            name: userName as string | undefined,
          },
        });
      }

      const record = await db.groups.create({
        data: {
          name: body.name,
          description: body.description,
          api_base_url: body.apiBaseUrl,
          owner_id: user.id, // Use the user ID (which is the Auth0 sub)
        },
      });

      reply.code(201).send({
        id: record.id,
        name: record.name,
        description: record.description ?? null,
        apiBaseUrl: record.api_base_url ?? null,
        createdAt: record.created_at.toISOString(),
        updatedAt: record.updated_at.toISOString(),
      });
    }
  );

  // List groups owned by user
  app.get(
    '/groups',
    {
      schema: {
        tags: ['Internal - Groups'],
        summary: '[Internal] List groups you own',
        description: 'Internal endpoint for listing groups. Requires Auth0 authentication.',
        response: {
          200: zodToJsonSchemaFastify(z.object({ items: z.array(groupResponse) })),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Verify Auth0 access token and get user's sub
      const auth = await requireAuth(request, reply);

      // auth.sub is guaranteed to exist from requireAuth
      const userId = auth.sub;

      // Find or create user using the sub from token
      let user = await db.users.findFirst({
        where: {
          OR: [{ email: auth.email as string }, { id: userId }],
        },
      });

      if (!user) {
        user = await db.users.create({
          data: {
            id: userId, // Use Auth0 sub as the user ID
            email: auth.email as string,
            name: auth.name as string | undefined,
          },
        });
      }

      const rows = await db.groups.findMany({
        where: { owner_id: user.id }, // Use the user ID (which is the Auth0 sub)
      });

      reply.send({
        items: rows.map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description ?? null,
          apiBaseUrl: row.api_base_url ?? null,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        })),
      });
    }
  );

  // Get single group
  app.get(
    '/groups/:groupId',
    {
      schema: {
        tags: ['Internal - Groups'],
        summary: '[Internal] Get a group by ID',
        description: 'Internal endpoint for getting group details. Requires Auth0 authentication.',
        params: zodToJsonSchemaFastify(z.object({ groupId: z.string().min(4) })),
        response: {
          200: zodToJsonSchemaFastify(groupResponse),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const { groupId } = request.params as { groupId: string };
      const ownerId = auth.sub ?? 'anonymous';

      // Find user
      let user = await db.users.findFirst({
        where: {
          OR: [{ email: auth.email as string }, { id: ownerId }],
        },
      });

      const group = await db.groups.findFirst({
        where: {
          id: groupId,
          owner_id: user?.id ?? ownerId,
        },
      });

      if (!group) {
        reply.code(404);
        throw new Error('Group not found');
      }

      reply.send({
        id: group.id,
        name: group.name,
        description: group.description ?? null,
        apiBaseUrl: group.api_base_url ?? null,
        createdAt: group.created_at.toISOString(),
        updatedAt: group.updated_at.toISOString(),
      });
    }
  );

  // Update group
  app.patch(
    '/groups/:groupId',
    {
      schema: {
        tags: ['Internal - Groups'],
        summary: '[Internal] Update a group',
        description: 'Internal endpoint for updating groups. Requires Auth0 authentication.',
        params: zodToJsonSchemaFastify(z.object({ groupId: z.string().min(4) })),
        body: zodToJsonSchemaFastify(
          z.object({
            name: z.string().min(3).optional(),
            description: z.string().optional(),
            apiBaseUrl: z.string().url().optional(),
          })
        ),
        response: {
          200: zodToJsonSchemaFastify(groupResponse),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Verify Auth0 access token and get user's sub
      const auth = await requireAuth(request, reply);
      const { groupId } = request.params as { groupId: string };
      const body = request.body as { name?: string; description?: string; apiBaseUrl?: string };

      // auth.sub is guaranteed to exist from requireAuth
      const userId = auth.sub;

      // Find or create user using the sub from token
      let user = await db.users.findFirst({
        where: {
          OR: [{ email: auth.email as string }, { id: userId }],
        },
      });

      if (!user) {
        user = await db.users.create({
          data: {
            id: userId, // Use Auth0 sub as the user ID
            email: auth.email as string,
            name: auth.name as string | undefined,
          },
        });
      }

      const group = await db.groups.findFirst({
        where: {
          id: groupId,
          owner_id: user.id, // Use the user ID (which is the Auth0 sub)
        },
      });

      if (!group) {
        reply.code(404);
        throw new Error('Group not found');
      }

      const updated = await db.groups.update({
        where: { id: groupId },
        data: {
          ...(body.name && { name: body.name }),
          ...(body.description !== undefined && { description: body.description }),
          ...(body.apiBaseUrl !== undefined && { api_base_url: body.apiBaseUrl }),
        },
      });

      reply.send({
        id: updated.id,
        name: updated.name,
        description: updated.description ?? null,
        apiBaseUrl: updated.api_base_url ?? null,
        createdAt: updated.created_at.toISOString(),
        updatedAt: updated.updated_at.toISOString(),
      });
    }
  );

  // Delete group
  app.delete(
    '/groups/:groupId',
    {
      schema: {
        tags: ['Internal - Groups'],
        summary: '[Internal] Delete a group',
        description: 'Internal endpoint for deleting groups. Requires Auth0 authentication.',
        params: zodToJsonSchemaFastify(z.object({ groupId: z.string().min(4) })),
        response: {
          200: zodToJsonSchemaFastify(z.object({ success: z.boolean() })),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Verify Auth0 access token and get user's sub
      const auth = await requireAuth(request, reply);
      const { groupId } = request.params as { groupId: string };

      // auth.sub is guaranteed to exist from requireAuth
      const userId = auth.sub;

      // Find or create user using the sub from token
      let user = await db.users.findFirst({
        where: {
          OR: [{ email: auth.email as string }, { id: userId }],
        },
      });

      if (!user) {
        user = await db.users.create({
          data: {
            id: userId, // Use Auth0 sub as the user ID
            email: auth.email as string,
            name: auth.name as string | undefined,
          },
        });
      }

      const group = await db.groups.findFirst({
        where: {
          id: groupId,
          owner_id: user.id, // Use the user ID (which is the Auth0 sub)
        },
      });

      if (!group) {
        reply.code(404);
        throw new Error('Group not found');
      }

      await db.groups.delete({
        where: { id: groupId },
      });

      reply.send({ success: true });
    }
  );

  // Join request endpoint (public but moved here for organization)
  app.post(
    '/groups/:groupId/join',
    {
      schema: {
        tags: ['Internal - Groups'],
        summary: '[Internal] Submit a join request for a group',
        description: 'Internal endpoint for group join requests. Requires Auth0 authentication.',
        params: zodToJsonSchemaFastify(z.object({ groupId: z.string().min(4) })),
        body: zodToJsonSchemaFastify(
          z.object({
            email: z.string().email(),
            reason: z.string().max(500).optional(),
          })
        ),
        response: {
          202: zodToJsonSchemaFastify(
            z.object({ status: z.literal('pending'), memberId: z.string() })
          ),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { groupId } = request.params as { groupId: string };
      const body = request.body as { email: string; reason?: string };

      // Verify group exists
      const group = await db.groups.findUnique({ where: { id: groupId } });
      if (!group) {
        reply.code(404);
        throw new Error('Group not found');
      }

      // Find or create user
      let user = await db.users.findUnique({ where: { email: body.email } });
      if (!user) {
        user = await db.users.create({
          data: { email: body.email },
        });
      }

      // Create or update membership
      const member = await db.group_members.upsert({
        where: {
          group_id_user_id: {
            group_id: groupId,
            user_id: user.id,
          },
        },
        create: {
          group_id: groupId,
          user_id: user.id,
          status: 'pending',
        },
        update: {
          status: 'pending',
        },
      });

      reply.code(202).send({ status: 'pending', memberId: member.id });
    }
  );
}

