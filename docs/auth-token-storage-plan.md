# Auth Token Storage Plan

Last updated: 2026-05-31

## Goal

Move from local-development token handling to a production-safe authentication
model for web and mobile clients.

The current implementation is still intentionally simple at the client layer:

- Backend issues JWT access and refresh tokens through Simple JWT with
  refresh-token rotation and blacklist-after-rotation enabled.
- Web stores both tokens in browser `localStorage`.
- Mobile keeps tokens in React state during the testing session.

That is acceptable for local development, but not for production financial data.

## Production Direction

Use different storage strategies per client:

- Web: HTTP-only, Secure, SameSite cookies managed by a backend-for-frontend or
  Next.js route handlers.
- Mobile: OS-backed secure storage for refresh tokens and short-lived in-memory
  access tokens.
- Backend: short access-token lifetime, refresh-token rotation, refresh-token
  reuse detection, HTTPS-only deployment, and strict CORS/CSRF rules.

## Web Plan

The browser should not directly store refresh tokens in JavaScript-readable
storage.

Target web flow:

1. User submits credentials to a Next.js server route.
2. The server route calls the Django login endpoint.
3. The server stores refresh token in an HTTP-only Secure SameSite cookie.
4. The server either stores the access token in a short-lived HTTP-only cookie
   or proxies authenticated API calls.
5. Client components call same-origin web routes instead of directly attaching
   bearer tokens from `localStorage`.
6. Logout clears cookies server-side.

Implementation notes:

- Keep `localStorage` token storage only for local development.
- The web app now disables the temporary `localStorage` token path in
  production unless `NEXT_PUBLIC_ALLOW_LOCAL_TOKEN_STORAGE=true` is set
  deliberately as an escape hatch.
- Next.js same-origin auth routes now support cookie-backed login, current-user
  checks, refresh, and logout for the web session panel.
- In local-development mode, the web API wrapper uses the stored refresh token
  to rotate tokens and retry authenticated API calls once after a 401.
- Add a visible code comment or env guard before production deployment.
- Use `SameSite=Lax` for normal same-site app usage unless cross-site embedding
  is explicitly required.
- Use CSRF protection for cookie-authenticated mutating requests.
- Never expose refresh tokens to browser JavaScript.

## Mobile Plan

Mobile can use bearer tokens, but refresh tokens should not live in plain
AsyncStorage.

Target mobile flow:

1. Store refresh token in OS-backed secure storage.
2. Keep access token in memory.
3. On app start, use secure refresh token to request a fresh access token.
4. On `401`, attempt refresh once, then require login.
5. On logout, delete secure refresh token and clear in-memory access token.

Implementation options:

- Expo managed: `expo-secure-store`.
- Bare React Native: Keychain/Keystore-backed library.

Do not store SMS bodies, auth tokens, or financial exports in unencrypted long
term storage unless the user explicitly exports them.

## Backend Plan

Current Simple JWT settings:

```txt
ACCESS_TOKEN_LIFETIME: 10 minutes
REFRESH_TOKEN_LIFETIME: 14 days
ROTATE_REFRESH_TOKENS: true
BLACKLIST_AFTER_ROTATION: true
UPDATE_LAST_LOGIN: true
```

Deployment/security requirements:

- `DJANGO_DEBUG=false`
- Strong `DJANGO_SECRET_KEY`
- HTTPS enforced at the proxy/load balancer
- Secure cookie settings if cookies are issued by Django
- Tight `DJANGO_ALLOWED_HOSTS`
- Tight `DJANGO_CORS_ALLOWED_ORIGINS`
- No real tokens in logs, screenshots, examples, or support dumps

## Migration Steps

1. Keep current JWT bearer-token flow for local development.
2. Add backend Simple JWT rotation/blacklist settings. Done.
3. Add web server-side login/logout/refresh routes. Done.
4. Replace web `localStorage` usage with cookie-backed session helpers. Started
   for login/session status; page data APIs still need same-origin proxy or
   server action migration.
5. Add mobile secure token storage.
6. Add automatic token refresh in web and mobile API clients. Done for the
   local-development web API wrapper; mobile remains pending.
7. Add tests for refresh, logout, expired access token, and invalid refresh
   token behavior.
8. Update privacy docs and deployment docs before production use.

## Acceptance Criteria

- Web production build does not store refresh tokens in `localStorage`.
- Mobile refresh token is stored only in secure storage.
- Access tokens are short-lived.
- Refresh tokens rotate or are revocable.
- Logout invalidates client-held credentials.
- Auth failure states are clear and do not silently drop financial actions.
