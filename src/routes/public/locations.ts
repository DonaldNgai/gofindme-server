import type { FastifyInstance, FastifyReply, FastifyRequest, FastifySchema } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { prisma as db } from '../../db.js';
import { locationBus } from '../../services/bus.js';
import { locationBatcher } from '../../services/location-batcher.js';
import { requireApiKey } from '../../utils/api-key.js';
import { requireAuth } from '../../utils/auth.js';
import { zodToJsonSchemaFastify } from '../../utils/zod-to-json-schema.js';

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
  groupIds: z.array(z.string().min(4)).optional(), // Optional: specify which groups this location is for
});

const ingestionResponse = z.object({
  id: z.string(),
  receivedAt: z.string(),
});

const KEEPALIVE_MS = 15000;

type DocumentedSchema = FastifySchema & {
  tags?: string[];
  security?: Array<Record<string, unknown>>;
};

/**
 * Public routes for location tracking
 *
 * Location submission flow (batched - bus schedule style):
 * 1. User submits location with Auth0 access token
 * 2. Token identifies the user (auth.sub = userId)
 * 3. Optionally specify groupIds in payload, otherwise uses all authorized groups
 * 4. Location is stored once in database
 * 5. Location is queued for batching per group with configured update frequencies
 * 6. Batcher publishes updates at scheduled intervals (like a bus schedule)
 * 7. Only API keys assigned to those groups receive notifications via SSE stream
 *
 * Batching:
 * - Different groups can have different update frequencies (e.g., 30s, 1m, 5m)
 * - Updates are batched and published at scheduled intervals
 * - Only the latest location per user/device is kept in each group's queue
 *
 * Stream subscription:
 * - Requires API key authentication (developer apps)
 * - Apps subscribe to their assigned group's events
 * - They only receive location updates for users in their group
 */
export async function registerPublicLocationRoutes(app: FastifyInstance) {
  // Submit location update
  app.post(
    '/locations',
    {
      schema: {
        tags: ['Locations'],
        summary: 'Submit a device location update',
        description:
          'Endpoint for users to submit their location data. Requires Auth0 authentication.',
        body: zodToJsonSchemaFastify(locationPayload),
        response: { 202: zodToJsonSchemaFastify(ingestionResponse) },
        security: [{ bearerAuth: [] }],
      } as DocumentedSchema,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const body = locationPayload.parse(request.body);

      // Find or create user from Auth0 token
      let user = await db.users.findFirst({
        where: {
          OR: [{ email: auth.email as string }, { id: auth.sub }],
        },
      });

      if (!user && auth.email) {
        user = await db.users.create({
          data: {
            id: auth.sub,
            email: auth.email as string,
            name: auth.name as string | undefined,
          },
        });
      } else if (user && user.id !== auth.sub) {
        // Update user ID to match Auth0 sub if different
        user = await db.users.update({
          where: { id: user.id },
          data: { id: auth.sub },
        });
      }

      // The Auth0 token identifies the user (auth.sub is the user ID)
      const userId = user?.id ?? auth.sub;
      const deviceId = body.deviceId || userId; // Use userId as deviceId if not provided

      // Determine which groups this location update is for
      // If groupIds are specified in payload, use those; otherwise use all groups where user is a member
      let targetGroupIds: string[];
      
      if (body.groupIds && body.groupIds.length > 0) {
        // Validate that user is a member of all specified groups
        const memberships = await db.group_members.findMany({
          where: {
            user_id: userId,
            group_id: { in: body.groupIds },
            status: {
              not: 'pending', // Exclude pending memberships
            },
          },
        });
        
        const validGroupIds = memberships.map((m) => m.group_id);
        const invalidGroupIds = body.groupIds.filter((id: string) => !validGroupIds.includes(id));
        
        if (invalidGroupIds.length > 0) {
          reply.code(403);
          throw new Error(
            `User is not an active member of groups: ${invalidGroupIds.join(', ')}`
          );
        }
        
        targetGroupIds = validGroupIds;
      } else {
        // Fall back to all groups where user is an active member
        const memberships = await db.group_members.findMany({
          where: {
            user_id: userId,
            status: {
              not: 'pending', // Exclude pending memberships
            },
          },
          select: {
            group_id: true,
          },
        });
        
        targetGroupIds = memberships.map((m) => m.group_id);
        
        if (targetGroupIds.length === 0) {
          reply.code(403);
          throw new Error(
            'User is not a member of any groups. Join a group before submitting location data.'
          );
        }
      }

      // Get user's first group for storage (we still need a group_id for the location record)
      const userGroupMembership = await db.group_members.findFirst({
        where: {
          user_id: userId,
          status: {
            not: 'pending',
          },
        },
        orderBy: {
          created_at: 'asc',
        },
      });

      if (!userGroupMembership) {
        reply.code(403);
        throw new Error(
          'User is not a member of any groups. Join a group before submitting location data.'
        );
      }

      const payload = {
        id: nanoid(16),
        groupId: userGroupMembership.group_id, // For storage - location is stored with a group_id
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

      const record = await db.locations.create({
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

      // Queue location update for batching (bus schedule style)
      // Location data is ALWAYS saved to the database above, regardless of API keys
      // We queue for batching for all groups the user is a member of
      // If a group has no API keys/subscribers, the publish will simply have no listeners (that's fine)
      // Get active location shares to determine update frequencies (if they exist)
      const activeShares = await db.location_shares.findMany({
        where: {
          user_id: userId,
          group_id: { in: targetGroupIds },
          is_active: true,
        },
      });

      // Create location update payload for batching
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

      // Queue update for each target group with its configured frequency
      // This queues for ALL groups regardless of API keys - if no one is subscribed, publish just won't be received
      for (const groupId of targetGroupIds) {
        const share = activeShares.find((s) => s.group_id === groupId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // TypeScript might not recognize new fields until IDE reloads
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const frequencySeconds = (share as any)?.frequency ?? 30; // Default 30 seconds if not set
        
        locationBatcher.queueLocationUpdate(
          groupId,
          locationUpdatePayload,
          userId,
          deviceId,
          frequencySeconds
        );
      }

      reply.code(202).send({
        id: record.id,
        receivedAt: record.received_at?.toISOString() ?? new Date().toISOString(),
      });
    }
  );

  // Stream location events
  app.get(
    '/stream',
    {
      schema: {
        tags: ['Locations'],
        summary: 'Subscribe to live location events',
        description:
          'Public endpoint for streaming location updates. Requires API key authentication.',
        security: [{ apiKey: [] }],
      } as DocumentedSchema,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const apiKey = await requireApiKey(request, reply);
      openLocationStream(reply, apiKey.group_id);
    }
  );
}

function openLocationStream(reply: FastifyReply, groupId: string) {
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.setHeader('X-Accel-Buffering', 'no');

  reply.hijack();
  const res = reply.raw;

  const send = (event: string, data: Record<string, unknown>) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send('ready', { groupId });

  const unsubscribe = locationBus.subscribe(groupId, (event) => {
    send(event.type, event.data);
  });

  const heartbeat = setInterval(() => {
    send('heartbeat', { groupId, timestamp: new Date().toISOString() });
  }, KEEPALIVE_MS);
  heartbeat.unref?.();

  res.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
}
