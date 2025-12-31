/**
 * Helper for managing the SSE subscriber test process
 * 
 * This helper manages the lifecycle of the test SSE subscriber script,
 * allowing tests to automatically start/stop it as needed.
 */

import { spawn, ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../../../../');
const SUBSCRIBER_SCRIPT = join(PROJECT_ROOT, 'scripts/test-sse-subscriber.ts');

const COORDINATOR_URL = process.env.TEST_COORDINATOR_URL || 'http://localhost:3002';
const COORDINATOR_PORT = parseInt(process.env.TEST_COORDINATOR_PORT || '3002', 10);

export type SubscriberConnectionResult = {
  success: boolean;
  statusCode?: number;
  statusText?: string;
  error?: string;
  connectedAt?: string;
  disconnectedAt?: string;
  groupId?: string | null;
};

export class SSESubscriberHelper {
  private process: ChildProcess | null = null;
  private isReady = false;

  /**
   * Start the SSE subscriber process
   */
  async start(): Promise<void> {
    if (this.process) {
      return; // Already started
    }

    return new Promise((resolve, reject) => {
      // Spawn the subscriber script
      this.process = spawn('tsx', [SUBSCRIBER_SCRIPT], {
        cwd: PROJECT_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TEST_COORDINATOR_PORT: COORDINATOR_PORT.toString(),
        },
      });

      let output = '';

      const checkReady = () => {
        if (output.includes('Ready for test coordination')) {
          this.isReady = true;
          resolve();
        }
      };

      this.process.stdout?.on('data', (data) => {
        output += data.toString();
        checkReady();
      });

      this.process.stderr?.on('data', (data) => {
        output += data.toString();
        // Don't treat stderr as error - the script logs to stderr
      });

      this.process.on('error', (error) => {
        reject(new Error(`Failed to start SSE subscriber: ${error.message}`));
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!this.isReady) {
          reject(new Error('SSE subscriber failed to start within 10 seconds'));
        }
      }, 10000);
    });
  }

  /**
   * Stop the SSE subscriber process
   */
  async stop(): Promise<void> {
    if (!this.process) {
      console.log('[SSE Helper] No process to stop');
      return;
    }

    console.log('[SSE Helper] Stopping SSE subscriber...');

    return new Promise((resolve) => {
      if (this.process) {
        this.process.on('exit', () => {
          console.log('[SSE Helper] Subscriber stopped');
          this.process = null;
          this.isReady = false;
          resolve();
        });

        this.process.kill('SIGINT');
        
        // Force kill after 5 seconds
        setTimeout(() => {
          if (this.process) {
            console.log('[SSE Helper] Force killing subscriber');
            this.process.kill('SIGKILL');
            this.process = null;
            this.isReady = false;
            resolve();
          }
        }, 5000);
      } else {
        resolve();
      }
    });
  }

  /**
   * Check if the subscriber is running and ready
   */
  async isRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${COORDINATOR_URL}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Connect to SSE stream with an API key
   */
  async connect(apiKey: string): Promise<SubscriberConnectionResult> {
    const response = await fetch(`${COORDINATOR_URL}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });

    return response.json();
  }

  /**
   * Disconnect from SSE stream
   */
  async disconnect(): Promise<void> {
    await fetch(`${COORDINATOR_URL}/disconnect`, { method: 'POST' });
  }

  /**
   * Reset test state
   */
  async reset(): Promise<void> {
    await fetch(`${COORDINATOR_URL}/reset`, { method: 'POST' });
  }

  /**
   * Set expected locations
   */
  async expectLocations(
    testId: string,
    expectedLocations: Array<{
      deviceId: string;
      latitude: number;
      longitude: number;
      groupId?: string;
    }>
  ): Promise<void> {
    await fetch(`${COORDINATOR_URL}/expect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testId, expectedLocations }),
    });
  }

  /**
   * Validate received locations
   */
  async validateLocations(timeout = 2000): Promise<{
    success: boolean;
    results: Array<{ expected: unknown; received: unknown | null; matched: boolean }>;
    receivedCount: number;
    expectedCount: number;
  }> {
    const response = await fetch(`${COORDINATOR_URL}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeout }),
    });

    return response.json();
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
    receivedLocations: unknown[];
  }> {
    const response = await fetch(`${COORDINATOR_URL}/state`);
    return response.json();
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
    const response = await fetch(`${COORDINATOR_URL}/health`);
    return response.json();
  }
}

// Singleton instance
let subscriberHelper: SSESubscriberHelper | null = null;

/**
 * Get or create the SSE subscriber helper instance
 */
export function getSSESubscriberHelper(): SSESubscriberHelper {
  if (!subscriberHelper) {
    subscriberHelper = new SSESubscriberHelper();
  }
  return subscriberHelper;
}
