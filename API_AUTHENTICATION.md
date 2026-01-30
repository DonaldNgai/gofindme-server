# API Authentication Guide

This document describes all the ways apps can authenticate and interact with the GoFindMe API endpoints.

---

## Overview

| Auth Method | Use Case | Endpoints |
|-------------|----------|-----------|
| **Auth0 JWT** | Logged-in users (your frontend app) | Internal admin, location submission (phone app) |
| **API Key** | Third-party / developer apps | Location streaming, query, npm package |
| **Encrypted Share Token** | Your frontend (share-link flow) | Internal location submission |
| **None** | Public read-only data | Groups list, group details, share link info, health |

---

## 1. Auth0 JWT (Bearer Token)

**Header:** `Authorization: Bearer <access-token>`

**How to obtain:** Users sign in via Auth0 in your frontend. Auth0 returns an access token after successful login. Configure your Auth0 application with the correct callback URLs and API audience.

**Environment variables:**
- `AUTH0_DOMAIN` or `AUTH0_ISSUER_BASE_URL` — Your Auth0 tenant
- `AUTH0_AUDIENCE` — Your API identifier from Auth0 dashboard

### Endpoints using Auth0

| Prefix | Endpoint | Description |
|--------|----------|-------------|
| *(root)* | `GET /auth/test` | Test Auth0 token validity |
| `/api/internal/*` | All internal routes | See below |

### Internal endpoints (all require Auth0)

- **Groups:** `POST/GET/PATCH/DELETE /api/internal/groups`, join, leave, etc.
- **API Keys:** `POST/GET/DELETE /api/internal/api-keys` — Create, list, revoke API keys for your groups
- **Group Invitations:** `POST/GET/PATCH /api/internal/group-invitations/*`
- **Location Shares:** `POST/GET/PATCH/DELETE /api/internal/location-shares/*` — Start/stop sharing location with a group
- **Share Links:** `POST /api/internal/share-links` — Create a share token for a group (returns token; app builds URL)
- **Users:** `POST /api/internal/users` — Link Auth0 user to internal user record

### Public endpoints using Auth0

- `POST /api/v1/locations` — Submit location as a **logged-in user** (phone app). Location is associated with groups the user is a member of.

---

## 2. API Key

**Header:** `X-API-Key: <api-key>`

**How to obtain:** A logged-in user creates an API key via `POST /api/internal/api-keys` (Auth0 required). The key is tied to a group and has the format `loc_<id>_<secret>`.

**Use case:** Third-party developer apps, the npm package `@gofindme/client`, dashboards, and any app that needs to receive location data for a group without user login.

### Endpoints using API Key

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/stream` | SSE stream of real-time location updates for the API key’s group |
| `GET /api/v1/locations` | Query latest locations for devices in the API key’s group |

---

## 3. Encrypted Share Token (App Secret)

**Header or body:** `X-Location-Token: <encrypted-share-token>` *(or* `encryptedShareToken` *in request body)*

**Environment variable:** `FRONTEND_APP_SECRET` (min 16 characters) — used by the backend to decrypt; never sent by the client.

**Flow:**
1. User opens a share link; frontend extracts the share token from the URL (e.g. `share_xxx`).
2. Frontend encrypts the share token using the shared secret (same value as `FRONTEND_APP_SECRET`).
3. Frontend sends the encrypted value (not the raw token) in the request.
4. Backend decrypts with its copy of the secret and validates the share token exists before proceeding.

**Encryption format:** AES-256-GCM. Key = SHA-256(secret). Payload = base64url(IV ‖ ciphertext ‖ authTag). IV = 12 bytes, authTag = 16 bytes.

**Use case:** Your frontend app submitting location when the user has opened a share link. The encrypted payload proves the client has the secret; successful decryption and token validation authorizes the request.

### Endpoints using Encrypted Share Token

| Endpoint | Description |
|----------|-------------|
| `POST /api/internal/locations` | Submit device location. Send encrypted share token in `X-Location-Token` or `encryptedShareToken` in body. |

**Frontend encryption:** See [docs/ENCRYPT_SHARE_TOKEN.md](docs/ENCRYPT_SHARE_TOKEN.md) for the algorithm and a browser example.

**Example (frontend must encrypt first; this shows the structure):**
```bash
# Frontend: encrypt share_xxx with FRONTEND_APP_SECRET → get base64url string
# Then:
curl -X POST https://api.example.com/api/internal/locations \
  -H "X-Location-Token: <encrypted-base64url-payload>" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"phone-1","latitude":37.77,"longitude":-122.42,"recordedAt":"2025-01-11T12:00:00Z"}'
```

---

## 4. No Authentication (Public)

These endpoints do not require any auth.

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /api/v1/health` | Health check (versioned) |
| `GET /api/v1/groups` | List groups (with optional search) |
| `GET /api/v1/groups/:groupId` | Get group details |
| `GET /api/v1/share-links/:token` | Resolve share token to group info (groupId, groupName, reason, expiresAt) |

---

## 5. Implemented but Not Yet Wired

The following auth mechanisms exist in the codebase but are **not** currently attached to any public route:

- **Share token only** (`X-Location-Token` or `Authorization: Bearer` with share token): `resolveLocationAuth` supports submitting location with only a share token (no app secret). No route uses it yet.
- **Anonymous session token**: Supports anonymous location submission to a default group. No public endpoint exists to create or use anonymous sessions.

---

## Route Prefix Summary

| Prefix | Auth | Purpose |
|--------|------|---------|
| *(root)* | Mixed | `/health`, `/auth/test` (Auth0), `/docs` (Swagger) |
| `/api/v1` | Mixed | Public API: Auth0 (location submit), API Key (stream, query), none (groups, share-link info) |
| `/api/internal` | Auth0 or encrypted token | Internal admin (Auth0) and location submission via share link (encrypted token) |

---

## Quick Reference: Location Submission

| Method | Endpoint | Auth | Group determination |
|--------|----------|------|---------------------|
| Logged-in phone app | `POST /api/v1/locations` | Auth0 Bearer | User’s group memberships |
| Share-link flow | `POST /api/internal/locations` | Encrypted share token | Decrypt → validate token → group |

---

## Environment Variables

```env
# Auth0 (for JWT verification)
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://api.example.com

# App secret (for internal location submission)
FRONTEND_APP_SECRET=your-16-char-minimum-secret

# Optional: anonymous sessions (not yet wired to routes)
DEFAULT_ANONYMOUS_GROUP_ID=...
```
