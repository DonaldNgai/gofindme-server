import { EventEmitter } from 'node:events';
import type { LocationUpdatePayload } from '../types/location.js';

export type GroupEvent = {
  type: 'location';
  data: LocationUpdatePayload & { groupId: string };
};

class LocationBus extends EventEmitter {
  publishLocation(groupId: string, payload: LocationUpdatePayload): void {
    const enriched: GroupEvent = {
      type: 'location',
      data: { ...payload, groupId },
    };
    this.emit(groupId, enriched);
  }

  subscribe(groupId: string, listener: (event: GroupEvent) => void): () => void {
    this.on(groupId, listener);
    return () => {
      this.off(groupId, listener);
    };
  }
}

export const locationBus = new LocationBus();
