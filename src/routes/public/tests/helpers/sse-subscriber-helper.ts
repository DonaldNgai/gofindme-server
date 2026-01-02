/**
 * Helper for managing SSE subscriber in tests
 *
 * This helper provides an in-process SSE client that connects directly
 * to the Fastify server's /stream endpoint, avoiding the need for
 * a separate process.
 */

export type SubscriberConnectionResult = {
  success: boolean;
  statusCode?: number;
  statusText?: string;
  error?: string;
  connectedAt?: string;
  disconnectedAt?: string;
  groupId?: string | null;
};

type ExpectedLocation = {
  deviceId: string;
  latitude: number;
  longitude: number;
  groupId?: string;
};

type ReceivedLocation = {
  deviceId: string;
  latitude: number;
  longitude: number;
  groupId?: string;
  receivedAt: string;
};

export class SSESubscriberHelper {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private isConnected = false;
  private currentApiKey: string | null = null;
  private connectionResult: SubscriberConnectionResult | null = null;
  private receivedLocations: ReceivedLocation[] = [];
  private expectedLocations: ExpectedLocation[] = [];
  private testId: string | null = null;
  private serverBaseUrl: string;

  constructor(serverBaseUrl: string = 'http://localhost:3000') {
    this.serverBaseUrl = serverBaseUrl;
  }

  /**
   * Start the SSE subscriber (no-op for in-process version)
   */
  async start(): Promise<void> {
    // No-op - we connect directly when connect() is called
    console.log('[SSE Helper] In-process SSE subscriber ready');
  }

  /**
   * Stop the SSE subscriber
   */
  async stop(): Promise<void> {
    await this.disconnect();
  }

  /**
   * Check if the subscriber is running and ready
   */
  async isRunning(): Promise<boolean> {
    return this.isConnected && this.reader !== null;
  }

