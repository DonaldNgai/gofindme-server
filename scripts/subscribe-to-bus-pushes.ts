#!/usr/bin/env tsx
/**
 * Script to simulate an app subscribing to bus pushes via Server-Sent Events (SSE)
 * 
 * Usage:
 *   tsx scripts/subscribe-to-bus-pushes.ts [API_KEY]
 * 
 * Or set API_KEY environment variable:
 *   API_KEY=your-key tsx scripts/subscribe-to-bus-pushes.ts
 */

const API_KEY = process.argv[2] || process.env.API_KEY;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_PREFIX = process.env.API_PREFIX || '/api/v1';

if (!API_KEY) {
  console.error('❌ Error: API key is required');
  console.error('Usage: tsx scripts/subscribe-to-bus-pushes.ts [API_KEY]');
  console.error('Or set API_KEY environment variable');
  process.exit(1);
}

const streamUrl = `${BASE_URL}${API_PREFIX}/stream`;

console.log('🚀 Connecting to location stream...');
console.log(`📍 URL: ${streamUrl}`);
console.log(`🔑 API Key: ${API_KEY.substring(0, 8)}...`);
console.log('─'.repeat(60));

let eventCount = 0;
let locationCount = 0;
let heartbeatCount = 0;
let reconnectAttempts = 0;
let isConnected = false;
let abortController: AbortController | null = null;
const maxReconnectAttempts = 10;
const reconnectDelay = 3000; // 3 seconds

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatLocation(data: any): string {
  const parts = [
    `Device: ${data.deviceId}`,
    `Location: ${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}`,
  ];
  
  if (data.accuracy !== null && data.accuracy !== undefined) {
    parts.push(`Accuracy: ${data.accuracy.toFixed(1)}m`);
  }
  
  if (data.speed !== null && data.speed !== undefined) {
    parts.push(`Speed: ${data.speed.toFixed(1)} m/s`);
  }
  
  if (data.heading !== null && data.heading !== undefined) {
    parts.push(`Heading: ${data.heading.toFixed(1)}°`);
  }
  
  if (data.recordedAt) {
    parts.push(`Recorded: ${new Date(data.recordedAt).toISOString()}`);
  }
  
  return parts.join(' | ');
}

function parseSSEEvent(eventString: string): { event?: string; data?: string; id?: string } {
  const lines = eventString.split('\n');
  const event: { event?: string; data?: string; id?: string } = {};
  
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    
    const field = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    
    if (field === 'event') {
      event.event = value;
    } else if (field === 'data') {
      event.data = event.data ? event.data + '\n' + value : value;
    } else if (field === 'id') {
      event.id = value;
    }
  }
  
  return event;
}

function handleEvent(eventType: string, data: string) {
  eventCount++;
  
  try {
    const parsedData = JSON.parse(data);
    
    switch (eventType) {
      case 'ready':
        console.log(`\n🎯 [${formatTimestamp()}] Ready event`);
        console.log(`   Group ID: ${parsedData.groupId}`);
        console.log(`   Total events received: ${eventCount}`);
        break;
        
      case 'location':
        locationCount++;
        console.log(`\n📍 [${formatTimestamp()}] Location update #${locationCount}`);
        console.log(`   ${formatLocation(parsedData)}`);
        if (parsedData.groupId) {
          console.log(`   Group ID: ${parsedData.groupId}`);
        }
        if (parsedData.metadata) {
          console.log(`   Metadata: ${JSON.stringify(parsedData.metadata)}`);
        }
        break;
        
      case 'heartbeat':
        heartbeatCount++;
        // Only show heartbeat every 10th time to reduce noise
        if (heartbeatCount % 10 === 0) {
          console.log(`💓 [${formatTimestamp()}] Heartbeat (${heartbeatCount} total)`);
        }
        break;
        
      default:
        console.log(`\n📨 [${formatTimestamp()}] Unknown event: ${eventType || 'message'}`);
        console.log(`   Data: ${JSON.stringify(parsedData, null, 2)}`);
    }
  } catch (error) {
    console.log(`\n📨 [${formatTimestamp()}] Event: ${eventType || 'message'}`);
    console.log(`   Raw data: ${data}`);
  }
}

async function connect(): Promise<void> {
  abortController = new AbortController();
  
  try {
    const response = await fetch(streamUrl, {
      method: 'GET',
      headers: {
        'X-API-Key': API_KEY,
        'Accept': 'text/event-stream',
      },
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    reconnectAttempts = 0;
    isConnected = true;
    console.log(`✅ [${formatTimestamp()}] Connected to stream`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      
      if (done) {
        console.log(`\n⚠️  [${formatTimestamp()}] Stream ended`);
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages (separated by double newline)
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const eventString = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');

        if (eventString) {
          const parsed = parseSSEEvent(eventString);
          const eventType = parsed.event || 'message';
          const data = parsed.data || '';
          
          if (data) {
            handleEvent(eventType, data);
          }
        }
      }
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      // Intentional abort, don't reconnect
      return;
    }
    
    isConnected = false;
    console.error(`❌ [${formatTimestamp()}] Connection error:`, error.message);
    
    reconnectAttempts++;
    
    if (reconnectAttempts <= maxReconnectAttempts) {
      console.log(
        `🔄 [${formatTimestamp()}] Reconnecting... (attempt ${reconnectAttempts}/${maxReconnectAttempts})`
      );
      setTimeout(() => {
        connect();
      }, reconnectDelay);
    } else {
      console.error(`❌ [${formatTimestamp()}] Max reconnection attempts reached. Exiting.`);
      process.exit(1);
    }
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n\n🛑 [${formatTimestamp()}] Shutting down...`);
  console.log(`📊 Statistics:`);
  console.log(`   Total events: ${eventCount}`);
  console.log(`   Location updates: ${locationCount}`);
  console.log(`   Heartbeats: ${heartbeatCount}`);
  
  if (abortController) {
    abortController.abort();
  }
  
  process.exit(0);
});

// Start connection
connect().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
