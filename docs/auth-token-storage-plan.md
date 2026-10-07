# Auth Token Storage Plan

Last updated: 2026-10-07

## Goal

Move from local-development token handling to a production-safe authentication
model for web and mobile clients.

The current implementation separates browser and native token storage:

- Backend issues JWT access and refresh tokens through Simple JWT with
  refresh-token rotation and blacklist-after-rotation enabled.
- Web stores both tokens in browser `localStorage` only for local-development
  mode. When browser token storage is disabled, it uses HTTP-only cookies via
  same-origin Next.js routes.
- Mobile stores its rotated JWT session in Expo SecureStore and loads access
  credentials into React state for API calls.

Production web builds cannot opt back into browser `localStorage` token storage.

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
6. Logout revokes the refresh token at the API and clears cookies server-side.

Implementation notes:

- Keep `localStorage` token storage only for local development.
- The web app always disables the temporary `localStorage` token path in
  production; there is no production escape hatch.
- Next.js same-origin auth routes now support cookie-backed login, current-user
  checks, refresh, and logout for the web session panel.
- Authenticated web workspace API calls now use a same-origin proxy when browser
  token storage is disabled, so refresh tokens stay out of browser JavaScript.
- Concurrent web requests share one refresh operation and reuse its result
  briefly, preventing normal request bursts from racing a rotated token.
- Cookie-authenticated mutations require a same-origin request, and production
  auth cookies use `SameSite=Strict`.
- Never expose refresh tokens to browser JavaScript.

## Web Session Flow And Decisions

- A shared `AuthProvider` owns verified user state. Protected workspaces mount
  only after the session check succeeds. Checking and connection-error screens
  prevent private content from flashing during startup or reauthentication.
- Use a dedicated login page. A second login modal over a financial form would
  leave stale account data and competing form state visible. An interrupted
  financial action is not automatically resumed after signing in; the user
  reviews and submits it again. Unsaved form values may need to be re-entered.
- Unauthenticated navigation redirects to `/login?next=...`. The return path
  preserves workspace filters and anchors, accepts only known internal
  workspaces, and rejects external URLs and login/API redirect loops.
- An already authenticated user visiting login returns to the requested
  workspace. Successful sign-in and explicit logout use fresh page navigation
  to discard client and router state between users.
- Protected page responses disable browser caching. Pages restored from the
  browser Back/Forward cache hide the workspace and revalidate the session
  before exposing it again.
- The header account menu exposes logout on every workspace. Logout hides the
  workspace immediately, revokes the refresh token where possible, removes
  local credentials or server cookies, and displays the signed-out login page.
  If the browser cannot reach the cookie logout route, it offers retry rather
  than claiming that HTTP-only cookies were removed.
- Expired access credentials attempt refresh once. Definitive authentication
  rejection redirects to login with an expiry explanation. Refresh/profile
  network failures and upstream outages preserve credentials and offer retry;
  they are not proof of logout. Forbidden financial requests remain permission
  errors. Login throttling remains a retry-later response.
- In production, middleware performs an early cookie-presence redirect.
  Presence alone is not authentication: the current-user endpoint, backend
  proxy, and Django permissions remain authoritative. Development tokens are
  inaccessible to middleware, so the shared client gate verifies them instead.
- Logout/expiry notifications are shared across tabs using BroadcastChannel,
  with development storage events and focus/online revalidation as fallbacks.
  Cross-tab messages contain only the session reason, never credentials.
- Session checks ignore superseded results. A refresh response cannot restore
  credentials after they changed or were cleared. A financial mutation whose
  credential changed before retry requires an explicit retry; it is not
  silently submitted under a different session.

Verification: `npm run test:auth` checks safe return URLs, workspace coverage,
and authentication-versus-availability classification. Browser checks cover
login, refresh, expiry, outages/retry, logout, cross-tab logout, browser Back,
and responsive login/account-menu behavior. Production builds additionally
exercise middleware and cookie-backed sessions.

## Mobile Plan

Mobile can use bearer tokens, but refresh tokens should not live in plain
AsyncStorage.

Target mobile flow:

1. Store refresh token in OS-backed secure storage.
2. Keep access token in memory.
3. On app start, validate the saved access token and refresh only when needed.
4. On `401`, attempt refresh once, then require login.
5. On logout, revoke the refresh token, delete it from secure storage, and clear
   the in-memory access token.

Implementation options:

- Expo managed: `expo-secure-store`.
- Bare React Native: Keychain/Keystore-backed library.

Do not store SMS bodies, auth tokens, or financial exports in unencrypted long
term storage unless the user explicitly exports them.

## Backend Plan

Current Simple JWT settings:

```txt
ACCESS_TOKEN_LIFETIME: 15 minutes
REFRESH_TOKEN_LIFETIME: 30 days, renewed when rotated
ROTATE_REFRESH_TOKENS: true
BLACKLIST_AFTER_ROTATION: true
UPDATE_LAST_LOGIN: true
```

Login attempts are throttled by both source IP and normalized username. Each
login receives an independent refresh token, so signing out one device does not
end other device sessions. An authenticated logout-all endpoint revokes all
outstanding refresh tokens for the user.

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
4. Replace web `localStorage` usage with cookie-backed session helpers. Done for
   login/session status and authenticated workspace API calls through the
   same-origin proxy route layer.
5. Add mobile secure token storage. Done with Expo SecureStore, conditional
   startup refresh, server-side token revocation, and secure deletion on logout.
6. Add automatic token refresh in web and mobile API clients. Done for the
   local-development web API wrapper and mobile app. Concurrent mobile `401`
   responses share one refresh operation, then retry their original requests
   once with the rotated access token.
7. Add tests for refresh rotation, per-session logout, concurrent logins,
   all-session logout, and login throttling. Done for the backend.
8. Update privacy docs and deployment docs before production use.

## Acceptance Criteria

- Web production build does not store refresh tokens in `localStorage`.
- Mobile refresh token is stored only in secure storage.
- Access tokens are short-lived.
- Refresh tokens rotate or are revocable.
- Logout invalidates client-held credentials.
- Auth failure states are clear and do not silently drop financial actions.
