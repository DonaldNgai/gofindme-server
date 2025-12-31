#!/usr/bin/env tsx
/**
 * Test SSE Subscriber Script
 * 
 * This script provides a test-friendly SSE subscriber that can be controlled
 * by vitest tests. It supports testing various scenarios including:
 * - Valid API keys
 * - Invalid API keys
 * - Revoked API keys
 * - Missing API keys
 * - Connection errors
 * 
 * Usage:
 *   tsx scripts/test-sse-subscriber.ts
 * 
 * Environment variables:
 *   BASE_URL: Server URL (default: http://localhost:3000)
 *   API_PREFIX: API prefix (default: /api/v1)
 *   TEST_COORDINATOR_PORT: Port for test coordination API (default: 3002)
 */

import { createServer } from 'node:http';
import { URL } from 'node:url';
import { config } from 'dotenv';
import path from 'node:path';

// Load .env file from project root
config({ path: path.join(process.cwd(), '.env') });

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_PREFIX = process.env.API_PREFIX || '/api/v1';
const COORDINATOR_PORT = parseInt(process.env.TEST_COORDINATOR_PORT || '3002', 10);

const streamUrl = `${BASE_URL}${API_PREFIX}/stream`;

// Test coordination state
type ExpectedLocation = {
  deviceId: string;
  latitude: number;
  longitude: number;
  groupId?: string;
  timeout?: number;
};

type ConnectionResult = {
  success: boolean;
  statusCode?: number;
  statusText?: string;
  error?: string;
  connectedAt?: Date;
  disconnectedAt?: Date;
  groupId?: string | null;
};

type TestState = {
  testId: string | null;
  expectedLocations: ExpectedLocation[];
  receivedLocations: Array<{
    deviceId: string;
    latitude: number;
    longitude: number;
    groupId: string;
    receivedAt: Date;
  }>;
  ready: boolean;
  groupId: string | null;
  currentApiKey: string | null;
  connectionResult: ConnectionResult | null;
};

let state: TestState = {
  testId: null,
  expectedLocations: [],
  receivedLocations: [],
  ready: false,
  groupId: null,
  currentApiKey: null,
  connectionResult: null,
};

// SSE connection state
let abortController: AbortController | null = null;
let isConnected = false;
let sseReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

function formatTimestamp(): string {
  return new Date().toISOString();
}

function parseSSEEvent(eventString: string): { event?: string; data?: string } {
  const lines = eventString.split('\n');
  const event: { event?: string; data?: string } = {};

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const field = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    if (field === 'event') {
      event.event = value;
    } else if (field === 'data') {
      event.data = event.data ? event.data + '\n' + value : value;
    }
  }

  return event;
}

async function disconnectSSE(): Promise<void> {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }

  if (sseReader) {
    try {
      await sseReader.cancel();
    } catch {
      // Ignore cancellation errors
    }
    sseReader = null;
  }

  isConnected = false;
  state.ready = false;
  state.groupId = null;
  state.receivedLocations = [];
  
  if (state.connectionResult) {
    state.connectionResult.disconnectedAt = new Date();
  }
}

async function connectSSE(apiKey: string): Promise<ConnectionResult> {
  // Disconnect any existing connection
  await disconnectSSE();

  const result: ConnectionResult = {
    success: false,
  };

  abortController = new AbortController();
  state.currentApiKey = apiKey;

  try {
    const response = await fetch(streamUrl, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'text/event-stream',
      },
      signal: abortController.signal,
    });

    result.statusCode = response.status;
    result.statusText = response.statusText;

    if (!response.ok) {
      // Connection failed
      result.error = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorBody = await response.text();
        if (errorBody) {
          try {
            const errorJson = JSON.parse(errorBody);
            result.error = errorJson.error || errorJson.message || result.error;
          } catch {
            result.error = errorBody || result.error;
          }
        }
      } catch {
        // Ignore error reading response body
      }
      state.connectionResult = result;
      return result;
    }

    if (!response.body) {
      result.error = 'Response body is null';
      state.connectionResult = result;
      return result;
    }

    // Connection successful
    result.success = true;
    result.connectedAt = new Date();
    isConnected = true;
    state.connectionResult = result;

    console.log(`✅ [${formatTimestamp()}] Connected to SSE stream with API key: ${apiKey.substring(0, 8)}...`);

    sseReader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Read stream in background
    (async () => {
      try {
        while (true) {
          const { value, done } = await sseReader!.read();

          if (done) {
            console.log(`⚠️  [${formatTimestamp()}] SSE stream ended`);
            await disconnectSSE();
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE messages
          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            const eventString = buffer.slice(0, boundary).trim();
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf('\n\n');

            if (eventString) {
              const parsed = parseSSEEvent(eventString);
              const eventType = parsed.event || 'message';
              const data = parsed.data;

              if (data) {
                try {
                  const parsedData = JSON.parse(data);

                  if (eventType === 'ready') {
                    state.ready = true;
                    state.groupId = parsedData.groupId || null;
                    if (state.connectionResult) {
                      state.connectionResult.groupId = state.groupId;
                    }
                    console.log(`🎯 [${formatTimestamp()}] Ready - Group ID: ${state.groupId}`);
                  } else if (eventType === 'location') {
                    const location = {
                      deviceId: parsedData.deviceId,
                      latitude: parsedData.latitude,
                      longitude: parsedData.longitude,
                      groupId: parsedData.groupId || state.groupId || '',
                      receivedAt: new Date(),
                    };

                    state.receivedLocations.push(location);
                    console.log(
                      `📍 [${formatTimestamp()}] Location: ${location.deviceId} @ ${location.latitude}, ${location.longitude}`
                    );
                  }
                } catch (error) {
                  console.error(`❌ [${formatTimestamp()}] Error parsing event data:`, error);
                }
              }
            }
          }
        }
      } catch (error: any) {
        if (error.name === 'AbortError') {
          return;
        }
        console.error(`❌ [${formatTimestamp()}] SSE stream error:`, error.message);
        result.error = error.message;
        result.success = false;
        await disconnectSSE();
      }
    })();

    return result;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      result.error = 'Connection aborted';
    } else {
      result.error = error.message || 'Unknown error';
    }
    result.success = false;
    state.connectionResult = result;
    await disconnectSSE();
    return result;
  }
}

