import { GoFindMeError } from './errors.js';
import type {
  GoFindMeClientConfig,
  HealthResponse,
  LocationEvent,
  LocationResponse,
  LocationUpdatePayload,
} from './types.js';

/**
 * GoFindMe Client SDK
 *
 * This client provides methods to interact with the GoFindMe Location Tracking API.
 * It uses API key authentication and supports both submitting locations and
 * streaming real-time location updates. The client automatically connects to the
 * stream on initialization.
 *
 * @example
 * ```typescript
 * import { GoFindMeClient } from '@gofindme/client';
 *
 * const client = new GoFindMeClient({
 *   apiKey: 'your-api-key',
 *   baseUrl: 'https://api.gofindme.com',
 *   onLocation: (location) => {
 *     console.log('Location update:', location);
 *   },
 *   onData: (event) => {
 *     console.log('Stream event:', event);
 *   }
 * });
 *
 * // Query latest locations
 * const locations = await client.getLatestLocations();
 * console.log('Latest locations:', locations);
 * ```
 */
export class GoFindMeClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly onLocationHandler?: (location: LocationEvent) => void;
  private readonly onDataHandler?: (event: { type: string; data: unknown }) => void;
  private abortController: AbortController | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private isClosed = false;
  private eventHandlers = new Map<
    string,
    Set<(event: { type: string; data: unknown }) => void>
  >();

  /**
   * Create a new GoFindMe client instance
   *
   * The client automatically connects to the stream on initialization.
   *
   * @param config - Client configuration
   * @param config.apiKey - Your GoFindMe API key
   * @param config.baseUrl - Base URL of the GoFindMe API (defaults to https://api.gofindme.com)
   * @param config.onLocation - Optional callback for location events
   * @param config.onData - Optional callback for all stream events
   * @param config.autoConnect - Whether to automatically connect to the stream (defaults to true)
   */
  constructor(config: GoFindMeClientConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }

    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.gofindme.com';
    this.onLocationHandler = config.onLocation;
    this.onDataHandler = config.onData;

    // Auto-connect to stream if enabled (default: true)
    if (config.autoConnect !== false) {
      this.connect();
    }
  }

  /**
   * Submit a location update to the GoFindMe API
   *
   * @param data - Location data to submit
   * @returns Promise resolving to the location response
   * @throws {GoFindMeError} If the request fails
   *
   * @example
   * ```typescript
   * const response = await client.submitLocation({
   *   deviceId: 'my-device-123',
   *   latitude: 37.7749,
   *   longitude: -122.4194,
   *   accuracy: 10,
   *   speed: 5.2,
   *   heading: 45,
   *   recordedAt: new Date(),
   *   metadata: { battery: 85, signal: 'strong' }
   * });
   * ```
   */
  async submitLocation(
    data: LocationUpdatePayload
  ): Promise<LocationResponse> {
    const response = await fetch(`${this.baseUrl}/api/v1/locations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({
        ...data,
        recordedAt:
          data.recordedAt instanceof Date
            ? data.recordedAt.toISOString()
            : data.recordedAt,
      }),
    });

    if (!response.ok) {
      throw await GoFindMeError.fromResponse(response);
    }

    return response.json();
  }

  /**
   * Connect to the location stream
   *
   * This method is called automatically on initialization unless autoConnect is set to false.
   * You can also call it manually to reconnect after closing the stream.
   */
  connect(): void {
    if (!this.isClosed && this.abortController) {
      // Already connected
      return;
    }

    this.isClosed = false;
    const url = `${this.baseUrl}/api/v1/stream`;

    const emit = (type: string, data: unknown) => {
      // Call registered event handlers
      const handlers = this.eventHandlers.get(type);
      if (handlers) {
        handlers.forEach((handler) => handler({ type, data }));
      }

      // Call onData handler if provided
      if (this.onDataHandler) {
        this.onDataHandler({ type, data });
      }

      // Call onLocation handler for location events
      if (type === 'location' && this.onLocationHandler) {
        this.onLocationHandler(data as LocationEvent);
      }
    };

    // Start the stream
    this.abortController = new AbortController();
    fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': this.apiKey,
        Accept: 'text/event-stream',
      },
      signal: this.abortController.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          emit('error', {
            status: response.status,
            statusText: response.statusText,
            message: `HTTP ${response.status}: ${response.statusText}`,
          });
          this.close();
          return;
        }

        if (!response.body) {
          emit('error', { message: 'Response body is null' });
          this.close();
          return;
        }

        this.reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const { value, done } = await this.reader.read();

            if (done) {
              this.close();
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
                let eventType = 'message';
                let eventData = '';

                // Parse SSE format: "event: <type>\ndata: <data>"
                for (const line of eventString.split('\n')) {
                  const colonIndex = line.indexOf(':');
                  if (colonIndex === -1) continue;

                  const field = line.slice(0, colonIndex).trim();
                  const value = line.slice(colonIndex + 1).trim();

                  if (field === 'event') {
                    eventType = value;
                  } else if (field === 'data') {
                    eventData = value;
                  }
                }

                try {
                  const parsedData = JSON.parse(eventData);
                  emit(eventType as 'location' | 'ready' | 'heartbeat', parsedData);
                } catch {
                  // If parsing fails, emit raw data
                  emit(eventType as 'location' | 'ready' | 'heartbeat', eventData);
                }
              }
            }
          }
        } catch (error) {
          if (!this.isClosed) {
            emit('error', {
              message:
                error instanceof Error ? error.message : 'Unknown stream error',
              error,
            });
            this.close();
          }
        }
      })
      .catch((error) => {
        if (!this.isClosed && error.name !== 'AbortError') {
          emit('error', {
            message: error instanceof Error ? error.message : 'Connection failed',
            error,
          });
          this.close();
        }
      });
  }

  /**
   * Close the stream connection
   */
  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.abortController?.abort();
    this.reader?.cancel().catch(() => {
      // Ignore cancel errors
    });
    this.eventHandlers.clear();
  }

  /**
   * Add an event listener for stream events
   *
   * @param event - Event type to listen for
   * @param handler - Event handler function
   *
   * @example
   * ```typescript
   * client.addEventListener('location', (event) => {
   *   console.log('Location:', event.data);
   * });
   * ```
   */
  addEventListener(
    event: 'location' | 'ready' | 'heartbeat' | 'error',
    handler: (event: { type: string; data: unknown }) => void
  ): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Remove an event listener
   *
   * @param event - Event type
   * @param handler - Event handler function to remove
   */
  removeEventListener(
    event: 'location' | 'ready' | 'heartbeat' | 'error',
    handler: (event: { type: string; data: unknown }) => void
  ): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  /**
   * Get the latest location data
   *
   * Queries the API for the most recent location updates.
   *
   * @param options - Query options
   * @param options.deviceId - Optional device ID to filter by
   * @param options.limit - Maximum number of locations to return (default: 50, max: 100)
   * @returns Promise resolving to an array of location events
   * @throws {GoFindMeError} If the request fails
   *
   * @example
   * ```typescript
   * // Get latest locations
   * const locations = await client.getLatestLocations();
   *
   * // Get latest locations for a specific device
   * const deviceLocations = await client.getLatestLocations({ deviceId: 'device-123' });
   *
   * // Get latest 10 locations
   * const recent = await client.getLatestLocations({ limit: 10 });
   * ```
   */
  async getLatestLocations(options?: {
    deviceId?: string;
    limit?: number;
  }): Promise<{ items: LocationEvent[] }> {
    const params = new URLSearchParams();
    if (options?.deviceId) {
      params.append('deviceId', options.deviceId);
    }
    if (options?.limit) {
      params.append('limit', options.limit.toString());
    }

    const url = `${this.baseUrl}/api/v1/locations${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw await GoFindMeError.fromResponse(response);
    }

    return response.json();
  }

  /**
   * Check the health status of the GoFindMe API
   *
   * @returns Promise resolving to health status
   * @throws {GoFindMeError} If the request fails
   *
   * @example
   * ```typescript
   * const health = await client.health();
   * console.log('API Status:', health.status);
   * ```
   */
  async health(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/api/v1/health`);

    if (!response.ok) {
      throw await GoFindMeError.fromResponse(response);
    }

    return response.json();
  }
}
