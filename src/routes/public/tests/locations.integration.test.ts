import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { buildApp } from '../../../app.js';
import { prisma as db } from '../../../db.js';
import { createApiKey } from '../../../services/api-keys.js';
import { locationBus } from '../../../services/bus.js';

/**
 * Integration test that simulates a real-world scenario:
 * - Mobile app sending location updates periodically
 * - Developer app subscribing via SSE
 * - Verifying end-to-end data flow
 */
describe('Location Updates Integration - Periodic Updates', () => {
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
        id: 'integration-test-user',
        email: 'integration@example.com',
        name: 'Integration Test User',
      },
    });
    testUserId = user.id;

    // Create test group
    const group = await db.groups.create({
      data: {
        id: 'integration-test-group',
        name: 'Integration Test Group',
        owner_id: testUserId,
      },
    });
    testGroupId = group.id;

    // Create test API key
    testApiKey = await createApiKey(testGroupId, 'Integration Test API Key', testUserId);
  });

  afterEach(async () => {
    // Clean up test data
    await db.locations.deleteMany({ where: { group_id: testGroupId } });
    await db.api_keys.deleteMany({ where: { group_id: testGroupId } });
    await db.groups.deleteMany({ where: { id: testGroupId } });
    await db.users.deleteMany({ where: { id: testUserId } });
  });

  it('should simulate mobile app sending periodic location updates and developer app receiving them', async () => {
    // Simulate a mobile device moving along a path
    const route = [
      { lat: 37.7749, lng: -122.4194, time: 0 }, // Start: San Francisco
      { lat: 37.775, lng: -122.4195, time: 5000 }, // 5 seconds later
      { lat: 37.7751, lng: -122.4196, time: 10000 }, // 10 seconds later
      { lat: 37.7752, lng: -122.4197, time: 15000 }, // 15 seconds later
      { lat: 37.7753, lng: -122.4198, time: 20000 }, // 20 seconds later
    ];

    const receivedEvents: Array<{
      deviceId: string;
      latitude: number;
      longitude: number;
      recordedAt: Date;
    }> = [];

    // Developer app: Subscribe to location updates
    const unsubscribe = locationBus.subscribe(testGroupId, (event) => {
      receivedEvents.push({
        deviceId: event.data.deviceId,
        latitude: event.data.latitude,
        longitude: event.data.longitude,
        recordedAt: event.data.recordedAt,
      });
    });

    // Mobile app: Send location updates at periodic intervals
    const startTime = Date.now();
    const updatePromises = route.map((point, index) => {
      return new Promise<void>((resolve) => {
        setTimeout(async () => {
          const response = await fastify.inject({
            method: 'POST',
            url: '/api/v1/locations',
            headers: {
              'x-api-key': testApiKey,
            },
            payload: {
              deviceId: 'mobile-device-001',
              latitude: point.lat,
              longitude: point.lng,
              accuracy: 10,
              speed: 5.5,
              heading: 90,
              recordedAt: new Date(startTime + point.time).toISOString(),
              payloadVersion: 'v1',
            },
          });

          expect(response.statusCode).toBe(202);
          resolve();
        }, point.time);
      });
    });

    // Wait for all updates to be sent
    await Promise.all(updatePromises);

    // Wait a bit for events to propagate
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify developer app received all updates
    expect(receivedEvents.length).toBe(route.length);

    // Verify data integrity
    receivedEvents.forEach((event, index) => {
      expect(event.deviceId).toBe('mobile-device-001');
      expect(event.latitude).toBeCloseTo(route[index].lat, 4);
      expect(event.longitude).toBeCloseTo(route[index].lng, 4);
    });

    // Verify all stored in database
    const stored = await db.locations.findMany({
      where: { group_id: testGroupId, device_id: 'mobile-device-001' },
      orderBy: { recorded_at: 'asc' },
    });

    expect(stored.length).toBe(route.length);
    stored.forEach((location, index) => {
      expect(location.latitude).toBeCloseTo(route[index].lat, 4);
      expect(location.longitude).toBeCloseTo(route[index].lng, 4);
    });

    unsubscribe();
  });

  it('should handle multiple devices sending updates simultaneously', async () => {
    const devices = [
      { id: 'device-001', route: [{ lat: 37.7749, lng: -122.4194 }] },
      { id: 'device-002', route: [{ lat: 40.7128, lng: -74.006 }] },
      { id: 'device-003', route: [{ lat: 34.0522, lng: -118.2437 }] },
    ];

    const receivedEvents: Record<string, unknown[]> = {};

    // Subscribe to all device updates
    const unsubscribe = locationBus.subscribe(testGroupId, (event) => {
      const deviceId = event.data.deviceId;
      if (!receivedEvents[deviceId]) {
        receivedEvents[deviceId] = [];
      }
      receivedEvents[deviceId].push(event.data);
    });

    // Send updates from all devices simultaneously
    const updatePromises = devices.flatMap((device) =>
      device.route.map((point) =>
        fastify.inject({
          method: 'POST',
          url: '/api/v1/locations',
          headers: {
            'x-api-key': testApiKey,
          },
          payload: {
            deviceId: device.id,
            latitude: point.lat,
            longitude: point.lng,
            recordedAt: new Date().toISOString(),
          },
        })
      )
    );

    await Promise.all(updatePromises);

    // Wait for events
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify all devices' updates were received
    devices.forEach((device) => {
      expect(receivedEvents[device.id]).toBeDefined();
      expect(receivedEvents[device.id].length).toBeGreaterThan(0);
    });

    // Verify all stored in database
    const stored = await db.locations.findMany({
      where: { group_id: testGroupId },
    });

    expect(stored.length).toBe(devices.length);
    devices.forEach((device) => {
      const deviceLocations = stored.filter((loc) => loc.device_id === device.id);
      expect(deviceLocations.length).toBe(1);
    });

    unsubscribe();
  });

  it('should handle high-frequency updates (GPS-like frequency)', async () => {
    // Simulate GPS sending updates every second for 10 seconds
    const numUpdates = 10;
    const updateInterval = 100; // 100ms for faster test execution
    const receivedEvents: unknown[] = [];

    const unsubscribe = locationBus.subscribe(testGroupId, (event) => {
      receivedEvents.push(event.data);
    });

    const startTime = Date.now();
    const updates = Array.from({ length: numUpdates }, (_, i) => ({
      deviceId: 'gps-device-001',
      latitude: 37.7749 + (i * 0.0001), // Moving north
      longitude: -122.4194 + (i * 0.0001), // Moving east
      accuracy: 5,
      speed: 10 + i * 0.5,
      heading: 45,
      recordedAt: new Date(startTime + i * updateInterval).toISOString(),
    }));

    // Send updates with intervals
    for (let i = 0; i < updates.length; i++) {
      await fastify.inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: updates[i],
      });

      if (i < updates.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, updateInterval));
      }
    }

    // Wait for all events
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify all updates received
    expect(receivedEvents.length).toBe(numUpdates);

    // Verify all stored
    const stored = await db.locations.findMany({
      where: { group_id: testGroupId, device_id: 'gps-device-001' },
      orderBy: { recorded_at: 'asc' },
    });

    expect(stored.length).toBe(numUpdates);

    // Verify speed progression
    stored.forEach((location, index) => {
      if (index > 0) {
        const prevSpeed = stored[index - 1].speed ?? 0;
        const currSpeed = location.speed ?? 0;
        expect(currSpeed).toBeGreaterThanOrEqual(prevSpeed);
      }
    });

    unsubscribe();
  });
});

