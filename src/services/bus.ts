import { EventEmitter } from 'node:events';
import type { LocationUpdatePayload } from '../types/location.js';

export type GroupEvent = {
  type: 'location';
  data: LocationUpdatePayload & { groupId: string };
};

class LocationBus extends EventEmitter {
  /**
   * Publish location to a single group
   */
  publishLocation(groupId: string, payload: LocationUpdatePayload): void {
    const enriched: GroupEvent = {
      type: 'location',
      data: { ...payload, groupId },
    };
    this.emit(groupId, enriched);
  }

  /**
   * Publish location to multiple groups (for authorized groups only)
   */
  publishLocationToGroups(groupIds: string[], payload: LocationUpdatePayload): void {
    groupIds.forEach((groupId) => {
      this.publishLocation(groupId, payload);
    });
  }

  subscribe(groupId: string, listener: (event: GroupEvent) => void): () => void {
    this.on(groupId, listener);
    return () => {
      this.off(groupId, listener);
    };
  }
}

export const locationBus = new LocationBus();
