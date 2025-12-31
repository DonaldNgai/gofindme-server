import { prisma as db } from '../db.js';

/**
 * Find all groups that:
 * 1. The deviceId/user is a member of (via group_members)
 * 2. Have at least one active API key (app) assigned
 * 
 * This ensures location data is only sent to apps that are authorized
 * to receive location data for users in their assigned groups.
 * 
 * @param deviceId - The device identifier (may also be a userId)
 * @param contextUserId - Optional user ID from context (e.g., from API key that submitted the location)
 * @returns Array of group IDs that are authorized to receive this location update
 */
export async function findAuthorizedGroups(
  deviceId: string,
  contextUserId?: string | null
): Promise<string[]> {
  // First, try to find if deviceId corresponds to a user ID
  // This handles the case where deviceId = userId
  let userId: string | null = null;
  
  const user = await db.users.findUnique({
    where: { id: deviceId },
  });
  
  if (user) {
    userId = user.id;
  } else if (contextUserId) {
    // If deviceId doesn't match a user ID, but we have context (e.g., from API key),
    // check if the context user is submitting location for a device they own
    // For now, we'll use the contextUserId as a fallback
    // In the future, you might want a device-to-user mapping table
    userId = contextUserId;
  } else {
    // If we can't determine the user, return empty array
    // Location data will still be stored, but no notifications will be sent
    return [];
  }

  // Find all groups where this user is a member
  // Only consider non-pending memberships (e.g., 'accepted', 'active')
  // Pending memberships should not receive location updates
  const groupMemberships = await db.group_members.findMany({
    where: {
      user_id: userId,
      status: {
        not: 'pending', // Exclude pending memberships
      },
    },
    select: {
      group_id: true,
    },
  });

  if (groupMemberships.length === 0) {
    return [];
  }

  const groupIds = groupMemberships.map((gm) => gm.group_id);

  // Find groups that have at least one active (non-revoked) API key
  // These are the "apps" that can receive location data
  const groupsWithActiveApiKeys = await db.groups.findMany({
    where: {
      id: { in: groupIds },
      api_keys: {
        some: {
          revoked_at: null, // API key is not revoked
        },
      },
    },
    select: {
      id: true,
    },
  });

  return groupsWithActiveApiKeys.map((group) => group.id);
}

/**
 * Find authorized groups for a user directly from their user ID
 * 
 * Used when the user is identified by Auth0 token (auth.sub = userId).
 * 
 * Flow:
 * 1. User submits location with Auth0 token
 * 2. Token identifies user (userId from auth.sub)
 * 3. Find all groups where user is a member
 * 4. Filter to groups that have active API keys (apps)
 * 5. Return those groups for notification
 * 
 * Only API keys assigned to these groups can receive location updates for this user.
 * 
 * @param userId - User ID (typically from Auth0 token's sub claim)
 * @returns Array of group IDs that are authorized to receive location updates for this user
 */
export async function findAuthorizedGroupsForUser(userId: string): Promise<string[]> {
  // Find all groups where this user is a member
  // Only consider non-pending memberships (accepted/active status)
  const groupMemberships = await db.group_members.findMany({
    where: {
      user_id: userId,
      status: {
        not: 'pending', // Exclude pending memberships
      },
    },
    select: {
      group_id: true,
    },
  });

  if (groupMemberships.length === 0) {
    return [];
  }

  const groupIds = groupMemberships.map((gm) => gm.group_id);

  // Find groups that have at least one active (non-revoked) API key
  // These are the "apps" (developer API keys) that can receive location data
  const groupsWithActiveApiKeys = await db.groups.findMany({
    where: {
      id: { in: groupIds },
      api_keys: {
        some: {
          revoked_at: null, // API key is not revoked
        },
      },
    },
    select: {
      id: true,
    },
  });

  return groupsWithActiveApiKeys.map((group) => group.id);
}
