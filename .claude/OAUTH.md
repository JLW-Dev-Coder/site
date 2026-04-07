# OAUTH.md — VLP Ecosystem Google OAuth Architecture

Last updated: 2026-04-06

---

## Overview

All 8 platforms authenticate through a single VLP Worker (`virtuallaunch-pro-api`). Google OAuth uses two separate Google Cloud projects and two API subdomains to ensure same-site cookie delivery and correct consent screen branding.

---

## Domain Families

| Family | Platforms | API Subdomain | Cookie Domain | Google Cloud Project |
|--------|-----------|---------------|---------------|---------------------|
| taxmonitor.pro | TMP, TTMP, TTTMP | api.taxmonitor.pro | .taxmonitor.pro | Tax Monitor Pro (ID: tax-monitor-pro) |
| virtuallaunch.pro | VLP, DVLP, GVLP, TCVLP, WLVLP | api.virtuallaunch.pro | .virtuallaunch.pro | virtuallaunch.pro (default) |

Both API subdomains route to the same Worker: `virtuallaunch-pro-api`.

---

## Google OAuth Clients

### TMP Client (taxmonitor.pro family)
- **Google Cloud Project:** Tax Monitor Pro
- **Project ID:** tax-monitor-pro
- **Project Number:** 1042806598248
- **Client ID:** 1042806598248-ugakuq39veaq2vafgtvkue2m1g0to2su.apps.googleusercontent.com
- **Client Secret Env Var:** `GOOGLE_CLIENT_SECRET_TMP` (set via `wrangler secret put`)
- **Authorized Redirect URI:** `https://api.taxmonitor.pro/v1/auth/google/callback`
- **Consent Screen Shows:** "taxmonitor.pro"
- **Used by:** TMP, TTMP, TTTMP

### VLP Client (virtuallaunch.pro family)
- **Client ID:** Stored in `env.GOOGLE_CLIENT_ID`
- **Client Secret Env Var:** `GOOGLE_CLIENT_SECRET`
- **Redirect URI:** Stored in `env.GOOGLE_REDIRECT_URI` (points to `https://api.virtuallaunch.pro/v1/auth/google/callback`)
- **Consent Screen Shows:** "virtuallaunch.pro"
- **Used by:** VLP, DVLP, GVLP, TCVLP, WLVLP

---

## Auth Flow (same for all platforms)

```
1. User clicks "Continue with Google" on platform login page
2. Frontend navigates to: https://api.{family-domain}/v1/auth/google/start?return_to={dashboard-url}
3. Worker reads return_to, selects correct OAuth client + redirect URI
4. Worker returns 302 → Google consent screen
5. User consents → Google redirects to: https://api.{family-domain}/v1/auth/google/callback?code=...&state=...
6. Worker exchanges code for token using matching client ID/secret/redirect URI
7. Worker creates session in D1
8. Worker returns 302 → {dashboard-url} with Set-Cookie: vlp_session={session_id}; Domain=.{family-domain}
9. Dashboard loads, calls GET /v1/auth/session with credentials: 'include'
10. Cookie is same-site → browser sends it → session validated → dashboard renders
```

No handoff tokens. No sessionStorage. No Bearer tokens. Just cookies.

---

## Worker Client Selection Logic

Location: `workers/src/index.js` — both start and callback handlers

```javascript
const isTaxMonitor = returnTo.includes('taxmonitor.pro')

const googleClientId = isTaxMonitor
  ? '1042806598248-ugakuq39veaq2vafgtvkue2m1g0to2su.apps.googleusercontent.com'
  : env.GOOGLE_CLIENT_ID

const googleClientSecret = isTaxMonitor
  ? env.GOOGLE_CLIENT_SECRET_TMP
  : env.GOOGLE_CLIENT_SECRET

const googleRedirectUri = isTaxMonitor
  ? 'https://api.taxmonitor.pro/v1/auth/google/callback'
  : env.GOOGLE_REDIRECT_URI
```

This logic MUST be identical in both the start handler and the callback handler. If they mismatch, the token exchange will fail with `redirect_uri_mismatch`.

---

## Cookie Architecture

```
makeSessionCookie(sessionId, env, domainOverride)
  → vlp_session={id}; Domain={domain}; Path=/; Expires={24h}; HttpOnly; Secure; SameSite=Lax

cookieDomainForUrl(url)
  → if hostname contains 'taxmonitor.pro' → '.taxmonitor.pro'
  → otherwise → null (defaults to '.virtuallaunch.pro')

redirectWithCookie(url, sessionId, env, request)
  → 302 redirect with Set-Cookie header using cookieDomainForUrl()
```

