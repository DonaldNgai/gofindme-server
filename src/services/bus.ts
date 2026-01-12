import { EventEmitter } from 'node:events';
import type { LocationUpdatePayload } from '../types/location.js';

export type GroupEvent = {
  type: 'location';
  data: LocationUpdatePayload & { groupId: string };
};

type SubscriberInfo = {
  apiKeyId: string;
  groupId: string;
  subscribedAt: Date;
};

class LocationBus extends EventEmitter {
  /**
   * Track active subscribers per group
   * Key: groupId, Value: Set of API key IDs that are subscribed
   */
  private activeSubscribers = new Map<string, Set<string>>();

  /**
   * Track subscriber details
   * Key: API key ID, Value: SubscriberInfo
   */
  private subscriberDetails = new Map<string, SubscriberInfo>();

  /**
   * Publish location to a single group
   * Only publishes if there are active subscribers for that group
   */
  publishLocation(groupId: string, payload: LocationUpdatePayload): void {
    // Only publish if there are active subscribers for this group
    const subscribers = this.activeSubscribers.get(groupId);
    if (!subscribers || subscribers.size === 0) {
      // No active subscribers for this group, skip publishing
      console.log('[LocationBus] publishLocation skipped - no subscribers', { groupId });
      return;
    }

    const enriched: GroupEvent = {
      type: 'location',
      data: { ...payload, groupId },
    };
    console.log('[LocationBus] publishLocation emitting', { groupId, subscriberCount: subscribers.size, deviceId: payload.deviceId });
    this.emit(groupId, enriched);
  }

  /**
   * Publish location to multiple groups (for authorized groups only)
   * Only publishes to groups that have active subscribers
   */
  publishLocationToGroups(groupIds: string[], payload: LocationUpdatePayload): void {
    // Only publish to groups that have active subscribers
    const groupsWithSubscribers = groupIds.filter(
      (groupId) => this.activeSubscribers.has(groupId) && this.activeSubscribers.get(groupId)!.size > 0
    );

    // Debug logging
    console.log('[LocationBus] publishLocationToGroups called', {
      targetGroups: groupIds,
      groupsWithSubscribers,
      totalSubscribers: groupsWithSubscribers.reduce((sum, gid) => sum + (this.activeSubscribers.get(gid)?.size ?? 0), 0),
      allSubscribedGroups: Array.from(this.activeSubscribers.keys()),
    });

    groupsWithSubscribers.forEach((groupId) => {
      this.publishLocation(groupId, payload);
    });
  }

  /**
   * Subscribe to location updates for a group
   * Requires a valid API key ID to track the subscription
   *
   * @param groupId - The group ID to subscribe to (must match the API key's group)
   * @param apiKeyId - The API key ID (used for tracking authorized subscriptions)
   * @param listener - Event listener function
   * @returns Unsubscribe function
   */
  subscribe(
    groupId: string,
    apiKeyId: string,
    listener: (event: GroupEvent) => void
  ): () => void {
    // Track this subscriber
    if (!this.activeSubscribers.has(groupId)) {
      this.activeSubscribers.set(groupId, new Set());
    }
    this.activeSubscribers.get(groupId)!.add(apiKeyId);

    // Store subscriber details
    this.subscriberDetails.set(apiKeyId, {
      apiKeyId,
      groupId,
      subscribedAt: new Date(),
    });

    // Add event listener
    this.on(groupId, listener);

    console.log('[LocationBus] subscribe called', {
      groupId,
      apiKeyId,
      subscriberCount: this.activeSubscribers.get(groupId)?.size ?? 0,
      allSubscribedGroups: Array.from(this.activeSubscribers.keys()),
    });

    // Return unsubscribe function
    return () => {
      this.unsubscribe(groupId, apiKeyId, listener);
    };
  }

  /**
   * Subscribe for testing purposes (internal/test use only)
   * Creates a test API key ID for tracking
   *
   * @param groupId - The group ID to subscribe to
   * @param listener - Event listener function
   * @returns Unsubscribe function
   */
  subscribeForTesting(groupId: string, listener: (event: GroupEvent) => void): () => void {
    const testApiKeyId = `test-${groupId}-${Date.now()}`;
    return this.subscribe(groupId, testApiKeyId, listener);
  }

  /**
   * Unsubscribe from location updates for a group
   *
   * @param groupId - The group ID to unsubscribe from
   * @param apiKeyId - The API key ID
   * @param listener - Event listener function to remove
   */
  private unsubscribe(groupId: string, apiKeyId: string, listener: (event: GroupEvent) => void): void {
    // Remove event listener
    this.off(groupId, listener);

    // Remove from tracking
    const subscribers = this.activeSubscribers.get(groupId);
    if (subscribers) {
      subscribers.delete(apiKeyId);
      if (subscribers.size === 0) {
        this.activeSubscribers.delete(groupId);
      }
    }

    // Remove subscriber details
    this.subscriberDetails.delete(apiKeyId);
  }

  /**
   * Get the number of active subscribers for a group
   */
  getSubscriberCount(groupId: string): number {
    return this.activeSubscribers.get(groupId)?.size ?? 0;
  }

  /**
   * Check if a group has any active subscribers
   */
  hasSubscribers(groupId: string): boolean {
    return this.getSubscriberCount(groupId) > 0;
  }

  /**
   * Get all groups with active subscribers
   */
  getGroupsWithSubscribers(): string[] {
    return Array.from(this.activeSubscribers.keys()).filter(
      (groupId) => this.hasSubscribers(groupId)
    );
  }

  /**
   * Get subscriber info for a specific API key
   */
  getSubscriberInfo(apiKeyId: string): SubscriberInfo | undefined {
    return this.subscriberDetails.get(apiKeyId);
  }
}

export const locationBus = new LocationBus();
