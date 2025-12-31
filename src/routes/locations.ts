import type { FastifyInstance, FastifyReply, FastifyRequest, FastifySchema } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { prisma as db } from "../db.js";
import { locationBus } from "../services/bus.js";
import { findAuthorizedGroups } from "../services/location-auth.js";
import { requireApiKey } from "../utils/api-key.js";
import { zodToJsonSchemaFastify } from "../utils/zod-to-json-schema.js";

const locationPayload = z.object({
  deviceId: z.string().min(3).max(128),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  accuracy: z.number().nonnegative().optional(),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).optional(),
  recordedAt: z.coerce.date(),
  payloadVersion: z.string().default("v1"),
  metadata: z.record(z.any()).optional(),
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

export async function registerLocationRoutes(app: FastifyInstance) {
  app.post(
    "/locations",
    {
      schema: {
        tags: ["Locations"],
        summary: "Submit a device location update",
        body: zodToJsonSchemaFastify(locationPayload),
        response: { 202: zodToJsonSchemaFastify(ingestionResponse) },
        security: [{ apiKey: [] }],
      } as DocumentedSchema,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const apiKey = await requireApiKey(request, reply);
      const body = locationPayload.parse(request.body);

      const payload = {
        id: nanoid(16),
        groupId: apiKey.group_id,
        deviceId: body.deviceId,
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

      // Find all groups that are authorized to receive this location update
      // Only groups where the user (deviceId) is a member AND have active API keys
      const authorizedGroups = await findAuthorizedGroups(body.deviceId, apiKey.user_id);
      
      // Publish to all authorized groups (not just the API key's group)
      if (authorizedGroups.length > 0) {
        locationBus.publishLocationToGroups(authorizedGroups, {
          deviceId: body.deviceId,
          latitude: body.latitude,
          longitude: body.longitude,
          accuracy: body.accuracy ?? null,
          heading: body.heading ?? null,
          speed: body.speed ?? null,
          recordedAt: body.recordedAt,
          metadata: body.metadata ?? null,
          payloadVersion: body.payloadVersion,
        });
      }

      reply.code(202).send({
        id: record.id,
        receivedAt: record.received_at?.toISOString() ?? new Date().toISOString(),
      });
    }
  );

  app.get(
    "/stream",
    {
      schema: {
        tags: ["Locations"],
        summary: "Subscribe to live location events",
        security: [{ apiKey: [] }],
      } as DocumentedSchema,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const apiKey = await requireApiKey(request, reply);
      openLocationStream(reply, apiKey.groupId);
    }
  );
}

function openLocationStream(reply: FastifyReply, groupId: string) {
  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.setHeader("X-Accel-Buffering", "no");

  reply.hijack();
  const res = reply.raw;

  const send = (event: string, data: Record<string, unknown>) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send("ready", { groupId });

  const unsubscribe = locationBus.subscribe(groupId, (event) => {
    send(event.type, event.data);
  });

  const heartbeat = setInterval(() => {
    send("heartbeat", { groupId, timestamp: new Date().toISOString() });
  }, KEEPALIVE_MS);
  heartbeat.unref?.();

  res.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
}
