/**
 * Location update payload for submitting location data
 */
export interface LocationUpdatePayload {
  /** Unique identifier for the device */
  deviceId: string;
  /** Latitude in decimal degrees (-90 to 90) */
  latitude: number;
  /** Longitude in decimal degrees (-180 to 180) */
  longitude: number;
  /** Location accuracy in meters (optional) */
  accuracy?: number;
  /** Direction of travel in degrees (0-360, optional) */
  heading?: number;
  /** Speed in meters per second (optional) */
  speed?: number;
  /** When the location was recorded (ISO 8601 string or Date) */
  recordedAt: Date | string;
  /** Additional metadata as key-value pairs (optional) */
  metadata?: Record<string, unknown>;
  /** Payload version (defaults to 'v1') */
  payloadVersion?: string;
  /** Optional array of group IDs to target (optional) */
  groupIds?: string[];
}

/**
 * Response from submitting a location update
 */
export interface LocationResponse {
  /** Unique identifier for the location record */
  id: string;
  /** ISO 8601 timestamp when the location was received */
  receivedAt: string;
}

/**
 * Location event received from the stream
 */
export interface LocationEvent {
  /** Unique identifier for the location record */
  id: string;
  /** Group ID this location belongs to */
  groupId: string;
  /** Device ID that reported this location */
  deviceId: string;
  /** Latitude in decimal degrees */
  latitude: number;
  /** Longitude in decimal degrees */
  longitude: number;
  /** Location accuracy in meters (may be null) */
  accuracy?: number | null;
  /** Direction of travel in degrees (may be null) */
  heading?: number | null;
  /** Speed in meters per second (may be null) */
  speed?: number | null;
  /** ISO 8601 timestamp when the location was recorded */
  recordedAt: string;
  /** ISO 8601 timestamp when the location was received by the server */
  receivedAt: string;
  /** Additional metadata (may be null) */
  metadata?: Record<string, unknown> | null;
}

/**
 * Configuration for the GoFindMe client
 */
export interface GoFindMeClientConfig {
  /** API key for authentication */
  apiKey: string;
  /** Base URL of the GoFindMe API (defaults to https://api.gofindme.com) */
  baseUrl?: string;
  /** Callback function for location events */
  onLocation?: (location: LocationEvent) => void;
  /** Callback function for all stream events */
  onData?: (event: { type: string; data: unknown }) => void;
  /** Whether to automatically connect to the stream on initialization (defaults to true) */
  autoConnect?: boolean;
}

/**
 * Health check response
 */
export interface HealthResponse {
  /** Health status */
  status: string;
  /** ISO 8601 timestamp */
  timestamp?: string;
  /** Server uptime in seconds */
  uptime?: number;
}
