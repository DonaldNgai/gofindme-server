# Auth0 Setup Guide

This guide will help you configure Auth0 for your phone app and backend server.

## Overview

1. **Phone App** → Gets access token from Auth0
2. **Phone App** → Sends token to backend in `Authorization: Bearer <token>` header
3. **Backend Server** → Verifies token with Auth0 and grants access

## Step 1: Create Auth0 Application (for Phone App)

1. Go to [Auth0 Dashboard](https://manage.auth0.com)
2. Navigate to **Applications** → **Applications**
3. Click **Create Application**
4. Choose **Native** (for mobile apps) or **Single Page Application**
5. Name it (e.g., "GoFindMe Mobile App")
6. Click **Create**

### Configure Application Settings

1. Go to **Settings** tab
2. Note these values:
   - **Domain**: `your-tenant.auth0.com`
   - **Client ID**: Copy this for your phone app
   - **Client Secret**: Not needed for mobile apps (public clients)

3. Configure **Allowed Callback URLs**:
   ```
   com.yourapp://callback
   ```
   (Use your app's custom URL scheme)

4. Configure **Allowed Logout URLs**:
   ```
   com.yourapp://logout
   ```

5. Click **Save Changes**

## Step 2: Create Auth0 API (for Backend)

1. In Auth0 Dashboard, go to **Applications** → **APIs**
2. Click **Create API**
3. Fill in:
   - **Name**: GoFindMe API
   - **Identifier**: `https://api.gofindme.com` (or your API URL)
   - **Signing Algorithm**: RS256 (default)
4. Click **Create**

### Configure API Settings

1. Go to **Settings** tab
2. Note the **Identifier** - this is your `AUTH0_AUDIENCE`
3. Enable **Allow Offline Access** if you need refresh tokens
4. Click **Save Changes**

### Authorize Application

1. Go to **Machine to Machine Applications** tab (if using M2M) OR
2. Go to **Settings** → **Authorized Applications**
3. Authorize your mobile app (created in Step 1)
4. Select the scopes you need (usually `read:groups`, `write:groups`, etc.)

## Step 3: Configure Backend Environment Variables

Add to your `.env` file:

```env
# Auth0 Configuration
AUTH0_DOMAIN=your-tenant.auth0.com
# OR use AUTH0_ISSUER_BASE_URL instead:
# AUTH0_ISSUER_BASE_URL=https://your-tenant.auth0.com

AUTH0_AUDIENCE=https://api.gofindme.com
```

**Important**: 
- `AUTH0_DOMAIN` should be just the domain (e.g., `myapp.auth0.com`)
- `AUTH0_ISSUER_BASE_URL` should be the full URL (e.g., `https://myapp.auth0.com/`)
- `AUTH0_AUDIENCE` must match the API Identifier from Step 2

## Step 4: Phone App Integration

### For React Native / Expo

```bash
npm install react-native-auth0
# or
expo install expo-auth-session
```

### Example: Get Access Token

```typescript
import Auth0 from 'react-native-auth0';

const auth0 = new Auth0({
  domain: 'your-tenant.auth0.com',
  clientId: 'your-client-id',
});

// Login
const credentials = await auth0.webAuth.authorize({
  scope: 'openid profile email',
  audience: 'https://api.gofindme.com', // Must match AUTH0_AUDIENCE
});

const accessToken = credentials.accessToken;

// Use token in API calls
const response = await fetch('https://your-api.com/api/v1/groups', {
  headers: {
    'Authorization': `Bearer ${accessToken}`,
  },
});
```

### For Native iOS (Swift)

```swift
import Auth0

let credentials = Auth0
    .webAuth()
    .scope("openid profile email")
    .audience("https://api.gofindme.com")
    .start { result in
        switch result {
        case .success(let credentials):
            let accessToken = credentials.accessToken
            // Use token in API calls
        case .failure(let error):
            print("Error: \(error)")
        }
    }
```

### For Native Android (Kotlin)

```kotlin
val webAuth = WebAuthProvider
    .login(account)
    .withScope("openid profile email")
    .withAudience("https://api.gofindme.com")
    .start(this) { result ->
        when (result) {
            is Success -> {
                val accessToken = result.credentials.accessToken
                // Use token in API calls
            }
            is Failure -> {
                // Handle error
            }
        }
    }
```

## Step 5: Test Authentication

### Test with curl

```bash
# First, get a token from Auth0 (use your app's login flow)
# Then test the backend:

curl -X GET https://your-api.com/auth/test \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Test Endpoint

The backend provides a test endpoint at `/auth/test` that returns the authenticated user info.

## Step 6: Verify Backend Setup

1. Start your server:
   ```bash
   pnpm dev
   ```

2. Check logs - you should see the server start without Auth0 errors

3. Test the auth endpoint:
   ```bash
   # Without token (should fail)
   curl http://localhost:3000/auth/test
   
   # With token (should succeed)
   curl http://localhost:3000/auth/test \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

## Troubleshooting

### "AUTH0_DOMAIN is not configured"
- Make sure `.env` has `AUTH0_DOMAIN` or `AUTH0_ISSUER_BASE_URL`
- Restart the server after adding env vars

### "Token has expired"
- Tokens expire after a set time (default: 24 hours)
- Implement token refresh in your app

### "Invalid token audience"
- Make sure `AUTH0_AUDIENCE` in backend matches the API Identifier
- Make sure your app requests the token with the same audience

### "Invalid token signature"
- Usually means the token is from a different Auth0 tenant
- Verify `AUTH0_DOMAIN` matches your Auth0 tenant

### "Missing bearer token"
- Make sure your app sends: `Authorization: Bearer <token>`
- Check the header name is exactly `Authorization` (case-sensitive)

## Security Best Practices

1. **Always use HTTPS** in production
2. **Validate audience** - Backend automatically validates audience
3. **Token expiration** - Tokens expire automatically
4. **Scope validation** - Add scope checks if needed:
   ```typescript
   if (!payload.scope?.includes('read:groups')) {
     reply.code(403);
     throw new Error('Insufficient permissions');
   }
   ```

## Next Steps

- Add role-based access control (RBAC) if needed
- Implement token refresh flow
- Add rate limiting per user
- Set up Auth0 Rules/Actions for custom claims

## Resources

- [Auth0 Documentation](https://auth0.com/docs)
- [Auth0 Mobile SDKs](https://auth0.com/docs/quickstart/native)
- [JWT.io](https://jwt.io) - Debug JWT tokens

