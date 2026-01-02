import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma as db } from '../../db.js';
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
 * Public routes for groups
 * These are unprotected and accessible without authentication
 */
export async function registerPublicGroupRoutes(app: FastifyInstance): Promise<void> {
  // List all groups (unprotected)
  app.get(
    '/groups',
    {
      schema: {
        tags: ['Groups'],
        summary: 'List all groups',
        description: 'Public endpoint to list all groups. No authentication required.',
        querystring: zodToJsonSchemaFastify(
          z.object({
            limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
            offset: z.coerce.number().int().min(0).default(0).optional(),
            search: z.string().max(100).optional(),
          })
        ),
        response: {
          200: zodToJsonSchemaFastify(
            z.object({
              items: z.array(groupResponse),
              total: z.number(),
              limit: z.number(),
              offset: z.number(),
            })
          ),
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as {
        limit?: number;
        offset?: number;
        search?: string;
      };

      const limit = query.limit ?? 50;
      const offset = query.offset ?? 0;
      const search = query.search;

      const where = search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { description: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {};

      const [rows, total] = await Promise.all([
        db.groups.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: { created_at: 'desc' },
        }),
        db.groups.count({ where }),
      ]);

      reply.send({
        items: rows.map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description ?? null,
          apiBaseUrl: row.api_base_url ?? null,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        })),
        total,
        limit,
        offset,
      });
    }
  );

  // Get single group by ID (unprotected)
  app.get(
    '/groups/:groupId',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Get a group by ID',
        description: 'Public endpoint to get group details. No authentication required.',
        params: zodToJsonSchemaFastify(z.object({ groupId: z.string().min(4) })),
        response: {
          200: zodToJsonSchemaFastify(groupResponse),
          404: zodToJsonSchemaFastify(z.object({ error: z.string() })),
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { groupId } = request.params as { groupId: string };

      const group = await db.groups.findUnique({
        where: { id: groupId },
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
}
