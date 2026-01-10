# @gofindme/client Package Setup

This document summarizes the setup for the @gofindme/client npm package.

## Package Structure

```
packages/client/
├── src/
│   ├── index.ts       # Main entry point - exports all public APIs
│   ├── client.ts      # GoFindMeClient class implementation
│   ├── types.ts       # TypeScript type definitions
│   └── errors.ts      # Custom error classes
├── dist/              # Compiled JavaScript and TypeScript definitions (generated)
├── package.json       # Package metadata and scripts
├── tsconfig.json      # TypeScript configuration
├── README.md          # User-facing documentation
├── PUBLISHING.md      # Publishing guide
├── CHANGELOG.md       # Version history
├── .npmignore        # Files to exclude from npm package
└── .gitignore        # Files to exclude from git
```

## Current Configuration

- **Package Name**: `@gofindme/client`
- **Version**: `0.1.0`
- **Publish Access**: Private (restricted) by default
- **Module Type**: ESM (ES Modules)

## Building

```bash
# From root directory
npm run client:build

# Or from client directory
cd packages/client
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory and generates type definitions.

## Publishing

### Private Package (Default)

```bash
# From root
npm run client:publish

# Or from client directory
cd packages/client
npm publish
```

The package is configured with `"access": "restricted"` in `package.json`, making it a private package.

### Public Package

To publish as public:

1. Update `packages/client/package.json`:
   ```json
   {
     "publishConfig": {
       "access": "public"
     }
   }
   ```

2. Publish:
   ```bash
   npm run client:publish:public
   # Or: cd packages/client && npm publish --access public
   ```

## Local Development

The location-test app is configured to use the package via local file path:

```json
{
  "dependencies": {
    "@gofindme/client": "file:../gofindme-server/packages/client"
  }
}
```

This allows testing the package locally without publishing.

## What's Included

The client package exposes only the **public API**:

✅ **Included:**
- `POST /api/v1/locations` - Submit location updates
- `GET /api/v1/stream` - Stream location events (SSE)
- `GET /api/v1/health` - Health check
- API key authentication

❌ **Not Included:**
- Internal endpoints (`/api/internal/*`)
- Auth0 authentication
- Group management
- API key management

## API Methods

### `GoFindMeClient`

- `constructor(config: GoFindMeClientConfig)` - Create client instance
- `submitLocation(data: LocationUpdatePayload): Promise<LocationResponse>` - Submit location
- `streamLocations(): StreamObject` - Stream location events (returns object with `addEventListener`, `removeEventListener`, `close`)
- `health(): Promise<HealthResponse>` - Check API health

## Stream API

The `streamLocations()` method returns an object (not EventSource) because EventSource doesn't support custom headers. It uses `fetch()` with manual SSE parsing to properly authenticate with the API key.

```typescript
const stream = client.streamLocations();

stream.addEventListener('location', (event) => {
  const location: LocationEvent = event.data;
  console.log('Location update:', location);
});

stream.addEventListener('ready', () => {
  console.log('Stream connected');
});

stream.addEventListener('error', (event) => {
  console.error('Stream error:', event.data);
});

stream.close(); // Close the stream
```

## Testing

1. Build the package:
   ```bash
   cd packages/client
   npm run build
   ```

2. In the location-test app:
   ```bash
   cd ~/git/location-test
   npm install  # Installs from local file path
   npm run dev
   ```

3. Open http://localhost:3000 and test the connection with your API key.

## Next Steps

1. **Test the package** with the location-test app
2. **Publish as private** when ready: `npm run client:publish`
3. **Get feedback** and iterate on the API
4. **Publish as public** when ready by updating `publishConfig.access` to `"public"`
