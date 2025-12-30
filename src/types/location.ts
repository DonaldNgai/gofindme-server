export type LocationUpdatePayload = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  recordedAt: Date;
  deviceId: string;
  metadata?: Record<string, unknown> | null;
  payloadVersion?: string;
};
