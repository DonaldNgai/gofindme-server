import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma as db } from "../db.js";
import { requireAuth } from "../utils/auth.js";
import { zodToJsonSchemaFastify } from "../utils/zod-to-json-schema.js";

const groupResponse = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  apiBaseUrl: z.string().nullable(),
  createdAt: z.string(),
});

export async function registerGroupRoutes(app: FastifyInstance) {
  app.post(
    "/groups",
    {
      schema: {
        tags: ["Groups"],
        summary: "Create a new location group",
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
      },
    },
  async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const body = request.body as { name: string; description?: string; apiBaseUrl?: string };
      const ownerId = auth.sub ?? "anonymous";

      // Find or create user
      let user = await db.users.findUnique({ where: { email: auth.email as string } });
      if (!user && auth.email) {
        user = await db.users.create({
          data: {
            email: auth.email as string,
            name: auth.name as string | undefined,
          },
        });
      }

      const record = await db.groups.create({
        data: {
          name: body.name,
          description: body.description,
          api_base_url: body.apiBaseUrl,
          owner_id: user?.id ?? ownerId,
        },
      });

      reply.code(201).send({
        id: record.id,
        name: record.name,
        description: record.description ?? null,
        apiBaseUrl: record.api_base_url ?? null,
        createdAt: record.created_at.toISOString(),
      });
    }
  );

  app.get(
    "/groups",
    {
      schema: {
        tags: ["Groups"],
        summary: "List groups you own",
        response: {
          200: zodToJsonSchemaFastify(z.object({ items: z.array(groupResponse) })),
        },
      },
    },
  async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const ownerId = auth.sub ?? "anonymous";

      // Find user by email or sub
      let user = await db.users.findFirst({
        where: {
          OR: [{ email: auth.email as string }, { id: ownerId }],
        },
      });

      if (!user && auth.email) {
        user = await db.users.create({
          data: {
            email: auth.email as string,
            name: auth.name as string | undefined,
          },
        });
      }

      const rows = await db.groups.findMany({
        where: { owner_id: user?.id ?? ownerId },
      });

      reply.send({
        items: rows.map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description ?? null,
          apiBaseUrl: row.api_base_url ?? null,
          createdAt: row.created_at.toISOString(),
        })),
      });
    }
  );

  app.post(
    "/groups/:groupId/join",
    {
      schema: {
        tags: ["Groups"],
        summary: "Submit a join request for a group",
        params: zodToJsonSchemaFastify(z.object({ groupId: z.string().min(4) })),
        body: zodToJsonSchemaFastify(
          z.object({
            email: z.string().email(),
            reason: z.string().max(500).optional(),
          })
        ),
        response: {
          202: zodToJsonSchemaFastify(
            z.object({ status: z.literal("pending"), memberId: z.string() })
          ),
        },
      },
    },
  async (request: FastifyRequest, reply: FastifyReply) => {
      const { groupId } = request.params as { groupId: string };
      const body = request.body as { email: string; reason?: string };

      // Verify group exists
      const group = await db.groups.findUnique({ where: { id: groupId } });
      if (!group) {
        reply.code(404);
        throw new Error("Group not found");
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
          status: "pending",
        },
        update: {
          status: "pending",
        },
      });

      reply.code(202).send({ status: "pending", memberId: member.id });
    }
  );
}
