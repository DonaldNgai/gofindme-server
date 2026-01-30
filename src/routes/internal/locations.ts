import type { FastifyInstance, FastifyReply, FastifyRequest, FastifySchema } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { prisma as db } from '../../db.js';
import { env } from '../../config/env.js';
import { locationBus } from '../../services/bus.js';
import { locationBatcher } from '../../services/location-batcher.js';
import { validateShareLink } from '../../services/share-links.js';
import { decryptWithSecret } from '../../utils/encrypt.js';
import { zodToJsonSchemaFastify } from '../../utils/zod-to-json-schema.js';

const LOCATION_TOKEN_HEADER = 'x-location-token';

const locationPayload = z.object({
  deviceId: z.string().min(3).max(128),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  accuracy: z.number().nonnegative().optional(),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).optional(),
  recordedAt: z.coerce.date(),
  payloadVersion: z.string().default('v1'),
  metadata: z.record(z.any()).optional(),
});

const ingestionResponse = z.object({
  id: z.string(),
  receivedAt: z.string(),
});

type DocumentedSchema = FastifySchema & {
  tags?: string[];
};

function getSecret(reply: FastifyReply): string {
  const secret = env.FRONTEND_APP_SECRET;
  if (!secret) {
    reply.code(503).send({
      error: 'Location submission via app secret is not configured (FRONTEND_APP_SECRET)',
    });
    throw new Error('FRONTEND_APP_SECRET not configured');
  }
  return secret;
}

export async function registerInternalLocationRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/locations',
    {
      schema: {
        tags: ['Internal - Locations'],
        summary: '[Internal] Submit location via app secret + share token',
        description:
          'Submit a device location for the frontend app. The frontend encrypts the share token using the shared secret (FRONTEND_APP_SECRET) and sends the encrypted value. ' +
          'Backend decrypts with the same secret and validates the share token exists before proceeding. ' +
          'Provide encrypted share token via X-Location-Token header or encryptedShareToken in body. ' +
          'Encryption: AES-256-GCM, key = SHA-256(secret), payload = base64url(iv + ciphertext + authTag).',
        body: zodToJsonSchemaFastify(
          locationPayload.and(
            z.object({
              encryptedShareToken: z.string().min(1).optional().describe('Encrypted share token (alternative: X-Location-Token header)'),
            })
          )
        ),
        response: {
          202: zodToJsonSchemaFastify(ingestionResponse),
          400: zodToJsonSchemaFastify(z.object({ error: z.string() })),
          401: zodToJsonSchemaFastify(z.object({ error: z.string() })),
          404: zodToJsonSchemaFastify(z.object({ error: z.string() })),
          503: zodToJsonSchemaFastify(z.object({ error: z.string() })),
        },
      } as DocumentedSchema,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      console.log('request.body', request.body);
      console.log('request.headers', request.headers);
      const secret = getSecret(reply);

      const rawBody = request.body as Record<string, unknown>;
      const encryptedToken =
        (typeof request.headers[LOCATION_TOKEN_HEADER] === 'string'
          ? request.headers[LOCATION_TOKEN_HEADER]
          : undefined) ??
        (typeof rawBody?.encryptedShareToken === 'string' ? rawBody.encryptedShareToken : undefined);

      if (!encryptedToken) {
        reply.code(400).send({
          error: 'Encrypted share token required. Provide X-Location-Token header or encryptedShareToken in body.',
        });
        return;
      }

      let shareToken: string;
      try {
        shareToken = decryptWithSecret(encryptedToken, secret);
      } catch {
        reply.code(401).send({ error: 'Invalid or corrupted encrypted token' });
        return;
      }

      const validation = await validateShareLink(shareToken);
      if (!validation.valid) {
        reply.code(404).send({ error: validation.reason });
        return;
      }

      const { groupId } = validation;
      const body = locationPayload.parse({
        deviceId: rawBody.deviceId,
        latitude: rawBody.latitude,
        longitude: rawBody.longitude,
        accuracy: rawBody.accuracy,
        heading: rawBody.heading,
        speed: rawBody.speed,
        recordedAt: rawBody.recordedAt,
        payloadVersion: rawBody.payloadVersion,
        metadata: rawBody.metadata,
      });

      const deviceId = body.deviceId;
      const payload = {
        id: nanoid(16),
        groupId,
        deviceId,
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy ?? null,
        heading: body.heading ?? null,
        speed: body.speed ?? null,
        recordedAt: body.recordedAt,
        payloadVersion: body.payloadVersion,
        metadata: body.metadata ? JSON.stringify(body.metadata) : null,
        receivedAt: new Date(),
      };

      await db.locations.create({
        data: {
          id: payload.id,
          group_id: payload.groupId,
          device_id: payload.deviceId,
          latitude: payload.latitude,
          longitude: payload.longitude,
          accuracy: payload.accuracy,
          heading: payload.heading,
          speed: payload.speed,
          recorded_at: payload.recordedAt,
          received_at: payload.receivedAt,
          payload_version: payload.payloadVersion,
          metadata: payload.metadata,
        },
      });

      const locationUpdatePayload = {
        deviceId: payload.deviceId,
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy ?? null,
        heading: body.heading ?? null,
        speed: body.speed ?? null,
        recordedAt: body.recordedAt,
        metadata: body.metadata ?? null,
        payloadVersion: body.payloadVersion,
      };

      locationBus.publishLocationToGroups([groupId], locationUpdatePayload);
      locationBatcher.queueLocationUpdate(
        groupId,
        locationUpdatePayload,
        deviceId,
        deviceId,
        30
      );

      reply.code(202).send({
        id: payload.id,
        receivedAt: payload.receivedAt.toISOString(),
      });
    }
  );
}
