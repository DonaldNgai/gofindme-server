# Location Data Push Architecture

## Overview

Your system uses a **hybrid push architecture** that combines:
1. **In-memory Event Bus** (`bus.ts`) - For real-time SSE streaming
2. **Database Storage** - For persistence and historical queries
3. **Server-Sent Events (SSE)** - For real-time subscriptions

## Current Flow

```
┌─────────────┐
│ Mobile App  │ POST /api/v1/locations (with API key)
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│  Fastify Server  │
│  1. Validate API key
│  2. Store in DB
│  3. Publish to Bus
└──────┬──────────┘
       │
       ├─────────────────┐
       ▼                 ▼
┌─────────────┐   ┌──────────────┐
│  Database    │   │  Event Bus   │
│  (PostgreSQL)│   │ (EventEmitter)│
└─────────────┘   └──────┬───────┘
                         │
                         ▼
              ┌──────────────────┐
              │  SSE Subscribers │
              │  GET /stream     │
              └──────────────────┘
```

## What is `bus.ts`?

The `bus.ts` file implements an **in-memory event bus** using Node.js `EventEmitter`. It's an optimization that:

### ✅ Benefits:
1. **Zero Latency**: Events are delivered instantly (in-memory)
2. **No Database Polling**: Subscribers don't need to poll the DB
3. **Efficient**: EventEmitter is highly optimized for pub/sub
4. **Simple**: No external dependencies (Redis, RabbitMQ, etc.)

### ⚠️ Limitations:
1. **Single Server Only**: Doesn't work across multiple server instances
2. **No Persistence**: If a subscriber disconnects, they miss events
3. **Memory Bound**: All events are in memory (not a problem for real-time)

### When to Use:
- ✅ **Perfect for**: Real-time dashboards, live tracking, SSE streams
- ❌ **Not ideal for**: Multi-server deployments, guaranteed delivery, webhooks

## Delivery Methods

### 1. Server-Sent Events (SSE) - ✅ Currently Implemented

**Endpoint**: `GET /api/v1/stream`

**How it works**:
- Client opens SSE connection with API key
- Server subscribes to bus events for that `groupId`
- Events are pushed in real-time via SSE

**Use case**: Real-time dashboards, web apps, monitoring

**Example**:
```javascript
const eventSource = new EventSource('https://api.gofindme.com/api/v1/stream', {
  headers: { 'X-API-Key': 'your-api-key' }
});

eventSource.onmessage = (event) => {
  const location = JSON.parse(event.data);
  console.log('New location:', location);
};
```

### 2. Webhooks - 🔄 Recommended Addition

**How it works**:
- Apps register webhook URLs when creating API keys
- Server sends HTTP POST to webhook URL on each location update
- Includes signature for security

**Use case**: External integrations, server-to-server, guaranteed delivery

**Implementation**: See `src/services/webhook.ts`

### 3. WebSockets - 🔄 Optional Enhancement

**How it works**:
- Similar to SSE but bidirectional
- Lower overhead than SSE
- Better for high-frequency updates

**Use case**: Gaming, real-time collaboration, high-frequency tracking

## Recommended Architecture Enhancements

### Option 1: Add Webhook Support (Recommended)

For apps that need guaranteed delivery or can't maintain SSE connections:

```typescript
// Add to schema.prisma
model webhooks {
  id          String   @id @default(cuid())
  api_key_id  String
  url         String
  secret      String?  // For HMAC signing
  active      Boolean  @default(true)
  created_at  DateTime @default(now())
  api_keys    api_keys @relation(fields: [api_key_id], references: [id])
  
  @@index([api_key_id])
  @@map("webhooks")
}
```

### Option 2: Add Redis for Multi-Server Support

If you need to scale horizontally:

```typescript
// Replace EventEmitter with Redis pub/sub
import Redis from 'ioredis';

class LocationBus {
  private redis: Redis;
  
  publishLocation(groupId: string, payload: LocationUpdatePayload) {
    this.redis.publish(`group:${groupId}`, JSON.stringify(payload));
  }
  
  subscribe(groupId: string, listener: (event: GroupEvent) => void) {
    const sub = this.redis.duplicate();
    sub.subscribe(`group:${groupId}`);
    sub.on('message', (channel, message) => {
      listener(JSON.parse(message));
    });
    return () => sub.quit();
  }
}
```

### Option 3: Hybrid Approach (Best of Both Worlds)

1. **SSE** for real-time dashboards (current implementation)
2. **Webhooks** for external integrations (new)
3. **Database** for historical queries and replay

## Performance Considerations

### Current Setup (Single Server):
- ✅ Handles thousands of concurrent SSE connections
- ✅ Low latency (< 10ms event delivery)
- ✅ Minimal memory usage

### Scaling to Multiple Servers:
- Use Redis pub/sub instead of EventEmitter
- Or use a message queue (RabbitMQ, AWS SQS)
- Consider database triggers for guaranteed delivery

## Security

1. **API Key Authentication**: All endpoints require valid API key
2. **Group Isolation**: Events are scoped by `groupId`
3. **Webhook Signing**: Use HMAC-SHA256 for webhook verification (if implemented)

## Monitoring

Track:
- Number of active SSE connections
- Webhook delivery success rate
- Event bus memory usage
- Database write latency