// HTTP server for test coordination
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const method = req.method;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check
  if (method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        connected: isConnected,
        ready: state.ready,
        groupId: state.groupId,
        currentApiKey: state.currentApiKey ? `${state.currentApiKey.substring(0, 8)}...` : null,
        connectionResult: state.connectionResult,
      })
    );
    return;
  }

  // Connect with a specific API key
  if (method === 'POST' && url.pathname === '/connect') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const apiKey = data.apiKey;

        if (!apiKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'apiKey is required' }));
          return;
        }

        const result = await connectSSE(apiKey);
        const status = result.success ? 200 : 400;

        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  // Disconnect
  if (method === 'POST' && url.pathname === '/disconnect') {
    await disconnectSSE();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Reset test state
  if (method === 'POST' && url.pathname === '/reset') {
    await disconnectSSE();
    state = {
      testId: null,
      expectedLocations: [],
      receivedLocations: [],
      ready: false,
      groupId: null,
      currentApiKey: null,
      connectionResult: null,
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Set test expectations
  if (method === 'POST' && url.pathname === '/expect') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        state.testId = data.testId || null;
        state.expectedLocations = data.expectedLocations || [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: state.expectedLocations.length }));
      } catch (error: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  // Wait for expected locations and validate
  if (method === 'POST' && url.pathname === '/validate') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const timeout = data.timeout || 2000; // default 2 seconds
        const startTime = Date.now();

        // Wait for expected locations
        while (state.receivedLocations.length < state.expectedLocations.length) {
          if (Date.now() - startTime > timeout) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // Validate received locations
        const results = state.expectedLocations.map((expected) => {
          const received = state.receivedLocations.find(
            (r) =>
              r.deviceId === expected.deviceId &&
              Math.abs(r.latitude - expected.latitude) < 0.0001 &&
              Math.abs(r.longitude - expected.longitude) < 0.0001 &&
              (!expected.groupId || r.groupId === expected.groupId)
          );

          return {
            expected,
            received: received || null,
            matched: !!received,
          };
        });

        const allMatched = results.every((r) => r.matched);
        const status = allMatched ? 200 : 400;

        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: allMatched,
            results,
            receivedCount: state.receivedLocations.length,
            expectedCount: state.expectedLocations.length,
          })
        );
      } catch (error: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  // Get current state
  if (method === 'GET' && url.pathname === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        testId: state.testId,
        expectedCount: state.expectedLocations.length,
        receivedCount: state.receivedLocations.length,
        ready: state.ready,
        groupId: state.groupId,
        currentApiKey: state.currentApiKey ? `${state.currentApiKey.substring(0, 8)}...` : null,
        connectionResult: state.connectionResult,
        receivedLocations: state.receivedLocations,
      })
    );
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(COORDINATOR_PORT, () => {
  console.log(`🚀 Test SSE Subscriber started`);
  console.log(`📍 SSE URL: ${streamUrl}`);
  console.log(`🧪 Coordinator API: http://localhost:${COORDINATOR_PORT}`);
  console.log('─'.repeat(60));
  console.log('Available endpoints:');
  console.log('  POST /connect - Connect with an API key');
  console.log('  POST /disconnect - Disconnect from SSE stream');
  console.log('  POST /reset - Reset all test state');
  console.log('  POST /expect - Set expected locations');
  console.log('  POST /validate - Validate received locations');
  console.log('  GET /state - Get current test state');
  console.log('  GET /health - Health check');
  console.log('─'.repeat(60));
  console.log('Ready for test coordination. No initial connection.');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n🛑 [${formatTimestamp()}] Shutting down...`);
  disconnectSSE();
  server.close(() => {
    process.exit(0);
  });
});