**Critical rule:** The response domain must match the cookie domain family. `api.taxmonitor.pro` can set `.taxmonitor.pro` cookies. `api.virtuallaunch.pro` can set `.virtuallaunch.pro` cookies. Cross-family cookie setting silently fails in browsers.

---

## Platform Frontend Requirements

Every platform login page must:

1. **Point to the correct API subdomain:**
   - TMP/TTMP/TTTMP → `https://api.taxmonitor.pro/v1/auth/google/start`
   - VLP/DVLP/GVLP/TCVLP/WLVLP → `https://api.virtuallaunch.pro/v1/auth/google/start`

2. **Send return_to as a full URL:**
   ```javascript
   const returnTo = encodeURIComponent('https://{platform-domain}/{dashboard-path}')
   window.location.href = `https://api.{family-domain}/v1/auth/google/start?return_to=${returnTo}`
   ```

3. **Use cookie-based auth for all API calls:**
   ```javascript
   fetch('https://api.{family-domain}/v1/auth/session', { credentials: 'include' })
   ```
   No Bearer tokens. No sessionStorage. The vlp_session cookie handles everything.

4. **Session response format:**
   ```json
   { "ok": true, "session": { "account_id": "...", "email": "...", "membership": "...", ... } }
   ```
   Check `res.ok && res.session` — not `res.user`.

---

## Platform Login Pages (current)

| Platform | Login URL | return_to | API Base |
|----------|-----------|-----------|----------|
| VLP | /sign-in | https://virtuallaunch.pro/dashboard | api.virtuallaunch.pro |
| TMP | /sign-in | https://taxmonitor.pro/dashboard | api.taxmonitor.pro |
| TTMP | /login/ | https://transcript.taxmonitor.pro/app/dashboard/ | api.taxmonitor.pro |
| TTTMP | TBD | https://taxtools.taxmonitor.pro/dashboard | api.taxmonitor.pro |
| DVLP | TBD | https://developers.virtuallaunch.pro/dashboard | api.virtuallaunch.pro |
| GVLP | TBD | https://games.virtuallaunch.pro/dashboard | api.virtuallaunch.pro |
| TCVLP | TBD | https://taxclaim.virtuallaunch.pro/dashboard | api.virtuallaunch.pro |
| WLVLP | TBD | https://websitelotto.virtuallaunch.pro/dashboard | api.virtuallaunch.pro |

---

## DNS Requirements

| Record | Type | Points To | Zone |
|--------|------|-----------|------|
| api.taxmonitor.pro | Worker Route | virtuallaunch-pro-api | taxmonitor.pro |
| api.virtuallaunch.pro | Route | virtuallaunch-pro-api/* | virtuallaunch.pro |

Both subdomains route to the same Worker.

---

## Secrets (Cloudflare Worker)

| Secret | Set Via | Used For |
|--------|---------|----------|
| GOOGLE_CLIENT_ID | wrangler secret put | VLP family OAuth client ID |
| GOOGLE_CLIENT_SECRET | wrangler secret put | VLP family OAuth client secret |
| GOOGLE_CLIENT_SECRET_TMP | wrangler secret put | TMP family OAuth client secret |
| GOOGLE_REDIRECT_URI | wrangler secret put | VLP family callback URL |

---

## Troubleshooting

### "redirect_uri_mismatch" error
- The redirect URI in the Worker MUST exactly match what's configured in Google Cloud Console
- Check that the start and callback handlers use the same redirect URI
- Google OAuth changes can take 5-30 minutes to propagate

### User loops back to login page
- Cookie not being set: check that the API subdomain matches the cookie domain family
- Session response mismatch: frontend must check `res.session` not `res.user`
- API base URL wrong: platform must call its family's API subdomain

### Consent screen shows wrong domain
- Each family has its own Google Cloud project
- The consent screen shows the domain from the OAuth client's authorized redirect URI
- TMP family shows "taxmonitor.pro", VLP family shows "virtuallaunch.pro"

---

## Rules (do not violate)

1. Never use handoff tokens or sessionStorage for auth — cookie only
2. Never set cross-family cookies (api.virtuallaunch.pro cannot set .taxmonitor.pro cookies)
3. Start and callback handlers MUST have identical client selection logic
4. Every platform frontend MUST use its family's API subdomain
5. The vlp_session cookie name is the same across all platforms — only the domain changes
6. Never store session IDs in localStorage or sessionStorage
