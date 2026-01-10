# @gofindme/client

Official GoFindMe Location Tracking Client SDK for JavaScript and TypeScript.

## Installation

```bash
npm install @gofindme/client
```

## Quick Start

```typescript
import { GoFindMeClient } from '@gofindme/client';

const client = new GoFindMeClient({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.gofindme.com' // optional, defaults to https://api.gofindme.com
});

// Submit a location update
await client.submitLocation({
  deviceId: 'device-123',
  latitude: 37.7749,
  longitude: -122.4194,
  recordedAt: new Date()
});

// Stream real-time location updates
const stream = client.streamLocations();
stream.addEventListener('location', (event) => {
  const location = JSON.parse(event.data);
  console.log('Location update:', location);
});
```

## API Reference

### `GoFindMeClient`

Main client class for interacting with the GoFindMe API.

#### Constructor

```typescript
new GoFindMeClient(config: GoFindMeClientConfig)
```

**Parameters:**
- `config.apiKey` (string, required): Your GoFindMe API key
- `config.baseUrl` (string, optional): Base URL of the GoFindMe API (defaults to `https://api.gofindme.com`)

#### Methods

##### `submitLocation(data: LocationUpdatePayload): Promise<LocationResponse>`

Submit a location update to the API.

**Parameters:**
- `data.deviceId` (string): Unique identifier for the device
- `data.latitude` (number): Latitude in decimal degrees (-90 to 90)
- `data.longitude` (number): Longitude in decimal degrees (-180 to 180)
- `data.recordedAt` (Date | string): When the location was recorded
- `data.accuracy` (number, optional): Location accuracy in meters
- `data.heading` (number, optional): Direction of travel in degrees (0-360)
- `data.speed` (number, optional): Speed in meters per second
- `data.metadata` (object, optional): Additional metadata as key-value pairs
- `data.groupIds` (string[], optional): Array of group IDs to target

**Returns:** Promise resolving to `LocationResponse` with `id` and `receivedAt` fields.

**Throws:** `GoFindMeError` if the request fails.

##### `streamLocations(): EventSource`

Stream location events using Server-Sent Events (SSE).

**Returns:** `EventSource` instance that emits the following events:
- `location`: Emitted when a new location update is received
- `ready`: Emitted when the stream is ready
- `heartbeat`: Emitted periodically to keep the connection alive
- `error`: Emitted when an error occurs

**Example:**
```typescript
const stream = client.streamLocations();

stream.addEventListener('location', (event) => {
  const location: LocationEvent = JSON.parse(event.data);
  // Handle location update
});

stream.addEventListener('error', (error) => {
  // Handle error
});

// Close the stream when done
stream.close();
```

##### `health(): Promise<HealthResponse>`

Check the health status of the GoFindMe API.

**Returns:** Promise resolving to `HealthResponse` with `status`, `timestamp`, and `uptime` fields.

**Throws:** `GoFindMeError` if the request fails.

## Types

### `LocationUpdatePayload`

```typescript
interface LocationUpdatePayload {
  deviceId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  recordedAt: Date | string;
  metadata?: Record<string, unknown>;
  payloadVersion?: string;
  groupIds?: string[];
}
```

### `LocationEvent`

```typescript
interface LocationEvent {
  id: string;
  groupId: string;
  deviceId: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  recordedAt: string;
  receivedAt: string;
  metadata?: Record<string, unknown> | null;
}
```

### `LocationResponse`

```typescript
interface LocationResponse {
  id: string;
  receivedAt: string;
}
```

## Error Handling

The client throws `GoFindMeError` instances when API requests fail:

```typescript
import { GoFindMeClient, GoFindMeError } from '@gofindme/client';

try {
  await client.submitLocation({ /* ... */ });
} catch (error) {
  if (error instanceof GoFindMeError) {
    console.error('API Error:', error.message);
    console.error('Status Code:', error.statusCode);
    console.error('Response:', error.response);
  }
}
```

## License

MIT
