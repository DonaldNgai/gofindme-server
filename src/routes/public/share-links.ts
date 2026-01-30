import type { FastifyInstance, FastifyReply, FastifyRequest, FastifySchema } from 'fastify';
import { z } from 'zod';
import { resolveShareLink } from '../../services/share-links.js';
import { zodToJsonSchemaFastify } from '../../utils/zod-to-json-schema.js';

type DocumentedSchema = FastifySchema & {
  tags?: string[];
  security?: Array<Record<string, unknown>>;
};

const shareLinkInfoResponse = z.object({
  groupId: z.string(),
  groupName: z.string(),
  reason: z.string().nullable(),
  expiresAt: z.string().nullable(),
});

export async function registerShareLinkPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/share-links/:token',
    {
      schema: {
        tags: ['Share Links'],
        summary: 'Get share link info',
        description:
          'Query information for a share token: which group it is for and the reason for the request. ' +
          'Use the token in X-Location-Token or Authorization: Bearer when submitting locations.',
        params: zodToJsonSchemaFastify(z.object({ token: z.string().min(1) })),
        response: {
          200: zodToJsonSchemaFastify(shareLinkInfoResponse),
          404: zodToJsonSchemaFastify(z.object({ error: z.string() })),
        },
      } as DocumentedSchema,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token } = request.params as { token: string };
      const info = await resolveShareLink(token);

      if (!info) {
        reply.code(404).send({ error: 'Share link not found or expired' });
        return;
      }

      reply.send({
        groupId: info.groupId,
        groupName: info.groupName,
        reason: info.reason,
        expiresAt: info.expiresAt?.toISOString() ?? null,
      });
    }
  );
}
