import { nanoid } from 'nanoid';
import { prisma as db } from '../db.js';
import { hashToken } from '../utils/token.js';

export type CreateShareLinkOptions = {
  groupId: string;
  reason?: string | null;
  createdByUserId?: string;
  expiresInSeconds?: number;
};

export type CreateShareLinkResult = {
  token: string;
  expiresAt: Date | null;
};

export async function createShareLink(options: CreateShareLinkOptions): Promise<CreateShareLinkResult> {
  const token = `share_${nanoid(32)}`;
  const tokenHash = hashToken(token);
  const expiresAt = options.expiresInSeconds
    ? new Date(Date.now() + options.expiresInSeconds * 1000)
    : null;

  await db.share_links.create({
    data: {
      token_hash: tokenHash,
      group_id: options.groupId,
      reason: options.reason ?? null,
      created_by_user_id: options.createdByUserId ?? null,
      expires_at: expiresAt,
    } as Parameters<typeof db.share_links.create>[0]['data'],
  });

  return { token, expiresAt };
}

export type ValidateShareLinkResult =
  | { valid: true; groupId: string }
  | { valid: false; reason: string };

export async function validateShareLink(token: string): Promise<ValidateShareLinkResult> {
  const tokenHash = hashToken(token);

  const link = await db.share_links.findUnique({
    where: { token_hash: tokenHash },
    include: { groups: true },
  });

  if (!link) {
    return { valid: false, reason: 'Invalid or unknown share link' };
  }

  if (link.expires_at && new Date() > link.expires_at) {
    return { valid: false, reason: 'Share link has expired' };
  }

  return { valid: true, groupId: link.group_id };
}

export async function resolveShareLink(token: string): Promise<{
  groupId: string;
  groupName: string;
  reason: string | null;
  expiresAt: Date | null;
} | null> {
  const tokenHash = hashToken(token);
  const link = await db.share_links.findUnique({
    where: { token_hash: tokenHash },
    include: { groups: true },
  });

  if (!link) return null;
  if (link.expires_at && new Date() > link.expires_at) return null;

  return {
    groupId: link.group_id,
    groupName: link.groups.name,
    reason: (link as { reason?: string | null }).reason ?? null,
    expiresAt: link.expires_at,
  };
}
