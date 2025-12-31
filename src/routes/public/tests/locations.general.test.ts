import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { buildApp } from '../../../app.js';
import { prisma as db } from '../../../db.js';
import { createApiKey } from '../../../services/api-keys.js';
import { locationBus } from '../../../services/bus.js';
import { getTestAuth0Token } from './helpers/auth-helper.js';
import type { LocationUpdatePayload } from '../../../types/location.js';

/**
 * Performance and stress tests for location updates
 * These complement the focused authorization tests (incoming/outgoing)
 * by testing high-frequency and high-volume scenarios
 */
describe('Location Updates - Performance and Stress Tests', () => {
  let fastify: ReturnType<typeof Fastify>;
  let testGroupId: string;
  let testApiKey: string;
  let testUserId: string;
  let testAuth0Token: string | undefined;

  beforeAll(async () => {
    fastify = Fastify();
    await buildApp(fastify);
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  beforeEach(async () => {
    // Get Auth0 token (required for location submission)
    testAuth0Token = getTestAuth0Token('1');
    
    if (!testAuth0Token) {
      throw new Error(
        'Auth0 token required for tests. Please set TEST_AUTH0_TOKEN_USER_1 environment variable.'
      );
    }

    // Clean up any existing test data first
    await db.locations.deleteMany({
      where: {
        group_id: { in: ['test-group-123'] },
      },
    });
    await db.locations.deleteMany({
      where: {
        device_id: { in: ['test-user-123', 'user-1'] },
      },
    });
    await db.group_members.deleteMany({
      where: {
        group_id: { in: ['test-group-123'] },
      },
    });
    await db.api_keys.deleteMany({
      where: {
        group_id: { in: ['test-group-123'] },
      },
    });
    await db.groups.deleteMany({
      where: { id: { in: ['test-group-123'] } },
    });
    await db.users.deleteMany({
      where: { id: { in: ['test-user-123', 'user-1'] } },
    });

    // Create test user - use 'user-1' to match Auth0 token sub claim
    const user = await db.users.upsert({
      where: { id: 'user-1' },
      update: {
        email: 'test@example.com',
        name: 'Test User',
      },
      create: {
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
      },
    });
    testUserId = user.id;

    // Create test group
    const group = await db.groups.upsert({
      where: { id: 'test-group-123' },
      update: {
        name: 'Test Group',
        owner_id: testUserId,
      },
      create: {
        id: 'test-group-123',
        name: 'Test Group',
        owner_id: testUserId,
      },
    });
    testGroupId = group.id;

    // Create test API key (for SSE subscription testing, not location submission)
    testApiKey = await createApiKey(testGroupId, 'Test API Key', testUserId);

    // Add user as member of the group (required for authorization)
    await db.group_members.upsert({
      where: {
        group_id_user_id: {
          group_id: testGroupId,
          user_id: testUserId,
        },
      },
      update: {
        status: 'accepted',
      },
      create: {
        group_id: testGroupId,
        user_id: testUserId,
        status: 'accepted',
      },
    });
  });

  afterEach(async () => {
    // Clean up test data
    await db.locations.deleteMany({ where: { group_id: testGroupId } });
    await db.group_members.deleteMany({ where: { group_id: testGroupId } });
    await db.api_keys.deleteMany({ where: { group_id: testGroupId } });
    await db.groups.deleteMany({ where: { id: testGroupId } });
    await db.users.deleteMany({ where: { id: testUserId } });
  });

  /**
   * Performance and stress tests for location updates
   * These tests focus on handling high volume and frequency scenarios
   * which are not covered in the focused authorization tests
   */

  describe('Performance and Stress Tests', () => {
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
        deviceId: testUserId, // Use userId for authorization
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
      expect(receivedUpdates[0]?.deviceId).toBe(testUserId);
      expect(receivedUpdates[receivedUpdates.length - 1]?.deviceId).toBe(testUserId);

      // Verify all stored in database
      const stored = await db.locations.findMany({
        where: { group_id: testGroupId, device_id: testUserId },
        orderBy: { recorded_at: 'asc' },
      });

      expect(stored.length).toBe(numUpdates);

      unsubscribe();
    });

    it('should handle high-frequency location updates', async () => {
      const numUpdates = 20;
      const updates: Array<{ id: string; receivedAt: string }> = [];

      if (!testAuth0Token) {
        throw new Error('Auth0 token required for this test');
      }

      console.log(`[Test] Sending ${numUpdates} rapid location updates...`);

      // Send rapid updates
      const promises = Array.from({ length: numUpdates }, (_, i) =>
        fastify.inject({
          method: 'POST',
          url: '/api/v1/locations',
          headers: {
            'Authorization': `Bearer ${testAuth0Token}`,
          },
          payload: {
            deviceId: testUserId, // Use userId for authorization
            latitude: 37.7749 + Math.random() * 0.01,
            longitude: -122.4194 + Math.random() * 0.01,
            recordedAt: new Date().toISOString(),
          },
        })
      );

      const responses = await Promise.all(promises);

      console.log(`[Test] Received ${responses.length} responses`);

      responses.forEach((response, index) => {
        if (response.statusCode !== 202) {
          console.error(`[Test] Update ${index + 1} failed:`, response.statusCode, response.body);
        }
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

});

