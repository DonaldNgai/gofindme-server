import { nanoid } from 'nanoid';
import { prisma as db } from '../db.js';
import { env } from '../config/env.js';

const SYSTEM_USER_EMAIL = 'system@internal.gofindme';
const ANONYMOUS_GROUP_NAME = 'Anonymous';

let cachedGroupId: string | null = null;

/**
 * Returns the group ID to use for anonymous location submissions.
 * Uses DEFAULT_ANONYMOUS_GROUP_ID if set; otherwise ensures a system user
 * and "Anonymous" group exist and returns that group's ID.
 */
export async function getDefaultAnonymousGroupId(): Promise<string> {
  if (cachedGroupId) return cachedGroupId;

  const configured = env.DEFAULT_ANONYMOUS_GROUP_ID;
  if (configured) {
    const g = await db.groups.findUnique({ where: { id: configured } });
    if (g) {
      cachedGroupId = g.id;
      return cachedGroupId;
    }
  }

  let user = await db.users.findUnique({ where: { email: SYSTEM_USER_EMAIL } });
  if (!user) {
    user = await db.users.create({
      data: {
        id: `system-${nanoid(12)}`,
        email: SYSTEM_USER_EMAIL,
        name: 'System',
      },
    });
  }

  let group = await db.groups.findFirst({
    where: { name: ANONYMOUS_GROUP_NAME, owner_id: user.id },
  });
  if (!group) {
    group = await db.groups.create({
      data: {
        name: ANONYMOUS_GROUP_NAME,
        description: 'Default group for anonymous location sharing',
        owner_id: user.id,
      },
    });
  }

  cachedGroupId = group.id;
  return cachedGroupId;
}
