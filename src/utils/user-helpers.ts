import { prisma as db } from '../db.js';
import { getUserFromAuth0 } from './auth.js';

/**
 * Find or create a user in the database
 * Handles email fallback logic when email is not in the Auth0 token
 *
 * @param userId - The Auth0 user ID (sub)
 * @param authEmail - Email from Auth0 token (may be undefined)
 * @param authName - Name from Auth0 token (may be undefined)
 * @returns The user record
 */
export async function findOrCreateUser(
  userId: string,
  authEmail?: string,
  authName?: string
): Promise<{ id: string; email: string; name: string | null }> {
  // Try to find existing user first (by ID, which is the primary identifier)
  let user = await db.users.findUnique({
    where: { id: userId },
  });

  if (user) {
    return user;
  }

  // User doesn't exist, need to determine email and name for creation
  let userEmail = authEmail;
  let userName = authName;

  // If email is not in token, query Auth0 Management API to get user info
  if (!userEmail) {
    const auth0User = await getUserFromAuth0(userId);
    if (auth0User) {
      userEmail = auth0User.email;
      userName = auth0User.name || userName;
    }
  }

  // Fallback to generated email if still not available
  if (!userEmail) {
    userEmail = `${userId}@auth0.local`;
  }

  // Use upsert to atomically create or get existing user
  // This handles race conditions where multiple requests try to create the same user
  user = await db.users.upsert({
    where: { id: userId },
    update: {}, // If user exists, don't update anything
    create: {
      id: userId, // Use Auth0 sub as the user ID
      email: userEmail,
      name: userName as string | undefined,
    },
  });

  return user;
}
