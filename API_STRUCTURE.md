# API Structure - Public vs Internal Routes

This document explains the separation between public API routes (for npm package) and internal routes (for your Next.js frontend).

## Route Organization

### Public Routes (`/api/v1/*`)
**For: npm package users with API keys**

These endpoints are part of the public API that developers will use via your npm package:

- `POST /api/v1/locations` - Submit location updates (requires API key)
- `GET /api/v1/stream` - Stream location events (requires API key)
- `GET /api/v1/health` - Health check (public)

**Authentication:** API Key via `X-API-Key` header

### Internal Routes (`/api/internal/*`)
**For: Your Next.js frontend with Auth0**

These endpoints are for administrative operations and should NOT be exposed in the npm package:

- `POST /api/internal/groups` - Create a group (requires Auth0)
- `GET /api/internal/groups` - List your groups (requires Auth0)
- `GET /api/internal/groups/:groupId` - Get group details (requires Auth0)
- `PATCH /api/internal/groups/:groupId` - Update group (requires Auth0)
- `DELETE /api/internal/groups/:groupId` - Delete group (requires Auth0)
- `POST /api/internal/groups/:groupId/join` - Join request (requires Auth0)
- `POST /api/internal/api-keys` - Create API key (requires Auth0)
- `GET /api/internal/api-keys` - List API keys (requires Auth0)
- `DELETE /api/internal/api-keys/:keyId` - Revoke API key (requires Auth0)

**Authentication:** Auth0 JWT token via `Authorization: Bearer <token>` header

## Security Model

### Public API (npm package)
- Uses **API Key** authentication
- Limited to location tracking operations
- Cannot create/manage groups or API keys
- Safe to expose to third-party developers

### Internal API (Next.js frontend)
- Uses **Auth0 JWT** authentication
- Full administrative access
- Can create/manage groups and API keys
- Only accessible to authenticated users from your Auth0 tenant

## Usage Examples

### For npm package users:

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

// Stream locations
const stream = client.streamLocations();
stream.on('location', (data) => {
  console.log('Location update:', data);
});
```

### For Next.js frontend:

```typescript
// Get Auth0 token first
const token = await getAuth0Token();

// Create a group
const group = await fetch('https://api.gofindme.com/api/internal/groups', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'My Fleet',
    description: 'Company vehicles'
  })
});

// Create API key for the group
const apiKey = await fetch('https://api.gofindme.com/api/internal/api-keys', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    groupId: group.id,
    label: 'Mobile App Key'
  })
});
```

## Swagger Documentation

- **Public API docs**: `/docs` - Shows only public endpoints
- **Internal endpoints**: Tagged with "Internal - *" in Swagger but still visible
  - Consider filtering these out in production or using separate Swagger instance

## Environment Variables

```env
# Public API prefix (for npm package)
API_PREFIX=/api/v1

# Internal API prefix (for Next.js frontend)
INTERNAL_API_PREFIX=/api/internal
```

## Creating the npm Package

When creating your npm package, only include:

1. **Public endpoints** (`/api/v1/*`)
2. **API key authentication** (not Auth0)
3. **Location tracking methods** only

Do NOT include:
- Internal endpoints (`/api/internal/*`)
- Auth0 authentication
- Group/API key management methods

## Next Steps

1. Create npm package that wraps only public endpoints
2. Document public API in package README
3. Keep internal routes for your Next.js admin dashboard
4. Consider rate limiting internal routes separately
5. Add CORS restrictions for internal routes if needed