  /**
   * Connect to SSE stream with an API key
   */
  async connect(apiKey: string): Promise<SubscriberConnectionResult> {
    // Disconnect existing connection if any
    await this.disconnect();

    this.currentApiKey = apiKey;
    const result: SubscriberConnectionResult = {
      success: false,
    };

    return new Promise((resolve) => {
      try {
        // Create EventSource with API key in header
        // Note: EventSource doesn't support custom headers, so we need to use fetch + manual parsing
        const url = `${this.serverBaseUrl}/api/v1/stream`;

        console.log(`[SSE Helper] Connecting to: ${url}`);
        console.log(`[SSE Helper] Using API key: ${apiKey.substring(0, 20)}...`);

        fetch(url, {
          headers: {
            'X-API-Key': apiKey,
            Accept: 'text/event-stream',
          },
        })
          .then(async (response) => {
            if (!response.ok) {
              result.success = false;
              result.statusCode = response.status;
              result.statusText = response.statusText;
              result.error = await response.text().catch(() => 'Unknown error');
              result.connectedAt = new Date().toISOString();
              this.connectionResult = result;
              resolve(result);
              return;
            }

            result.success = true;
            result.statusCode = response.status;
            result.connectedAt = new Date().toISOString();
            this.connectionResult = result;

            // Parse SSE stream manually
            const streamReader = response.body?.getReader();
            if (streamReader) {
              this.reader = streamReader;
              this.isConnected = true;

              const decoder = new TextDecoder();
              let buffer = '';

              const readChunk = async () => {
                try {
                  if (!this.reader) return;

                  const { done, value } = await this.reader.read();
                  if (done) {
                    this.isConnected = false;
                    result.disconnectedAt = new Date().toISOString();
                    this.connectionResult = result;
                    return;
                  }

                  buffer += decoder.decode(value, { stream: true });
                  const lines = buffer.split('\n');
                  buffer = lines.pop() || ''; // Keep incomplete line in buffer

                  for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (line.startsWith('event: ')) {
                      const eventType = line.slice(7);
                      const dataLine = lines[i + 1];
                      if (dataLine?.startsWith('data: ')) {
                        const data = JSON.parse(dataLine.slice(6));
                        this.handleSSEEvent(eventType, data);
                      }
                    } else if (line.startsWith('data: ')) {
                      const data = JSON.parse(line.slice(6));
                      this.handleSSEEvent('message', data);
                    }
                  }

                  await readChunk();
                } catch (error) {
                  console.error('[SSE Helper] Error reading SSE stream:', error);
                  this.isConnected = false;
                  result.disconnectedAt = new Date().toISOString();
                  result.error = error instanceof Error ? error.message : 'Unknown error';
                  this.connectionResult = result;
                }
              };

              readChunk();
            }

            resolve(result);
          })
          .catch((error) => {
            console.error(`[SSE Helper] Fetch error:`, error.message);
            console.error(`[SSE Helper] Error stack:`, error.stack);
            result.success = false;
            result.error = error.message;
            result.connectedAt = new Date().toISOString();
            this.connectionResult = result;
            resolve(result);
          });
      } catch (error) {
        result.success = false;
        result.error = error instanceof Error ? error.message : 'Unknown error';
        this.connectionResult = result;
        resolve(result);
      }
    });
  }

  private handleSSEEvent(eventType: string, data: Record<string, unknown>): void {
    if (eventType === 'location' && typeof data.deviceId === 'string') {
      this.receivedLocations.push({
        deviceId: data.deviceId,
        latitude: typeof data.latitude === 'number' ? data.latitude : 0,
        longitude: typeof data.longitude === 'number' ? data.longitude : 0,
        groupId: typeof data.groupId === 'string' ? data.groupId : undefined,
        receivedAt: new Date().toISOString(),
      });
    } else if (eventType === 'ready' && typeof data.groupId === 'string') {
      if (this.connectionResult) {
        this.connectionResult.groupId = data.groupId;
      }
    }
  }

  /**
   * Disconnect from SSE stream
   */
  async disconnect(): Promise<void> {
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        // Ignore cancel errors
      }
      this.reader = null;
    }
    this.isConnected = false;
    this.currentApiKey = null;
    if (this.connectionResult) {
      this.connectionResult.disconnectedAt = new Date().toISOString();
    }
  }

  /**
   * Reset test state
   */
  async reset(): Promise<void> {
    await this.disconnect();
    this.receivedLocations = [];
    this.expectedLocations = [];
    this.testId = null;
    this.connectionResult = null;
  }

  /**
   * Set expected locations
   */
  async expectLocations(testId: string, expectedLocations: ExpectedLocation[]): Promise<void> {
    this.testId = testId;
    this.expectedLocations = expectedLocations;
    this.receivedLocations = []; // Clear previous received locations
  }

  /**
   * Validate received locations
   */
  async validateLocations(timeout = 2000): Promise<{
    success: boolean;
    results: Array<{
      expected: ExpectedLocation;
      received: ReceivedLocation | null;
      matched: boolean;
    }>;
    receivedCount: number;
    expectedCount: number;
  }> {
    // Wait for locations to arrive
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (this.receivedLocations.length >= this.expectedLocations.length) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const results = this.expectedLocations.map((expected) => {
      const received = this.receivedLocations.find(
        (r) =>
          r.deviceId === expected.deviceId &&
          Math.abs(r.latitude - expected.latitude) < 0.0001 &&
          Math.abs(r.longitude - expected.longitude) < 0.0001
      );

      return {
        expected,
        received: received || null,
        matched: received !== undefined,
      };
    });

    return {
      success: results.every((r) => r.matched),
      results,
      receivedCount: this.receivedLocations.length,
      expectedCount: this.expectedLocations.length,
    };
  }

  /**
   * Get current state
   */
  async getState(): Promise<{
    testId: string | null;
    expectedCount: number;
    receivedCount: number;
    ready: boolean;
    groupId: string | null;
    currentApiKey: string | null;
    connectionResult: SubscriberConnectionResult | null;
    receivedLocations: ReceivedLocation[];
  }> {
    return {
      testId: this.testId,
      expectedCount: this.expectedLocations.length,
      receivedCount: this.receivedLocations.length,
      ready: this.isConnected && this.reader !== null,
      groupId: this.connectionResult?.groupId || null,
      currentApiKey: this.currentApiKey,
      connectionResult: this.connectionResult,
      receivedLocations: this.receivedLocations,
    };
  }

  /**
   * Get health status
   */
  async getHealth(): Promise<{
    status: string;
    connected: boolean;
    ready: boolean;
    groupId: string | null;
    currentApiKey: string | null;
    connectionResult: SubscriberConnectionResult | null;
  }> {
    return {
      status: this.isConnected ? 'connected' : 'disconnected',
      connected: this.isConnected,
      ready: this.isConnected && this.reader !== null,
      groupId: this.connectionResult?.groupId || null,
      currentApiKey: this.currentApiKey,
      connectionResult: this.connectionResult,
    };
  }
}

// Singleton instance
let subscriberHelper: SSESubscriberHelper | null = null;

/**
 * Get or create the SSE subscriber helper instance
 */
export function getSSESubscriberHelper(serverBaseUrl?: string): SSESubscriberHelper {
  if (!subscriberHelper) {
    subscriberHelper = new SSESubscriberHelper(serverBaseUrl);
  }
  return subscriberHelper;
}
