import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma as db } from '../../db.js';
import { createApiKey } from '../../services/api-keys.js';
import { requireAuth } from '../../utils/auth.js';
import { findOrCreateUser } from '../../utils/user-helpers.js';
import { zodToJsonSchemaFastify } from '../../utils/zod-to-json-schema.js';

const apiKeyResponse = z.object({
  id: z.string(),
  label: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});

/**
 * Internal routes for API key management
 * These are only accessible to authenticated users via Auth0 (your Next.js frontend)
 * NOT exposed in the public npm package
 */
export async function registerInternalApiKeyRoutes(app: FastifyInstance): Promise<void> {
  // Create API key for a group
  app.post(
    '/api-keys',
    {
      schema: {
        tags: ['Internal - API Keys'],
        summary: '[Internal] Issue a new API key for a group',
        description: 'Internal endpoint for creating API keys. Requires Auth0 authentication.',
        body: zodToJsonSchemaFastify(
          z.object({
            groupId: z.string().min(4),
            label: z.string().min(3),
          })
        ),
        response: {
          201: zodToJsonSchemaFastify(z.object({ apiKey: z.string() })),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Verify Auth0 access token and get user's sub
      const auth = await requireAuth(request, reply);
      const body = request.body as { groupId: string; label: string };

      // auth.sub is guaranteed to exist from requireAuth
      const userId = auth.sub;

      // Find or create user in database using the sub from token
      const user = await findOrCreateUser(userId, auth.email, auth.name);

      // Upsert group - create if it doesn't exist, otherwise verify ownership
      let group = await db.groups.findFirst({
        where: {
          id: body.groupId,
          owner_id: user.id, // Use the user ID (which is the Auth0 sub)
        },
      });

      if (!group) {
        // Check if group exists but is owned by someone else
        const existingGroup = await db.groups.findUnique({
          where: { id: body.groupId },
        });

        if (existingGroup) {
          reply.code(403);
          throw new Error(
            'Group exists but you do not have permission to create API keys for this group'
          );
        }

        // Create the group if it doesn't exist
        group = await db.groups.create({
          data: {
            id: body.groupId,
            name: `Group ${body.groupId}`, // Default name, can be updated later
            owner_id: user.id,
          },
        });
      }

      // Issue API key for the user (identified by their Auth0 sub)
      const apiKey = await createApiKey(group.id, body.label, user.id);
      reply.code(201).send({ apiKey });
    }
  );

  // List API keys for a group
  app.get(
    '/api-keys',
    {
      schema: {
        tags: ['Internal - API Keys'],
        summary: '[Internal] List API keys for your groups',
        description: 'Internal endpoint for listing API keys. Requires Auth0 authentication.',
        querystring: zodToJsonSchemaFastify(
          z.object({
            groupId: z.string().min(4).optional(),
          })
        ),
        response: {
          200: zodToJsonSchemaFastify(z.object({ items: z.array(apiKeyResponse) })),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Verify Auth0 access token and get user's sub
      const auth = await requireAuth(request, reply);
      const { groupId } = request.query as { groupId?: string };

      // auth.sub is guaranteed to exist from requireAuth
      const userId = auth.sub;

      // Find or create user using the sub from token
      const user = await findOrCreateUser(userId, auth.email, auth.name);

      const where: { group_id?: string; revoked_at: null } = { revoked_at: null };
      if (groupId) {
        // Verify user owns the group (using sub from token)
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

        where.group_id = groupId;
      } else {
        // Get all groups owned by user (using sub from token), then get their API keys
        const userGroups = await db.groups.findMany({
          where: { owner_id: user.id }, // Use the user ID (which is the Auth0 sub)
          select: { id: true },
        });

        const groupIds = userGroups.map((g: { id: string }) => g.id);
        if (groupIds.length === 0) {
          reply.send({ items: [] });
          return;
        }

        const rows = await db.api_keys.findMany({
          where: {
            group_id: { in: groupIds },
            revoked_at: null,
          },
        });

        reply.send({
          items: rows.map(
            (row: { id: string; label: string; created_at: Date; last_used_at: Date | null }) => ({
              id: row.id,
              label: row.label,
              createdAt: row.created_at.toISOString(),
              lastUsedAt: row.last_used_at?.toISOString() ?? null,
            })
          ),
        });
        return;
      }

      const rows = await db.api_keys.findMany({ where });

      reply.send({
        items: rows.map(
          (row: { id: string; label: string; created_at: Date; last_used_at: Date | null }) => ({
            id: row.id,
            label: row.label,
            createdAt: row.created_at.toISOString(),
            lastUsedAt: row.last_used_at?.toISOString() ?? null,
          })
        ),
      });
    }
  );

  // Revoke API key
  app.delete(
    '/api-keys/:keyId',
    {
      schema: {
        tags: ['Internal - API Keys'],
        summary: '[Internal] Revoke an API key',
        description: 'Internal endpoint for revoking API keys. Requires Auth0 authentication.',
        params: zodToJsonSchemaFastify(z.object({ keyId: z.string().min(1) })),
        response: {
          200: zodToJsonSchemaFastify(z.object({ success: z.boolean() })),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Verify Auth0 access token and get user's sub
        const auth = await requireAuth(request, reply);
        const { keyId } = request.params as { keyId: string };

        request.log.info({ keyId }, 'Attempting to revoke API key');

        // auth.sub is guaranteed to exist from requireAuth
        const userId = auth.sub;

        // Find or create user using the sub from token
        const user = await findOrCreateUser(userId, auth.email, auth.name);

        // Find API key and verify ownership
        const apiKey = await db.api_keys.findFirst({
          where: { id: keyId },
          include: { groups: true },
        });

        if (!apiKey) {
          request.log.warn({ keyId }, 'API key not found');
          reply.code(404);
          throw new Error('API key not found');
        }

        request.log.info(
          { keyId, groupOwnerId: apiKey.groups.owner_id, userId: user.id },
          'Checking API key ownership'
        );

        // Verify user owns the group (using sub from token)
        if (apiKey.groups.owner_id !== user.id) {
          request.log.warn(
            { keyId, groupOwnerId: apiKey.groups.owner_id, userId: user.id },
            'Permission denied: user does not own the group'
          );
          reply.code(403);
          throw new Error('You do not have permission to revoke this API key');
        }

        // Check if already revoked (if using soft delete) or deleted
        if (apiKey.revoked_at) {
          request.log.info(
            { keyId, revokedAt: apiKey.revoked_at },
            'API key already revoked, deleting from database'
          );
          // If already revoked, just delete it
          await db.api_keys.delete({
            where: { id: keyId },
          });
          request.log.info({ keyId }, 'API key deleted from database');
          return reply.send({
            success: true,
            message: 'API key was already revoked and has been deleted',
          });
        }

        // Hard delete: Actually remove the key from the database
        await db.api_keys.delete({
          where: { id: keyId },
        });

        request.log.info({ keyId }, 'API key deleted from database');

        reply.send({ success: true });
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        request.log.error({ error: errorMessage, stack: errorStack }, 'Error revoking API key');
        throw error;
      }
    }
  );
}
