import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Derive a 32-byte key from a shared secret using SHA-256.
 */
function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

/**
 * Encrypt a plaintext string with a shared secret using AES-256-GCM.
 * Returns base64url-encoded: IV (12 bytes) + ciphertext + auth tag (16 bytes).
 * Use this format for transport; the frontend must use the same format.
 */
export function encryptWithSecret(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([iv, encrypted, authTag]);
  return combined.toString('base64url');
}

/**
 * Decrypt a payload. Supports two formats:
 * 1. iv:encrypted:authTag (colon-separated base64) - from frontend
 * 2. base64url(iv + ciphertext + authTag) - legacy single-buffer format
 */
export function decryptWithSecret(payload: string, secret: string): string {
  const key = deriveKey(secret);
  let iv: Buffer;
  let ciphertext: Buffer;
  let authTag: Buffer;

  const parts = payload.split(':');
  if (parts.length === 3) {
    // Format: iv:encrypted:authTag (base64 each)
    iv = Buffer.from(parts[0], 'base64');
    ciphertext = Buffer.from(parts[1], 'base64');
    authTag = Buffer.from(parts[2], 'base64');
  } else {
    // Format: base64url(iv + ciphertext + authTag)
    const combined = Buffer.from(payload, 'base64url');
    if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('Invalid encrypted payload: too short');
    }
    iv = combined.subarray(0, IV_LENGTH);
    authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
    ciphertext = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH);
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(ciphertext) + decipher.final('utf8');
}
