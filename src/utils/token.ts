import crypto from 'node:crypto';
import { nanoid } from 'nanoid';

const TOKEN_BYTES = 32;

export function generateToken(): string {
  return nanoid(TOKEN_BYTES);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function verifyToken(token: string, hash: string): boolean {
  const h = hashToken(token);
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
}
