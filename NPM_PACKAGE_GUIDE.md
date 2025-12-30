# Creating the npm Package

This guide explains how to create an npm package that only exposes the public API endpoints.

## What to Include in npm Package

### ✅ Include (Public API)
- `POST /api/v1/locations` - Submit location updates
- `GET /api/v1/stream` - Stream location events  
- `GET /api/v1/health` - Health check

### ❌ Do NOT Include (Internal API)
- `/api/internal/*` - All internal endpoints
- Auth0 authentication methods
- Group management
- API key creation/management

## Package Structure

```
@gofindme/client/
├── src/
│   ├── client.ts          # Main client class
│   ├── types.ts           # TypeScript types
│   └── errors.ts          # Error classes
├── package.json
└── README.md
```

## Example Package Implementation

### `src/client.ts`

```typescript
export class GoFindMeClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: { apiKey: string; baseUrl?: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.gofindme.com';
  }

  async submitLocation(data: {
    deviceId: string;
    latitude: number;
    longitude: number;
    accuracy?: number;
    heading?: number;
    speed?: number;
    recordedAt: Date;
    metadata?: Record<string, unknown>;
  }) {
    const response = await fetch(`${this.baseUrl}/api/v1/locations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({
        ...data,
        recordedAt: data.recordedAt.toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to submit location: ${response.statusText}`);
    }

    return response.json();
  }

  streamLocations(): EventSource {
    return new EventSource(
      `${this.baseUrl}/api/v1/stream?apiKey=${this.apiKey}`
    );
  }
}
```

## Package.json

```json
{
  "name": "@gofindme/client",
  "version": "1.0.0",
  "description": "GoFindMe Location Tracking Client",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  },
  "keywords": ["location", "tracking", "gps"],
  "author": "Your Name",
  "license": "MIT"
}
```

## Usage Example (for package users)

```typescript
import { GoFindMeClient } from '@gofindme/client';

const client = new GoFindMeClient({
  apiKey: 'loc_abc123_secret',
  baseUrl: 'https://api.gofindme.com'
});

// Submit location
await client.submitLocation({
  deviceId: 'device-123',
  latitude: 37.7749,
  longitude: -122.4194,
  recordedAt: new Date()
});
```

## Security Notes

1. **Never expose internal endpoints** - They require Auth0 and should only be in your Next.js app
2. **API keys are sensitive** - Users should store them securely
3. **Rate limiting** - Public API has rate limits, document them
4. **CORS** - Configure CORS for your frontend domain only

## Publishing

```bash
# Build
npm run build

# Publish
npm publish --access public
```

