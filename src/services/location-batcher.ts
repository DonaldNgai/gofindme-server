import type { LocationUpdatePayload } from '../types/location.js';
import { locationBus } from './bus.js';

export interface QueuedLocationUpdate {
  payload: LocationUpdatePayload;
  userId: string;
  deviceId: string;
  queuedAt: Date;
}

/**
 * Location Batcher Service
 * 
 * Implements bus schedule-style location batching:
 * - Stores location updates in queues per group
 * - Has scheduled intervals (e.g., every 30s, 1m, 5m)
 * - At each interval, publishes all queued updates for groups that are due
 * 
 * This allows multiple groups to share the same location data but receive updates
 * at different frequencies, like a bus schedule.
 */
class LocationBatcher {
  // Map of groupId -> queue of location updates waiting to be published
  private groupQueues: Map<string, QueuedLocationUpdate[]> = new Map();
  
  // Map of groupId -> last published timestamp
  private lastPublished: Map<string, Date> = new Map();
  
  // Map of groupId -> update frequency in milliseconds
  private groupFrequencies: Map<string, number> = new Map();
  
  // Interval timers for each frequency
  private intervalTimers: Map<number, NodeJS.Timeout> = new Map();
  
  // All unique frequencies being used (in milliseconds)
  private frequencies: Set<number> = new Set();
  
  /**
   * Queue a location update for a specific group
   * @param groupId - The group ID to queue the update for
   * @param payload - The location update payload
   * @param userId - The user ID
   * @param deviceId - The device ID
   * @param frequencySeconds - Update frequency for this group in seconds (default: 30)
   */
  queueLocationUpdate(
    groupId: string,
    payload: LocationUpdatePayload,
    userId: string,
    deviceId: string,
    frequencySeconds: number = 30
  ): void {
    // Ensure queue exists for this group
    if (!this.groupQueues.has(groupId)) {
      this.groupQueues.set(groupId, []);
      this.lastPublished.set(groupId, new Date(0)); // Never published
    }
    
    // Store the frequency for this group
    const frequencyMs = frequencySeconds * 1000;
    this.groupFrequencies.set(groupId, frequencyMs);
    this.frequencies.add(frequencyMs);
    
    // Add location update to queue (only keep the latest update per user/device)
    // Remove any existing updates for this user/device in this group
    const queue = this.groupQueues.get(groupId)!;
    const filtered = queue.filter(
      (update) => !(update.userId === userId && update.deviceId === deviceId)
    );
    
    // Add the new update
    filtered.push({
      payload,
      userId,
      deviceId,
      queuedAt: new Date(),
    });
    
    this.groupQueues.set(groupId, filtered);
    
    // Ensure an interval timer exists for this frequency
    this.ensureIntervalTimer(frequencyMs);
  }
  
  /**
   * Ensure an interval timer exists for the given frequency
   */
  private ensureIntervalTimer(frequencyMs: number): void {
    if (this.intervalTimers.has(frequencyMs)) {
      return; // Timer already exists
    }
    
    // Create interval timer for this frequency
    const timer = setInterval(() => {
      this.processQueuesAtFrequency(frequencyMs);
    }, frequencyMs);
    
    // Start immediately (process any queued items)
    this.processQueuesAtFrequency(frequencyMs);
    
    this.intervalTimers.set(frequencyMs, timer);
  }
  
  /**
   * Process all queues that match the given frequency
   */
  private processQueuesAtFrequency(frequencyMs: number): void {
    const now = new Date();
    
    // Find all groups with this frequency
    for (const [groupId, frequency] of this.groupFrequencies.entries()) {
      if (frequency !== frequencyMs) {
        continue; // Skip groups with different frequencies
      }
      
      const lastPublished = this.lastPublished.get(groupId);
      const timeSinceLastPublished = lastPublished
        ? now.getTime() - lastPublished.getTime()
        : Infinity;
      
      // Check if enough time has passed since last publish
      if (timeSinceLastPublished >= frequencyMs) {
        this.publishQueuedUpdates(groupId);
      }
    }
  }
  
  /**
   * Publish all queued updates for a specific group
   */
  private publishQueuedUpdates(groupId: string): void {
    const queue = this.groupQueues.get(groupId);
    if (!queue || queue.length === 0) {
      return; // Nothing to publish
    }
    
    // Get the most recent update per user/device (in case multiple updates were queued)
    const latestUpdates = new Map<string, QueuedLocationUpdate>();
    
    for (const update of queue) {
      const key = `${update.userId}:${update.deviceId}`;
      const existing = latestUpdates.get(key);
      
      if (!existing || update.queuedAt > existing.queuedAt) {
        latestUpdates.set(key, update);
      }
    }
    
    // Publish each update to the group
    for (const update of latestUpdates.values()) {
      locationBus.publishLocation(groupId, update.payload);
    }
    
    // Clear the queue and update last published time
    this.groupQueues.set(groupId, []);
    this.lastPublished.set(groupId, new Date());
  }
  
  /**
   * Get the update frequency for a group
   */
  getGroupFrequency(groupId: string): number | null {
    const frequencyMs = this.groupFrequencies.get(groupId);
    return frequencyMs ? frequencyMs / 1000 : null; // Return in seconds
  }
  
  /**
   * Set the update frequency for a group
   */
  setGroupFrequency(groupId: string, frequencySeconds: number): void {
    const frequencyMs = frequencySeconds * 1000;
    this.groupFrequencies.set(groupId, frequencyMs);
    this.frequencies.add(frequencyMs);
    this.ensureIntervalTimer(frequencyMs);
  }
  
  /**
   * Clear queued updates for a specific group
   */
  clearGroupQueue(groupId: string): void {
    this.groupQueues.delete(groupId);
    this.lastPublished.delete(groupId);
    this.groupFrequencies.delete(groupId);
  }
  
  /**
   * Get stats about the batcher
   */
  getStats(): {
    activeGroups: number;
    queuedUpdates: number;
    frequencies: number[];
  } {
    let totalQueued = 0;
    for (const queue of this.groupQueues.values()) {
      totalQueued += queue.length;
    }
    
    return {
      activeGroups: this.groupQueues.size,
      queuedUpdates: totalQueued,
      frequencies: Array.from(this.frequencies).map((ms) => ms / 1000), // Convert to seconds
    };
  }
  
  /**
   * Cleanup - stop all timers
   */
  shutdown(): void {
    for (const timer of this.intervalTimers.values()) {
      clearInterval(timer);
    }
    this.intervalTimers.clear();
    this.groupQueues.clear();
    this.lastPublished.clear();
    this.groupFrequencies.clear();
    this.frequencies.clear();
  }
}

export const locationBatcher = new LocationBatcher();
