# Test Helpers

## SSE Subscriber Helper

The `sse-subscriber-helper.ts` provides a clean API for managing the SSE subscriber test process within Vitest tests.

### Features

- **Automatic Process Management**: Starts/stops the subscriber process automatically
- **Type-Safe API**: Full TypeScript support with proper types
- **Vitest Integration**: Works seamlessly with Vitest's lifecycle hooks
- **No Manual Setup**: No need to run the subscriber script separately

### Usage

```typescript
import { getSSESubscriberHelper } from './helpers/sse-subscriber-helper.js';

describe('SSE Tests', () => {
  const subscriber = getSSESubscriberHelper();
  let subscriberStarted = false;

  beforeAll(async () => {
    try {
      await subscriber.start();
      subscriberStarted = true;
    } catch (error) {
      console.warn('Failed to start SSE subscriber:', error);
    }
  });

  afterAll(async () => {
    if (subscriberStarted) {
      await subscriber.stop();
    }
  });

  it('should test SSE connection', async () => {
    if (!subscriberStarted) return;

    // Connect with an API key
    const result = await subscriber.connect('loc_your_api_key');
    expect(result.success).toBe(true);

    // Set expectations
    await subscriber.expectLocations('test-1', [
      { deviceId: 'device-1', latitude: 37.7749, longitude: -122.4194 }
    ]);

    // ... trigger location updates ...

    // Validate
    const { success } = await subscriber.validateLocations();
    expect(success).toBe(true);

    // Cleanup
    await subscriber.disconnect();
  });
});
```

### API Methods

- `start()` - Start the subscriber process
- `stop()` - Stop the subscriber process
- `connect(apiKey)` - Connect to SSE stream with an API key
- `disconnect()` - Disconnect from SSE stream
- `reset()` - Reset test state
- `expectLocations(testId, locations)` - Set expected locations
- `validateLocations(timeout)` - Validate received locations
- `getState()` - Get current test state
- `getHealth()` - Get health status
- `isRunning()` - Check if subscriber is running

### Benefits Over Manual Script

1. **Integrated Testing**: No separate terminal needed
2. **Automatic Cleanup**: Process is killed after tests
3. **Better Error Handling**: Proper error messages if process fails to start
4. **Type Safety**: Full TypeScript support
5. **Reusable**: Can be used across multiple test files
