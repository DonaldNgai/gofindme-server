/**
 * Test helpers for generating fake Auth0 tokens and API keys
 * 
 * These helpers generate fake tokens that can be used in tests without
 * requiring real Auth0 tokens or API keys.
 * 
 * In test mode, the auth system decodes tokens without verification,
 * so we just need to create properly formatted JWT tokens.
 */

import { createApiKey } from '../../../../services/api-keys.js';

/**
 * Generate a fake Auth0 JWT token for testing
 * 
 * In test mode, tokens are decoded without verification, so we just need
 * to create a properly formatted JWT with the right payload structure.
 * 
 * @param userId - The user ID (sub claim) to include in the token
 * @param email - Optional email to include in the token
 * @param name - Optional name to include in the token
 * @returns A fake JWT token string (base64url encoded)
 */
export function generateFakeAuth0Token(
  userId: string,
  email?: string,
  name?: string
): string {
  const now = Math.floor(Date.now() / 1000);
  
  // Create the payload
  const payload = {
    sub: userId,
    email: email || `${userId}@test.example.com`,
    name: name || `Test User ${userId}`,
    aud: 'test-audience',
    iss: 'https://test.auth0.com/',
    iat: now,
    exp: now + 3600, // 1 hour from now
  };

  // Create a simple JWT structure (header.payload.signature)
  // In test mode, we don't need a real signature, just a valid format
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  // Encode header and payload as base64url
  const encodeBase64Url = (obj: object): string => {
    const json = JSON.stringify(obj);
    return Buffer.from(json)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const encodedHeader = encodeBase64Url(header);
  const encodedPayload = encodeBase64Url(payload);
  
  // Create a fake signature (just a placeholder, won't be verified in test mode)
  const fakeSignature = 'test-signature-placeholder';

  return `${encodedHeader}.${encodedPayload}.${fakeSignature}`;
}

/**
 * Generate multiple fake Auth0 tokens for different test users
 * @param userIds - Array of user IDs to generate tokens for
 * @returns Object mapping user IDs to their tokens
 */
export async function generateFakeAuth0Tokens(
  userIds: string[]
): Promise<Record<string, string>> {
  const tokens: Record<string, string> = {};
  
  for (const userId of userIds) {
    tokens[userId] = await generateFakeAuth0Token(userId);
  }
  
  return tokens;
}

/**
 * Generate a fake API key for testing
 * This creates a real API key in the database that can be used for testing
 * @param groupId - The group ID to create the API key for
 * @param label - Label for the API key
 * @param userId - Optional user ID who owns the API key
 * @returns The generated API key string
 */
export async function generateFakeApiKey(
  groupId: string,
  label: string,
  userId?: string
): Promise<string> {
  return await createApiKey(groupId, label, userId);
}
