# Encrypting the Share Token (Frontend)

The internal location endpoint (`POST /api/internal/locations`) requires the frontend to **encrypt** the share token with the shared secret before sending. The backend decrypts and validates before proceeding.

## Algorithm

- **Cipher:** AES-256-GCM
- **Key:** SHA-256 hash of the shared secret (32 bytes)
- **IV:** 12 random bytes per encryption
- **Auth tag:** 16 bytes (appended by GCM)
- **Payload format:** `base64url(IV ‖ ciphertext ‖ authTag)`

## Browser Example (Web Crypto API)

```javascript
/**
 * Encrypt a share token with the shared secret for POST /api/internal/locations.
 * Algorithm: AES-256-GCM, key = SHA-256(secret), payload = base64url(IV + ciphertext + authTag)
 */
async function encryptShareToken(shareToken, secret) {
  const enc = new TextEncoder();
  const keyHash = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  const aesKey = await crypto.subtle.importKey(
    'raw',
    keyHash,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    aesKey,
    enc.encode(shareToken)
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
```

## Usage

```javascript
const shareToken = 'share_xxx'; // from URL
const secret = process.env.NEXT_PUBLIC_GOFINDME_APP_SECRET; // same as FRONTEND_APP_SECRET
const encrypted = await encryptShareToken(shareToken, secret);

await fetch('/api/internal/locations', {
  method: 'POST',
  headers: {
    'X-Location-Token': encrypted,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    deviceId: 'device-1',
    latitude: 37.77,
    longitude: -122.42,
    recordedAt: new Date().toISOString(),
  }),
});
```

**Note:** The secret must be available to the frontend (e.g. `NEXT_PUBLIC_*`). Only use this for your own trusted app.
</think>

<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>
StrReplace