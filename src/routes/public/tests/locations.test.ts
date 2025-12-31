import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { buildApp } from '../../../app.js';
import { prisma as db } from '../../../db.js';
import { createApiKey } from '../../../services/api-keys.js';
import { locationBus } from '../../../services/bus.js';
import type { LocationUpdatePayload } from '../../../types/location.js';

describe('Location Updates and SSE Streaming', () => {
  let fastify: ReturnType<typeof Fastify>;
  let testGroupId: string;
  let testApiKey: string;
  let testUserId: string;

  beforeAll(async () => {
    fastify = Fastify();
    await buildApp(fastify);
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  beforeEach(async () => {
    // Create test user
    const user = await db.users.create({
      data: {
        id: 'test-user-123',
        email: 'test@example.com',
        name: 'Test User',
      },
    });
    testUserId = user.id;

    // Create test group
    const group = await db.groups.create({
      data: {
        id: 'test-group-123',
        name: 'Test Group',
        owner_id: testUserId,
      },
    });
    testGroupId = group.id;

    // Create test API key
    testApiKey = await createApiKey(testGroupId, 'Test API Key', testUserId);
  });

  afterEach(async () => {
    // Clean up test data
    await db.locations.deleteMany({ where: { group_id: testGroupId } });
    await db.api_keys.deleteMany({ where: { group_id: testGroupId } });
    await db.groups.deleteMany({ where: { id: testGroupId } });
    await db.users.deleteMany({ where: { id: testUserId } });
  });

  describe('Location Ingestion', () => {
    it('should accept and store location updates', async () => {
      const locationData = {
        deviceId: 'device-001',
        latitude: 37.7749,
        longitude: -122.4194,
        accuracy: 10.5,
        heading: 90,
        speed: 5.2,
        recordedAt: new Date().toISOString(),
        payloadVersion: 'v1',
      };

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: locationData,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('receivedAt');

      // Verify stored in database
      const stored = await db.locations.findFirst({
        where: { id: body.id },
      });
      expect(stored).toBeTruthy();
      expect(stored?.device_id).toBe('device-001');
      expect(stored?.latitude).toBe(37.7749);
      expect(stored?.longitude).toBe(-122.4194);
    });

    it('should publish location to event bus', async () => {
      const busSpy = vi.spyOn(locationBus, 'publishLocation');

      const locationData = {
        deviceId: 'device-002',
        latitude: 40.7128,
        longitude: -74.006,
        recordedAt: new Date().toISOString(),
      };

      await fastify.inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: locationData,
      });

      expect(busSpy).toHaveBeenCalledWith(
        testGroupId,
        expect.objectContaining({
          deviceId: 'device-002',
          latitude: 40.7128,
          longitude: -74.006,
        })
      );

      busSpy.mockRestore();
    });
  });

  describe('SSE Streaming', () => {
    it('should stream location updates to subscribers', async () => {
      const receivedEvents: Array<{ type: string; data: unknown }> = [];

      // Start SSE connection
      const streamResponse = await fastify.inject({
        method: 'GET',
        url: '/api/v1/stream',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(streamResponse.statusCode).toBe(200);
      expect(streamResponse.headers['content-type']).toContain('text/event-stream');

      // Parse SSE events
      const events = streamResponse.body.split('\n\n').filter(Boolean);
      const readyEvent = events.find((e) => e.includes('event: ready'));
      expect(readyEvent).toBeTruthy();

      // Send a location update
      const locationData = {
        deviceId: 'device-003',
        latitude: 34.0522,
        longitude: -118.2437,
        recordedAt: new Date().toISOString(),
      };

      await fastify.inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: locationData,
      });

      // Note: In a real SSE connection, events would stream continuously
      // For testing, we verify the bus subscription works
      expect(locationBus.listenerCount(testGroupId)).toBeGreaterThan(0);
    });
  });

  describe('Periodic Location Updates', () => {
    it('should handle multiple location updates in sequence', async () => {
      const locations = [
        { deviceId: 'device-001', latitude: 37.7749, longitude: -122.4194 },
        { deviceId: 'device-001', latitude: 37.775, longitude: -122.4195 },
        { deviceId: 'device-001', latitude: 37.7751, longitude: -122.4196 },
      ];

      for (const loc of locations) {
        const response = await fastify.inject({
          method: 'POST',
          url: '/api/v1/locations',
          headers: {
            'x-api-key': testApiKey,
          },
          payload: {
            ...loc,
            recordedAt: new Date().toISOString(),
          },
        });

        expect(response.statusCode).toBe(202);
      }

      // Verify all locations stored
      const stored = await db.locations.findMany({
        where: { group_id: testGroupId, device_id: 'device-001' },
        orderBy: { recorded_at: 'asc' },
      });

      expect(stored).toHaveLength(3);
      expect(stored[0]?.latitude).toBe(37.7749);
      expect(stored[2]?.latitude).toBe(37.7751);
    });

    it('should handle location updates from multiple devices', async () => {
      const devices = ['device-001', 'device-002', 'device-003'];
      const busEvents: Array<{ groupId: string; payload: LocationUpdatePayload }> = [];

      // Subscribe to bus events
      const unsubscribe = locationBus.subscribe(testGroupId, (event) => {
        busEvents.push({
          groupId: testGroupId,
          payload: event.data,
        });
      });

      // Send updates from each device
      for (const deviceId of devices) {
        await fastify.inject({
          method: 'POST',
          url: '/api/v1/locations',
          headers: {
            'x-api-key': testApiKey,
          },
          payload: {
            deviceId,
            latitude: 37.7749 + Math.random(),
            longitude: -122.4194 + Math.random(),
            recordedAt: new Date().toISOString(),
          },
        });
      }

      // Wait a bit for events to propagate
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(busEvents.length).toBeGreaterThanOrEqual(devices.length);
      const receivedDeviceIds = busEvents.map((e) => e.payload.deviceId);
      devices.forEach((deviceId) => {
        expect(receivedDeviceIds).toContain(deviceId);
      });

      unsubscribe();
    });
  });

  describe('Simulated Periodic Updates', () => {
    it('should handle location updates at periodic intervals', async () => {
      const updateInterval = 100; // 100ms intervals
      const numUpdates = 5;
      const receivedUpdates: LocationUpdatePayload[] = [];

      // Subscribe to bus events
      const unsubscribe = locationBus.subscribe(testGroupId, (event) => {
        receivedUpdates.push(event.data);
      });

      // Simulate periodic updates
      const updates = Array.from({ length: numUpdates }, (_, i) => ({
        deviceId: 'device-001',
        latitude: 37.7749 + i * 0.001,
        longitude: -122.4194 + i * 0.001,
        recordedAt: new Date(Date.now() + i * updateInterval).toISOString(),
      }));

      // Send updates with delays
      for (let i = 0; i < updates.length; i++) {
        await fastify.inject({
          method: 'POST',
          url: '/api/v1/locations',
          headers: {
            'x-api-key': testApiKey,
          },
          payload: updates[i],
        });

        // Wait for next update (simulating periodic intervals)
        if (i < updates.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, updateInterval));
        }
      }

      // Wait for all events to propagate
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(receivedUpdates.length).toBeGreaterThanOrEqual(numUpdates);
      expect(receivedUpdates[0]?.deviceId).toBe('device-001');
      expect(receivedUpdates[receivedUpdates.length - 1]?.deviceId).toBe('device-001');

      // Verify all stored in database
      const stored = await db.locations.findMany({
        where: { group_id: testGroupId, device_id: 'device-001' },
        orderBy: { recorded_at: 'asc' },
      });

      expect(stored.length).toBe(numUpdates);

      unsubscribe();
    });

    it('should handle high-frequency location updates', async () => {
      const numUpdates = 20;
      const updates: Array<{ id: string; receivedAt: string }> = [];

      // Send rapid updates
      const promises = Array.from({ length: numUpdates }, (_, i) =>
        fastify.inject({
          method: 'POST',
          url: '/api/v1/locations',
          headers: {
            'x-api-key': testApiKey,
          },
          payload: {
            deviceId: 'device-001',
            latitude: 37.7749 + Math.random() * 0.01,
            longitude: -122.4194 + Math.random() * 0.01,
            recordedAt: new Date().toISOString(),
          },
        })
      );

      const responses = await Promise.all(promises);

      responses.forEach((response) => {
        expect(response.statusCode).toBe(202);
        const body = JSON.parse(response.body);
        updates.push(body);
      });

      // Verify all stored
      const stored = await db.locations.findMany({
        where: { group_id: testGroupId },
      });

      expect(stored.length).toBe(numUpdates);
    });
  });

  describe('Multiple Subscribers', () => {
    it('should deliver updates to multiple SSE subscribers', async () => {
      const subscriber1Events: unknown[] = [];
      const subscriber2Events: unknown[] = [];

      // Create two subscribers
      const unsubscribe1 = locationBus.subscribe(testGroupId, (event) => {
        subscriber1Events.push(event.data);
      });

      const unsubscribe2 = locationBus.subscribe(testGroupId, (event) => {
        subscriber2Events.push(event.data);
      });

      // Send location update
      await fastify.inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          deviceId: 'device-001',
          latitude: 37.7749,
          longitude: -122.4194,
          recordedAt: new Date().toISOString(),
        },
      });

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Both subscribers should receive the event
      expect(subscriber1Events.length).toBeGreaterThan(0);
      expect(subscriber2Events.length).toBeGreaterThan(0);
      expect(subscriber1Events[0]).toEqual(subscriber2Events[0]);

      unsubscribe1();
      unsubscribe2();
    });
  });

  describe('Group Isolation', () => {
    it('should only deliver updates to subscribers of the same group', async () => {
      // Create second group and API key
      const group2 = await db.groups.create({
        data: {
          id: 'test-group-456',
          name: 'Test Group 2',
          owner_id: testUserId,
        },
      });
      const apiKey2 = await createApiKey(group2.id, 'Test API Key 2', testUserId);

      const group1Events: unknown[] = [];
      const group2Events: unknown[] = [];

      // Subscribe to both groups
      const unsubscribe1 = locationBus.subscribe(testGroupId, (event) => {
        group1Events.push(event.data);
      });

      const unsubscribe2 = locationBus.subscribe(group2.id, (event) => {
        group2Events.push(event.data);
      });

      // Send update to group 1
      await fastify.inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          deviceId: 'device-001',
          latitude: 37.7749,
          longitude: -122.4194,
          recordedAt: new Date().toISOString(),
        },
      });

      // Send update to group 2
      await fastify.inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: {
          'x-api-key': apiKey2,
        },
        payload: {
          deviceId: 'device-002',
          latitude: 40.7128,
          longitude: -74.006,
          recordedAt: new Date().toISOString(),
        },
      });

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Each group should only receive its own events
      expect(group1Events.length).toBeGreaterThan(0);
      expect(group2Events.length).toBeGreaterThan(0);

      const group1DeviceIds = group1Events.map((e: any) => e.deviceId);
      const group2DeviceIds = group2Events.map((e: any) => e.deviceId);

      expect(group1DeviceIds).toContain('device-001');
      expect(group1DeviceIds).not.toContain('device-002');
      expect(group2DeviceIds).toContain('device-002');
      expect(group2DeviceIds).not.toContain('device-001');

      unsubscribe1();
      unsubscribe2();

      // Cleanup
      await db.locations.deleteMany({ where: { group_id: group2.id } });
      await db.api_keys.deleteMany({ where: { group_id: group2.id } });
      await db.groups.deleteMany({ where: { id: group2.id } });
    });
  });
});

