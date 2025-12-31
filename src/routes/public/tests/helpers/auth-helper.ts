/**
 * Helper to get Auth0 tokens from environment variables for testing
 * 
 * Set these environment variables in your .env.test or test configuration:
 * - TEST_AUTH0_TOKEN_USER_1: Auth0 token for test user 1
 * - TEST_AUTH0_TOKEN_USER_2: Auth0 token for test user 2
 * - etc.
 * 
 * To get a real Auth0 token for testing:
 * 1. Use Auth0's test token endpoint
 * 2. Or use your Auth0 management API to get a token
 * 3. Or use the Auth0 dashboard to generate a test token
 */

/**
 * Get a test Auth0 token from environment variables
 * @param userId - Optional identifier for which test user token to retrieve (default: '1')
 * @returns Auth0 token string or undefined if not set
 */
export function getTestAuth0Token(userId: string = '1'): string | undefined {
  const tokenKey = `TEST_AUTH0_TOKEN_USER_${userId}`;
  const token = process.env[tokenKey];
  
  if (!token) {
    return undefined;
  }
  
  return token;
}

/**
 * Get multiple test Auth0 tokens from environment variables
 * @param userIds - Array of user identifiers
 * @returns Object mapping user IDs to their tokens (only includes tokens that are set)
 */
export function getTestAuth0Tokens(userIds: string[]): Record<string, string> {
  const tokens: Record<string, string> = {};
  
  for (const userId of userIds) {
    const token = getTestAuth0Token(userId);
    if (token) {
      tokens[userId] = token;
    }
  }
  
  return tokens;
}

/**
 * Require a test Auth0 token (throws if not set)
 * Useful in tests where the token is required
 * @param userId - Optional identifier for which test user token to retrieve (default: '1')
 * @returns Auth0 token string
 * @throws Error if token is not set
 */
export function requireTestAuth0Token(userId: string = '1'): string {
  const token = getTestAuth0Token(userId);
  
  if (!token) {
    throw new Error(
      `Test Auth0 token not found. Please set TEST_AUTH0_TOKEN_USER_${userId} environment variable. ` +
      'Get a real Auth0 token from your Auth0 tenant for testing.'
    );
  }
  
  return token;
}

/**
 * Extract the 'sub' claim from an Auth0 JWT token without verification
 * This is useful for tests to get the user ID that Auth0 will use
 * @param token - Auth0 JWT token
 * @returns The 'sub' claim value (user ID) or null if not found
 */
export function extractSubFromToken(token: string): string | null {
  try {
    // JWT tokens have 3 parts separated by dots: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.error('[Auth Helper] Invalid JWT format - expected 3 parts');
      return null;
    }

    // Decode the payload (second part)
    // JWT uses base64url encoding (not standard base64)
    const payload = parts[1];
    
    // Convert base64url to base64
    // Replace URL-safe characters with standard base64 characters
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    
    // Add padding if needed
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    
    // Decode from base64
    const decoded = Buffer.from(padded, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    
    return parsed.sub || null;
  } catch (error) {
    console.error('[Auth Helper] Error extracting sub from token:', error);
    return null;
  }
}
