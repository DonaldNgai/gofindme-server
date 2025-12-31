# Scripts

## Test SSE Subscriber (`test-sse-subscriber.ts`)

A test script that subscribes to SSE events and coordinates with vitest tests to validate that location updates are properly delivered to apps.

### Usage

1. **Set up your `.env` file** with the API key:
   ```bash
   TEST_SSE_API_KEY=loc_your_api_key_here
   ```

2. **Start the subscriber script** (in a separate terminal):
   ```bash
   pnpm test:sse-subscriber
   # or
   tsx scripts/test-sse-subscriber.ts
   ```

3. **Run the vitest tests** (in another terminal):
   ```bash
   pnpm test
   ```

The test subscriber will:
- Subscribe to SSE events using the API key from `.env`
- Provide an HTTP API on port 3002 (configurable via `TEST_COORDINATOR_PORT`) for test coordination
- Receive expectations from vitest tests
- Validate that received location events match expectations

### Environment Variables

- `BASE_URL` (optional): Server URL (default: `http://localhost:3000`)
- `API_PREFIX` (optional): API prefix (default: `/api/v1`)
- `TEST_COORDINATOR_PORT` (optional): Port for test coordination API (default: `3002`)

**Note:** The script no longer requires `TEST_SSE_API_KEY` in `.env`. Instead, vitest tests control which API key to use via the `/connect` endpoint. This allows testing various scenarios (valid keys, invalid keys, revoked keys, etc.).

### Test Coordination API

The script exposes the following HTTP endpoints:

- `GET /health` - Check if subscriber is running and ready
- `POST /reset` - Reset test state
- `POST /expect` - Set expected locations (body: `{ testId, expectedLocations }`)
- `POST /validate` - Validate received locations match expectations (body: `{ timeout }`)
- `GET /state` - Get current test state

### Example

```bash
# Terminal 1: Start the server
pnpm dev

# Terminal 2: Start the test subscriber
pnpm test:sse-subscriber

# Terminal 3: Run tests
pnpm test
```

## Manual SSE Subscription (`subscribe-to-bus-pushes.ts`)

A simple script for manually subscribing to SSE events (useful for debugging).

### Usage

```bash
tsx scripts/subscribe-to-bus-pushes.ts [API_KEY]
# or
API_KEY=your-key tsx scripts/subscribe-to-bus-pushes.ts
```
