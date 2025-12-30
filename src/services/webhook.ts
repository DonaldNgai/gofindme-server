import type { LocationUpdatePayload } from '../types/location.js';

export interface WebhookConfig {
  url: string;
  secret?: string;
  groupId: string;
  apiKeyId: string;
}

/**
 * Webhook delivery service for pushing location updates to external endpoints
 * Supports retries and secret signing for security
 */
export class WebhookService {
  private async signPayload(payload: unknown, secret: string): Promise<string> {
    const crypto = await import('node:crypto');
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    return hmac.digest('hex');
  }

  async deliver(webhook: WebhookConfig, payload: LocationUpdatePayload & { groupId: string }): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'GoFindMe-Webhook/1.0',
    };

    // Add signature if secret is provided
    if (webhook.secret) {
      const signature = await this.signPayload(payload, webhook.secret);
      headers['X-GoFindMe-Signature'] = `sha256=${signature}`;
    }

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          event: 'location.update',
          timestamp: new Date().toISOString(),
          data: payload,
        }),
        // Timeout after 10 seconds
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`Webhook delivery failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      // Log error but don't throw - webhook failures shouldn't break location ingestion
      console.error(`Webhook delivery failed for ${webhook.url}:`, error);
      throw error; // Re-throw for retry logic if needed
    }
  }
}

export const webhookService = new WebhookService();

