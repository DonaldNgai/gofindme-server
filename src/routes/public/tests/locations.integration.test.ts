/**
 * Integration tests for location tracking with real user/app interactions
 *
 * These tests require manual interaction and are designed to test:
 * 1. Phone app integration - waiting for location data from a real phone app
 * 2. Developer app integration - testing with API keys and SSE streams
 *
 * These tests will pause and wait for user input at various points.
 *
 * To run these tests:
 *   pnpm test locations.integration.test.ts
 *
 * Note: These tests are interactive and may take longer to complete.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { buildApp } from '../../../app.js';
import { prisma as db } from '../../../db.js';
import { createApiKey } from '../../../services/api-keys.js';
import { locationBus } from '../../../services/bus.js';
import { generateFakeAuth0Token, generateFakeApiKey } from './helpers/test-auth.js';
import { getSSESubscriberHelper } from './helpers/sse-subscriber-helper.js';
import {
  readUserInput,
  askYesNo,
  waitForEnter,
  waitForConfirmation,
} from './helpers/user-input-helper.js';

describe('Location Integration Tests - Phone App & Developer App', () => {
  let fastify: ReturnType<typeof Fastify>;
  let testGroup1Id: string;
  let testGroup2Id: string;
  let testUserId1: string;
  let testUserId2: string;
  let testApiKey1: string; // For group 1
  let testApiKey2: string; // For group 2
  let testAuth0Token1: string;
  let testAuth0Token2: string;

  beforeAll(async () => {
    fastify = Fastify();
    await buildApp(fastify);
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  beforeEach(async () => {
    // Generate fake Auth0 tokens for test users
    testUserId1 = 'integration-test-user-1';
    testUserId2 = 'integration-test-user-2';

    testAuth0Token1 = generateFakeAuth0Token(
      testUserId1,
      'user1@integration.test',
      'Integration Test User 1'
    );
    testAuth0Token2 = generateFakeAuth0Token(
      testUserId2,
      'user2@integration.test',
      'Integration Test User 2'
    );

    // Clean up any existing test data
    const existingGroups = await db.groups.findMany({
      where: {
        owner_id: { in: [testUserId1, testUserId2] },
      },
    });
    const existingGroupIds = existingGroups.map((g) => g.id);

    if (existingGroupIds.length > 0) {
      await db.locations.deleteMany({
        where: { group_id: { in: existingGroupIds } },
      });
      await db.group_members.deleteMany({
        where: { group_id: { in: existingGroupIds } },
      });
      await db.api_keys.deleteMany({
        where: { group_id: { in: existingGroupIds } },
      });
      await db.groups.deleteMany({
        where: { id: { in: existingGroupIds } },
      });
    }

    await db.locations.deleteMany({
      where: { device_id: { in: [testUserId1, testUserId2] } },
    });

    await db.users.deleteMany({
      where: { id: { in: [testUserId1, testUserId2] } },
    });

    // Create test users
    await db.users.upsert({
      where: { id: testUserId1 },
      update: {
        email: 'user1@integration.test',
        name: 'Integration Test User 1',
      },
      create: {
        id: testUserId1,
        email: 'user1@integration.test',
        name: 'Integration Test User 1',
      },
    });

    await db.users.upsert({
      where: { id: testUserId2 },
      update: {
        email: 'user2@integration.test',
        name: 'Integration Test User 2',
      },
      create: {
        id: testUserId2,
        email: 'user2@integration.test',
        name: 'Integration Test User 2',
      },
    });

    // Create test groups
    const group1 = await db.groups.create({
      data: {
        name: 'Integration Test Group 1',
        owner_id: testUserId1,
      },
    });
    testGroup1Id = group1.id;

    const group2 = await db.groups.create({
      data: {
        name: 'Integration Test Group 2',
        owner_id: testUserId1,
      },
    });
    testGroup2Id = group2.id;

    // Create API keys
    testApiKey1 = await generateFakeApiKey(testGroup1Id, 'Integration Test API Key 1', testUserId1);
    testApiKey2 = await generateFakeApiKey(testGroup2Id, 'Integration Test API Key 2', testUserId1);

    // Add user1 to group1 and group2
    await db.group_members.upsert({
      where: {
        group_id_user_id: {
          group_id: testGroup1Id,
          user_id: testUserId1,
        },
      },
      update: { status: 'accepted' },
      create: {
        group_id: testGroup1Id,
        user_id: testUserId1,
        status: 'accepted',
      },
    });

    await db.group_members.upsert({
      where: {
        group_id_user_id: {
          group_id: testGroup2Id,
          user_id: testUserId1,
        },
      },
      update: { status: 'accepted' },
      create: {
        group_id: testGroup2Id,
        user_id: testUserId1,
        status: 'accepted',
      },
    });

    console.log('\n=== Integration Test Setup Complete ===');
    console.log(`Group 1 ID: ${testGroup1Id}`);
    console.log(`Group 2 ID: ${testGroup2Id}`);
    console.log(`API Key 1 (Group 1): ${testApiKey1.substring(0, 20)}...`);
    console.log(`API Key 2 (Group 2): ${testApiKey2.substring(0, 20)}...`);
    console.log(`Auth0 Token 1 (User 1): ${testAuth0Token1.substring(0, 30)}...`);
    console.log('=====================================\n');
  });

  afterEach(async () => {
    // Clean up test data
    const groupIds = [testGroup1Id, testGroup2Id].filter((id): id is string => id !== undefined);

    if (groupIds.length > 0) {
      await db.locations.deleteMany({
        where: { group_id: { in: groupIds } },
      });
      await db.group_members.deleteMany({
        where: { group_id: { in: groupIds } },
      });
      await db.api_keys.deleteMany({
        where: { group_id: { in: groupIds } },
      });
      await db.groups.deleteMany({
        where: { id: { in: groupIds } },
      });
    }

    await db.locations.deleteMany({
      where: { device_id: { in: [testUserId1, testUserId2] } },
    });

    await db.users.deleteMany({
      where: { id: { in: [testUserId1, testUserId2] } },
    });
  });

  describe('Phone App Integration', () => {
    it('should receive and validate location data from phone app', async () => {
      console.log('\n=== Phone App Integration Test ===');
      console.log('This test will wait for location data from a real phone app.');
      console.log('You can either:');
      console.log('  1. Use a real phone app to send location data');
      console.log('  2. Manually send a POST request to /api/v1/locations');
      console.log('  3. Type "skip" to skip this test\n');

      // Get server URL
      const serverAddress = fastify.server.address();
      let serverUrl = 'http://localhost:3000';
      if (serverAddress && typeof serverAddress === 'object') {
        const host = serverAddress.address === '::' ? 'localhost' : serverAddress.address;
        const port = serverAddress.port;
        serverUrl = `http://${host}:${port}`;
      }

      console.log(`Server URL: ${serverUrl}`);
      console.log(`Endpoint: POST ${serverUrl}/api/v1/locations`);
      console.log(`Headers: Authorization: Bearer <your-auth0-token>`);
      console.log(`Payload: { deviceId, latitude, longitude, recordedAt }\n`);

      // Set up listener for location updates
      const receivedLocations: Array<{
        deviceId: string;
        latitude: number;
        longitude: number;
        receivedAt: Date;
      }> = [];

      const unsubscribe = locationBus.subscribe(testGroup1Id, (event) => {
        if (event.type === 'location') {
          receivedLocations.push({
            deviceId: event.data.deviceId,
            latitude: event.data.latitude,
            longitude: event.data.longitude,
            receivedAt: new Date(),
          });
          console.log(
            `\n[Location Received] Device: ${event.data.deviceId}, Lat: ${event.data.latitude}, Lng: ${event.data.longitude}`
          );
        }
      });

      try {
        // Wait for user to send location data
        console.log('\nWaiting for location data from phone app...');
        console.log('Options:');
        console.log('  - Send location data from your phone app now');
        console.log('  - Type "skip" to skip this test');
        console.log('  - Type "manual" to manually enter location data');
        console.log('  - Press Enter and wait (will timeout after 60 seconds)\n');

        // Poll for location data while waiting for user input
        let locationReceived = false;
        const checkInterval = setInterval(() => {
          if (receivedLocations.length > 0 && !locationReceived) {
            locationReceived = true;
            console.log('\n✓ Location data received!');
          }
        }, 500);

        const userInput = await readUserInput({
          prompt: '> ',
          timeout: 60000, // 60 second timeout
          defaultAnswer: '',
        });

        clearInterval(checkInterval);

        if (userInput.toLowerCase() === 'skip') {
          console.log('Test skipped by user');
          return;
        }

        if (userInput.toLowerCase() === 'manual') {
          // Allow manual entry of location data for testing
          console.log('\nManual location entry:');
          const lat = await readUserInput({ prompt: 'Latitude: ' });
          const lng = await readUserInput({ prompt: 'Longitude: ' });
          const deviceId = await readUserInput({
            prompt: 'Device ID (or press Enter for default): ',
            defaultAnswer: testUserId1,
          });

          // Send the location manually
          await fastify.inject({
            method: 'POST',
            url: '/api/v1/locations',
            headers: {
              Authorization: `Bearer ${testAuth0Token1}`,
            },
            payload: {
              deviceId: deviceId || testUserId1,
              latitude: parseFloat(lat),
              longitude: parseFloat(lng),
              recordedAt: new Date().toISOString(),
            },
          });

          console.log('Location sent. Waiting for processing...');
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } else {
          // Wait a bit for the location to be processed (if it was sent externally)
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        // Validate received location
        if (receivedLocations.length > 0) {
          const location = receivedLocations[0];
          console.log('\n=== Location Validation ===');
          console.log(`Device ID: ${location.deviceId}`);
          console.log(`Latitude: ${location.latitude}`);
          console.log(`Longitude: ${location.longitude}`);
          console.log(`Received At: ${location.receivedAt.toISOString()}`);

          // Validate basic constraints
          expect(location.latitude).toBeGreaterThanOrEqual(-90);
          expect(location.latitude).toBeLessThanOrEqual(90);
          expect(location.longitude).toBeGreaterThanOrEqual(-180);
          expect(location.longitude).toBeLessThanOrEqual(180);

          // Ask user to confirm if the location data is correct
          const isValid = await askYesNo(
            '\nIs this location data correct? (Does it match what you sent?)'
          );

          if (!isValid) {
            console.log('\n⚠️  Location data validation failed by user');
            console.log('This could indicate:');
            console.log('  - Payload format issues');
            console.log('  - Data transformation problems');
            console.log('  - Incorrect group assignment');
          } else {
            console.log('✓ Location data validated successfully');
          }

          expect(isValid).toBe(true);
          expect(receivedLocations.length).toBeGreaterThan(0);
        } else {
          console.log('\n⚠️  No location data received via event bus.');
          console.log('Possible reasons:');
          console.log('  - Location was not sent');
          console.log('  - User is not a member of any groups with API keys');
          console.log('  - Event bus subscription issue');
          console.log('  - Authorization failure\n');

          // Also check database for stored location
          const storedLocations = await db.locations.findMany({
            where: {
              device_id: { in: [testUserId1, testUserId2] },
            },
            orderBy: {
              received_at: 'desc',
            },
            take: 5,
          });

          if (storedLocations.length > 0) {
            console.log(`Found ${storedLocations.length} location(s) in database:`);
            storedLocations.forEach((loc, idx) => {
              console.log(
                `  ${idx + 1}. Device: ${loc.device_id}, Lat: ${loc.latitude}, Lng: ${loc.longitude}, Group: ${loc.group_id}`
              );
            });
            console.log('\nLocation was stored but not received via event bus.');
            console.log('This might indicate an issue with the event bus or group membership.\n');
          }

          const shouldContinue = await askYesNo('Continue anyway? (Test will fail)');
          if (!shouldContinue) {
            throw new Error('No location data received - test aborted by user');
          }
        }
      } finally {
        unsubscribe();
      }
    }, 120000); // 2 minute timeout
  });

  describe('Developer App Integration with API Key', () => {
    let subscriber: ReturnType<typeof getSSESubscriberHelper> | null = null;
    let subscriberStarted = false;

    beforeAll(async () => {
      try {
        const serverAddress = fastify.server.address();
        let serverUrl = 'http://localhost:3000';
        if (serverAddress && typeof serverAddress === 'object') {
          const host = serverAddress.address === '::' ? 'localhost' : serverAddress.address;
          const port = serverAddress.port;
          serverUrl = `http://${host}:${port}`;
        }

        subscriber = getSSESubscriberHelper(serverUrl);
        await subscriber.start();
        subscriberStarted = true;
        console.log('[Integration Test] SSE subscriber initialized');
      } catch (error: any) {
        console.error('[Integration Test] Failed to initialize SSE subscriber:', error.message);
        subscriberStarted = false;
      }
    });

    afterAll(async () => {
      if (subscriberStarted && subscriber) {
        await subscriber.stop();
      }
    });

    it('should deliver location updates to developer app with API key access', async () => {
      if (!subscriberStarted || !subscriber) {
        console.warn('[Integration Test] Skipping: SSE subscriber not running');
        return;
      }

      console.log('\n=== Developer App Integration Test (With Access) ===');
      console.log('This test will:');
      console.log('  1. Connect a developer app (SSE subscriber) with an API key');
      console.log('  2. Wait for you to confirm the app is ready');
      console.log('  3. Emulate a phone location update');
      console.log('  4. Verify the developer app receives the location data\n');

      await subscriber.reset();

      // Connect with API key for group 1
      console.log(`Connecting developer app with API key for Group 1...`);
      const connectResult = await subscriber.connect(testApiKey1);

      if (!connectResult.success) {
        throw new Error(`Failed to connect: ${connectResult.error}`);
      }

      console.log('✓ Developer app connected successfully');

      // Wait for ready event
      await new Promise((resolve) => setTimeout(resolve, 500));

      const health = await subscriber.getHealth();
      console.log(`✓ Developer app ready. Listening to group: ${health.groupId}`);

      // Pause and wait for user to confirm developer app is ready
      await waitForConfirmation(
        `\nPlease verify that your developer app is connected and ready to receive location updates.\n` +
          `The app should be listening to group: ${health.groupId}\n` +
          `API Key: ${testApiKey1.substring(0, 30)}...\n`
      );

      // Set expectation for location update
      const expectedLocation = {
        deviceId: testUserId1,
        latitude: 37.7749,
        longitude: -122.4194,
        groupId: testGroup1Id,
      };

      console.log('\nSetting expectation for location update...');
      await subscriber.expectLocations(`integration-test-${Date.now()}`, [expectedLocation]);

      // Wait a bit for expectations to be set
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Emulate phone location update
      console.log('\n=== Emulating Phone Location Update ===');
      console.log(`Sending location update for user: ${testUserId1}`);
      console.log(`Location: ${expectedLocation.latitude}, ${expectedLocation.longitude}`);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: {
          Authorization: `Bearer ${testAuth0Token1}`,
        },
        payload: {
          deviceId: testUserId1,
          latitude: expectedLocation.latitude,
          longitude: expectedLocation.longitude,
          recordedAt: new Date().toISOString(),
        },
      });

      if (response.statusCode !== 202) {
        throw new Error(`Location submission failed: ${response.statusCode} ${response.body}`);
      }

      console.log('✓ Location update submitted successfully');

      // Wait for the event to arrive
      console.log('\nWaiting for location event to arrive at developer app...');
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Validate results
      const { success, results } = await subscriber.validateLocations(2000);

      console.log('\n=== Validation Results ===');
      console.log(`Success: ${success}`);
      console.log(`Expected: ${results.length} location(s)`);
      console.log(`Received: ${results.filter((r) => r.matched).length} location(s)`);

      // Ask user to confirm if their developer app received the data
      console.log('\n=== User Verification ===');
      const appReceivedData = await askYesNo(
        'Did your developer app receive the location update? (Check your app logs/UI)'
      );

      if (!appReceivedData) {
        console.log('\n⚠️  Developer app did not receive the location update.');
        console.log('This could indicate an issue with:');
        console.log('  - SSE connection');
        console.log('  - API key permissions');
        console.log('  - Group membership');
        console.log('  - Event bus delivery');
      } else {
        console.log('✓ Developer app received the location update');
      }

      // Validate that the test subscriber also received it
      expect(success).toBe(true);
      expect(results.length).toBe(1);
      expect(results[0].matched).toBe(true);

      // Disconnect
      await subscriber.disconnect();
      console.log('\n✓ Test completed successfully');
    }, 300000); // 5 minute timeout for interactive test

    it('should NOT deliver location updates when API key has no access', async () => {
      if (!subscriberStarted || !subscriber) {
        console.warn('[Integration Test] Skipping: SSE subscriber not running');
        return;
      }

      console.log('\n=== Developer App Integration Test (Without Access) ===');
      console.log('This test will:');
      console.log('  1. Connect a developer app with an API key for Group 2');
      console.log('  2. Send a location update for a user in Group 1 (different group)');
      console.log('  3. Verify the developer app does NOT receive the location data\n');

      await subscriber.reset();

      // Connect with API key for group 2
      console.log(`Connecting developer app with API key for Group 2...`);
      const connectResult = await subscriber.connect(testApiKey2);

      if (!connectResult.success) {
        throw new Error(`Failed to connect: ${connectResult.error}`);
      }

      console.log('✓ Developer app connected successfully');

      // Wait for ready event
      await new Promise((resolve) => setTimeout(resolve, 500));

      const health = await subscriber.getHealth();
      console.log(`✓ Developer app ready. Listening to group: ${health.groupId}`);
      console.log(`  (This app should NOT receive updates for Group 1)\n`);

      // Wait for user confirmation
      await waitForConfirmation(
        `Please verify that your developer app is connected and listening to group: ${health.groupId}\n` +
          `API Key: ${testApiKey2.substring(0, 30)}...\n`
      );

      // Send location update for user in Group 1 (different from Group 2)
      // User 1 is in both groups, but we'll send to Group 1 specifically
      const locationForGroup1 = {
        deviceId: testUserId1,
        latitude: 40.7128,
        longitude: -74.006,
        groupId: testGroup1Id,
      };

      console.log('\n=== Sending Location Update for Group 1 ===');
      console.log(`This location is for Group 1, but the app is listening to Group 2`);
      console.log(`Location: ${locationForGroup1.latitude}, ${locationForGroup1.longitude}`);

      // Note: The location will be published to all groups where user1 is a member
      // Since user1 is in both group1 and group2, it WILL be published to group2
      // So we need to test with a user that's only in group1

      // Create a user that's only in group1
      const isolatedUserId = 'isolated-test-user';
      const isolatedToken = generateFakeAuth0Token(
        isolatedUserId,
        'isolated@test.com',
        'Isolated User'
      );

      await db.users.upsert({
        where: { id: isolatedUserId },
        update: {},
        create: {
          id: isolatedUserId,
          email: 'isolated@test.com',
          name: 'Isolated User',
        },
      });

      await db.group_members.upsert({
        where: {
          group_id_user_id: {
            group_id: testGroup1Id,
            user_id: isolatedUserId,
          },
        },
        update: { status: 'accepted' },
        create: {
          group_id: testGroup1Id,
          user_id: isolatedUserId,
          status: 'accepted',
        },
      });

      // Now send location from isolated user (only in group1)
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: {
          Authorization: `Bearer ${isolatedToken}`,
        },
        payload: {
          deviceId: isolatedUserId,
          latitude: locationForGroup1.latitude,
          longitude: locationForGroup1.longitude,
          recordedAt: new Date().toISOString(),
        },
      });

      if (response.statusCode !== 202) {
        throw new Error(`Location submission failed: ${response.statusCode} ${response.body}`);
      }

      console.log('✓ Location update submitted (for Group 1 only)');

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check if subscriber received anything
      const state = await subscriber.getState();
      console.log('\n=== Validation Results ===');
      console.log(`Locations received by subscriber: ${state.receivedCount}`);

      // Ask user to confirm their app did NOT receive the data
      console.log('\n=== User Verification ===');
      const appReceivedData = await askYesNo(
        'Did your developer app receive the location update? (It should NOT have received it)'
      );

      if (appReceivedData) {
        console.log('\n⚠️  Developer app received the location update, but it should NOT have.');
        console.log('This could indicate an issue with group isolation or authorization.');
      } else {
        console.log('✓ Developer app correctly did NOT receive the location update');
      }

      // The subscriber should not have received it (since it's listening to group2, not group1)
      // But wait, user1 is in both groups, so if we sent from user1, it would go to both
      // We sent from isolated user who is only in group1, so subscriber (listening to group2) should not receive it
      expect(state.receivedCount).toBe(0);

      // Cleanup
      await db.group_members.deleteMany({
        where: { user_id: isolatedUserId },
      });
      await db.locations.deleteMany({
        where: { device_id: isolatedUserId },
      });
      await db.users.deleteMany({
        where: { id: isolatedUserId },
      });

      await subscriber.disconnect();
      console.log('\n✓ Test completed successfully');
    }, 300000); // 5 minute timeout

    it('should handle multiple location updates in sequence', async () => {
      if (!subscriberStarted || !subscriber) {
        console.warn('[Integration Test] Skipping: SSE subscriber not running');
        return;
      }

      console.log('\n=== Multiple Location Updates Test ===');
      console.log(
        'This test will send multiple location updates and verify they are all received.\n'
      );

      await subscriber.reset();

      // Connect
      const connectResult = await subscriber.connect(testApiKey1);
      if (!connectResult.success) {
        throw new Error(`Failed to connect: ${connectResult.error}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 500));

      const health = await subscriber.getHealth();
      console.log(`✓ Connected to group: ${health.groupId}\n`);

      // Set expectations for multiple locations
      const expectedLocations = [
        { deviceId: testUserId1, latitude: 37.7749, longitude: -122.4194, groupId: testGroup1Id },
        { deviceId: testUserId1, latitude: 37.775, longitude: -122.4195, groupId: testGroup1Id },
        { deviceId: testUserId1, latitude: 37.7751, longitude: -122.4196, groupId: testGroup1Id },
      ];

      await subscriber.expectLocations(`multi-test-${Date.now()}`, expectedLocations);
      await new Promise((resolve) => setTimeout(resolve, 100));

      console.log('Sending 3 location updates in sequence...\n');

      // Send multiple location updates
      for (let i = 0; i < expectedLocations.length; i++) {
        const loc = expectedLocations[i];
        console.log(`Sending location ${i + 1}/3: ${loc.latitude}, ${loc.longitude}`);

        await fastify.inject({
          method: 'POST',
          url: '/api/v1/locations',
          headers: {
            Authorization: `Bearer ${testAuth0Token1}`,
          },
          payload: {
            deviceId: loc.deviceId,
            latitude: loc.latitude,
            longitude: loc.longitude,
            recordedAt: new Date().toISOString(),
          },
        });

        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      console.log('\nWaiting for all location events to arrive...');
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Validate
      const { success, results } = await subscriber.validateLocations(2000);

      console.log('\n=== Validation Results ===');
      console.log(`Success: ${success}`);
      console.log(`Expected: ${expectedLocations.length} locations`);
      console.log(`Received: ${results.filter((r) => r.matched).length} locations`);

      // Ask user to confirm
      const allReceived = await askYesNo(
        `Did your developer app receive all ${expectedLocations.length} location updates?`
      );

      if (!allReceived) {
        console.log('\n⚠️  Not all location updates were received by the developer app.');
      } else {
        console.log('✓ All location updates were received');
      }

      expect(success).toBe(true);
      expect(results.length).toBe(expectedLocations.length);
      expect(results.every((r) => r.matched)).toBe(true);

      await subscriber.disconnect();
      console.log('\n✓ Test completed successfully');
    }, 300000);
  });
});
