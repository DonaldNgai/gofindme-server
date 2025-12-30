import crypto from "node:crypto";
import { nanoid } from "nanoid";
import { prisma as db } from "../db.js";

const KEY_PREFIX = "loc";

function hashSecret(secret: string) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export async function createApiKey(groupId: string, label: string, userId?: string) {
  const tokenId = nanoid(12);
  const secret = nanoid(32);
  const combined = `${KEY_PREFIX}_${tokenId}_${secret}`;
  const hashed = hashSecret(combined);

  await db.api_keys.create({
    data: {
      id: tokenId,
      group_id: groupId,
      user_id: userId ?? null,
      label,
      hashed_secret: hashed,
    },
  });

  return combined;
}

export async function revokeApiKey(keyId: string) {
  await db.api_keys.update({
    where: { id: keyId },
    data: { revoked_at: new Date() },
  });
}

export async function resolveApiKey(rawKey: string) {
  const [prefix, tokenId] = rawKey.split("_", 2);
  if (prefix !== KEY_PREFIX || !tokenId) return null;

  const record = await db.api_keys.findFirst({
    where: {
      id: tokenId,
      revoked_at: null,
    },
  });

  if (!record) return null;

  const hashed = hashSecret(rawKey);
  if (crypto.timingSafeEqual(Buffer.from(hashed), Buffer.from(record.hashed_secret))) {
    await db.api_keys.update({
      where: { id: record.id },
      data: { last_used_at: new Date() },
    });
    return record;
  }

  return null;
}
