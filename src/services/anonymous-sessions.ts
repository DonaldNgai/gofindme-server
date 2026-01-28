import { prisma as db } from '../db.js';
import { generateToken, hashToken } from '../utils/token.js';

const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export type CreateAnonymousSessionOptions = {
  ttlSeconds?: number;
};

export type CreateAnonymousSessionResult = {
  token: string;
  expiresAt: Date;
};

export async function createAnonymousSession(
  options: CreateAnonymousSessionOptions = {}
): Promise<CreateAnonymousSessionResult> {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await db.anonymous_sessions.create({
    data: {
      token_hash: tokenHash,
      expires_at: expiresAt,
    },
  });

  return { token, expiresAt };
}

export type ValidateAnonymousSessionResult =
  | { valid: true }
  | { valid: false; reason: string };

export async function validateAnonymousSession(
  token: string
): Promise<ValidateAnonymousSessionResult> {
  const tokenHash = hashToken(token);

  const session = await db.anonymous_sessions.findUnique({
    where: { token_hash: tokenHash },
  });

  if (!session) {
    return { valid: false, reason: 'Invalid or unknown session token' };
  }

  if (new Date() > session.expires_at) {
    await db.anonymous_sessions.delete({ where: { id: session.id } }).catch(() => {});
    return { valid: false, reason: 'Session token has expired' };
  }

  return { valid: true };
}

export async function deleteExpiredAnonymousSessions(): Promise<number> {
  const result = await db.anonymous_sessions.deleteMany({
    where: { expires_at: { lt: new Date() } },
  });
  return result.count;
}
