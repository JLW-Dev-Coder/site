/**
 * Virtual Launch Pro — Cloudflare Worker
 * API surface: api.virtuallaunch.pro
 *
 * Architecture:
 * - Deny-by-default routing
 * - Contract-validated writes (to be implemented per route)
 * - R2 canonical storage (binding: R2_VIRTUAL_LAUNCH)
 * - D1 query layer (binding: DB)
 * - All routes return JSON
 *
 * Write pipeline (per VLP spec):
 * 1. Request received
 * 2. Contract validation
 * 3. Receipt stored in R2
 * 4. Canonical record updated
 * 5. D1 index updated
 * 6. Response returned
 */

/*
 * D1 Tables required (see workers/migrations/ for schema):
 *
 * accounts
 *   account_id TEXT PRIMARY KEY
 *   email TEXT UNIQUE NOT NULL
 *   first_name TEXT
 *   last_name TEXT
 *   phone TEXT
 *   timezone TEXT
 *   platform TEXT NOT NULL
 *   role TEXT NOT NULL DEFAULT 'member'
 *   status TEXT NOT NULL DEFAULT 'active'
 *   two_factor_enabled INTEGER NOT NULL DEFAULT 0
 *   totp_secret TEXT
 *   totp_pending_secret TEXT
 *   created_at TEXT NOT NULL
 *   updated_at TEXT
 *
 * sessions
 *   session_id TEXT PRIMARY KEY
 *   account_id TEXT NOT NULL
 *   email TEXT NOT NULL
 *   platform TEXT NOT NULL
 *   membership TEXT NOT NULL DEFAULT 'free'
 *   two_fa_verified INTEGER NOT NULL DEFAULT 0
 *   created_at TEXT NOT NULL
 *   expires_at TEXT NOT NULL
 *
 * memberships
 *   membership_id TEXT PRIMARY KEY
 *   account_id TEXT NOT NULL
 *   plan_key TEXT NOT NULL
 *   billing_interval TEXT
 *   status TEXT NOT NULL DEFAULT 'free'
 *   stripe_customer_id TEXT
 *   stripe_subscription_id TEXT
 *   created_at TEXT NOT NULL
 *   updated_at TEXT
 *
 * billing_customers
 *   account_id TEXT PRIMARY KEY
 *   stripe_customer_id TEXT NOT NULL
 *   email TEXT NOT NULL
 *   created_at TEXT NOT NULL
 *   updated_at TEXT
 *
 * tokens
 *   account_id TEXT PRIMARY KEY
 *   tax_game_tokens INTEGER NOT NULL DEFAULT 0
 *   transcript_tokens INTEGER NOT NULL DEFAULT 0
 *   updated_at TEXT NOT NULL
 *
 * cal_connections
 *   connection_id TEXT PRIMARY KEY
 *   account_id TEXT NOT NULL
 *   cal_app TEXT NOT NULL
 *   access_token TEXT NOT NULL
 *   refresh_token TEXT NOT NULL
 *   expires_at TEXT NOT NULL
 *   created_at TEXT NOT NULL
 *   updated_at TEXT
 *
 * bookings
 *   booking_id TEXT PRIMARY KEY
 *   account_id TEXT NOT NULL
 *   professional_id TEXT
 *   cal_booking_uid TEXT
 *   booking_type TEXT NOT NULL
 *   scheduled_at TEXT NOT NULL
 *   timezone TEXT NOT NULL
 *   status TEXT NOT NULL DEFAULT 'pending'
 *   created_at TEXT NOT NULL
 *   updated_at TEXT
 *
 * profiles
 *   professional_id TEXT PRIMARY KEY
 *   account_id TEXT NOT NULL
 *   display_name TEXT NOT NULL
 *   title TEXT
 *   bio TEXT
 *   specialties TEXT
 *   availability TEXT NOT NULL DEFAULT 'available'
 *   created_at TEXT NOT NULL
 *   updated_at TEXT
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://virtuallaunch.pro',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}


function notFound(path) {
  return json({ ok: false, error: 'NOT_FOUND', path }, 404);
}

function methodNotAllowed(method, path) {
  return json({ ok: false, error: 'METHOD_NOT_ALLOWED', route: `${method} ${path}` }, 405);
}

/**
 * Match a URL pathname against a pattern that may contain :param segments.
 * Returns an object of extracted params on match, or null on no match.
 */
function matchPath(pattern, pathname) {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

// ---------------------------------------------------------------------------
// Additional helpers
// ---------------------------------------------------------------------------

async function parseBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function r2Put(bucket, key, data) {
  await bucket.put(key, JSON.stringify(data), {
    httpMetadata: { contentType: 'application/json' },
  });
  return true;
}

async function d1Run(db, sql, params) {
  return db.prepare(sql).bind(...params).run();
}

async function getSessionFromRequest(request, env) {
  let sessionId = null;

  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    sessionId = authHeader.slice(7).trim();
  }

  if (!sessionId) {
    const cookieHeader = request.headers.get('Cookie') ?? '';
    const match = cookieHeader.match(/(?:^|;\s*)vlp_session=([^;]+)/);
    if (match) sessionId = match[1];
  }

  if (!sessionId) return null;

  try {
    const now = new Date().toISOString();
    const session = await env.DB.prepare(
      'SELECT * FROM sessions WHERE session_id = ? AND expires_at > ?'
    ).bind(sessionId, now).first();
    return session ?? null;
  } catch {
    return null;
  }
}

async function requireSession(request, env) {
  const session = await getSessionFromRequest(request, env);
  if (!session) {
    return { error: json({ ok: false, error: 'UNAUTHORIZED' }, 401) };
  }
  return { session };
}

// ---------------------------------------------------------------------------
// JWT helpers (HMAC-SHA256)
// ---------------------------------------------------------------------------

function base64urlEncode(buf) {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function signJwt(payload, secret) {
  const enc = new TextEncoder();
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64urlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signingInput));
  return `${signingInput}.${base64urlEncode(sig)}`;
}

async function verifyJwt(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, sigB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;
    const enc = new TextEncoder();

    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['verify']
    );
    const valid = await crypto.subtle.verify(
      'HMAC', key,
      base64urlDecode(sigB64),
      enc.encode(signingInput)
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// Replace with Resend/SendGrid when email provider is confirmed
async function sendEmail(to, subject, htmlBody, _env) {
  console.log(`[sendEmail] to=${to} subject=${subject}`);
  console.log(`[sendEmail] body=${htmlBody}`);
  return true;
}

// ---------------------------------------------------------------------------
// TOTP helpers (RFC 6238, HMAC-SHA1, 30-second step, 6-digit code)
// ---------------------------------------------------------------------------

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes) {
  let bits = 0, value = 0, output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_CHARS[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(str) {
  str = str.toUpperCase().replace(/=+$/, '');
  const bytes = [];
  let bits = 0, value = 0;
  for (const char of str) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

async function totpCode(secret, counter) {
  const key = await crypto.subtle.importKey(
    'raw', base32Decode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false, ['sign']
  );
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  // Write counter as big-endian 64-bit (high word 0 for normal timestamps)
  view.setUint32(4, counter >>> 0, false);
  const sig = await crypto.subtle.sign('HMAC', key, buf);
  const arr = new Uint8Array(sig);
  const offset = arr[arr.length - 1] & 0x0f;
  const code = (
    ((arr[offset] & 0x7f) << 24) |
    ((arr[offset + 1] & 0xff) << 16) |
    ((arr[offset + 2] & 0xff) << 8) |
    (arr[offset + 3] & 0xff)
  ) % 1_000_000;
  return code.toString().padStart(6, '0');
}

async function verifyTotp(secret, otp) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (const delta of [-1, 0, 1]) {
    if ((await totpCode(secret, counter + delta)) === otp) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Shared account + session helpers (used across auth flows)
// ---------------------------------------------------------------------------

async function upsertAccount(email, firstName, lastName, env) {
  const now = new Date().toISOString();
  const newAccountId = `ACCT_${crypto.randomUUID()}`;

  await d1Run(env.DB,
    `INSERT INTO accounts (account_id, email, first_name, last_name, platform, role, status, created_at)
     VALUES (?, ?, ?, ?, 'vlp', 'member', 'active', ?)
     ON CONFLICT(email) DO UPDATE SET
       first_name = excluded.first_name,
       last_name  = excluded.last_name,
       updated_at = ?`,
    [newAccountId, email, firstName, lastName, now, now]
  );

  // Fetch the canonical account_id (may differ from newAccountId if row existed)
  const row = await env.DB.prepare(
    'SELECT account_id FROM accounts WHERE email = ?'
  ).bind(email).first();
  const accountId = row.account_id;

  await r2Put(env.R2_VIRTUAL_LAUNCH, `accounts_vlp/VLP_ACCT_${accountId}.json`, {
    accountId, email, firstName, lastName,
    platform: 'vlp', role: 'member', status: 'active', updatedAt: now,
  });

  return { accountId, now };
}

async function createSession(accountId, email, env) {
  const sessionId = `SES_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const ttl = parseInt(env.SESSION_TTL_SECONDS ?? '86400', 10);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  await d1Run(env.DB,
    `INSERT INTO sessions (session_id, account_id, email, platform, membership, created_at, expires_at)
     VALUES (?, ?, ?, 'vlp', 'free', ?, ?)`,
    [sessionId, accountId, email, now, expiresAt]
  );

  return { sessionId, expiresAt };
}

// ---------------------------------------------------------------------------
// Stripe helpers
// ---------------------------------------------------------------------------

/**
 * Flatten nested objects/arrays into Stripe's form-encoded dot-bracket notation.
 * e.g. { metadata: { account_id: 'x' } } → { 'metadata[account_id]': 'x' }
 *      { items: [{ price: 'p' }] }        → { 'items[0][price]': 'p' }
 */
function flattenStripeParams(params, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === 'object') {
          Object.assign(result, flattenStripeParams(item, `${fullKey}[${i}]`));
        } else {
          result[`${fullKey}[${i}]`] = String(item);
        }
      });
    } else if (typeof value === 'object') {
      Object.assign(result, flattenStripeParams(value, fullKey));
    } else {
      result[fullKey] = String(value);
    }
  }
  return result;
}

async function stripePost(path, params, env) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(flattenStripeParams(params)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `Stripe error ${res.status}`);
  return data;
}

async function stripeGet(path, env) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `Stripe error ${res.status}`);
  return data;
}

async function stripeDelete(path, env) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `Stripe error ${res.status}`);
  return data;
}

function getPriceId(planKey, billingInterval, env) {
  const map = {
    'vlp_free/monthly':     env.STRIPE_PRICE_VLP_FREE_MONTHLY,
    'vlp_starter/monthly':  env.STRIPE_PRICE_VLP_STARTER_MONTHLY,
    'vlp_starter/yearly':   env.STRIPE_PRICE_VLP_STARTER_YEARLY,
    'vlp_advanced/monthly': env.STRIPE_PRICE_VLP_ADVANCED_MONTHLY,
    'vlp_advanced/yearly':  env.STRIPE_PRICE_VLP_ADVANCED_YEARLY,
    'vlp_scale/monthly':    env.STRIPE_PRICE_VLP_SCALE_MONTHLY,
    'vlp_scale/yearly':     env.STRIPE_PRICE_VLP_SCALE_YEARLY,
  };
  return map[`${planKey}/${billingInterval}`] ?? null;
}

function getTokenGrant(planKey) {
  const grants = {
    vlp_free:     { taxGameTokens: 0,     transcriptTokens: 0 },
    vlp_starter:  { taxGameTokens: 10000, transcriptTokens: 25000 },
    vlp_advanced: { taxGameTokens: 25000, transcriptTokens: 75000 },
    vlp_scale:    { taxGameTokens: 50000, transcriptTokens: 150000 },
  };
  return grants[planKey] ?? { taxGameTokens: 0, transcriptTokens: 0 };
}

async function calPost(path, body, accessToken) {
  const res = await fetch(`https://api.cal.com/v1${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message ?? `Cal.com error ${res.status}`);
  return data;
}

async function verifyCalSignature(rawBody, signatureHeader, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expected = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return expected === signatureHeader;
}

function makeSessionCookie(sessionId, env) {
  const ttl = parseInt(env.SESSION_TTL_SECONDS ?? '86400', 10);
  const expires = new Date(Date.now() + ttl * 1000).toUTCString();
  const domain = env.COOKIE_DOMAIN ?? '.virtuallaunch.pro';
  return [
    `vlp_session=${sessionId}`,
    `Domain=${domain}`,
    `Path=/`,
    `Expires=${expires}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
  ].join('; ');
}

function jsonWithCookie(body, sessionId, env, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      'Set-Cookie': makeSessionCookie(sessionId, env),
    },
  });
}

function redirectWithCookie(url, sessionId, env) {
  return new Response(null, {
    status: 302,
    headers: {
      'Location': url,
      'Set-Cookie': makeSessionCookie(sessionId, env),
      'Access-Control-Allow-Origin': 'https://virtuallaunch.pro',
      'Access-Control-Allow-Credentials': 'true',
    },
  });
}

// ---------------------------------------------------------------------------
// Cal.com OAuth helpers
// ---------------------------------------------------------------------------

/**
 * PKCE helper — generates a code_verifier and S256 code_challenge.
 */
async function generatePKCE() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const codeVerifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);

  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return { codeVerifier, codeChallenge };
}

/**
 * FLOW A — VLP user connects to read back their bookings with the VLP team.
 * App: Virtual Launch Pro App (782133b...)
 * Redirect: https://api.virtuallaunch.pro/cal/app/oauth/callback
 * Tokens stored in: accounts.cal_access_token (fast status check)
 * PKCE: ON (S256)
 */
async function handleCalVlpOAuthCallback(request, env, session) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (!code) return { ok: false, error: 'MISSING_CODE', message: 'Missing authorization code' };

  const state = url.searchParams.get('state');
  if (!state) return { ok: false, error: 'MISSING_STATE', message: 'Missing state parameter' };

  // Look up and consume the stored code_verifier for this state
  const stateRow = await env.DB.prepare(
    'SELECT code_verifier FROM oauth_state WHERE state_key = ?'
  ).bind(state).first();
  if (!stateRow) return { ok: false, error: 'INVALID_STATE', message: 'State not found or already used' };

  await d1Run(env.DB, 'DELETE FROM oauth_state WHERE state_key = ?', [state]);
  const codeVerifier = stateRow.code_verifier;

  const calClientId = env.CAL_VLP_OAUTH_CLIENT_ID ?? '782133b560b9ee33174a7a765b8cd73343ffeb2ece517be73a3061f370e21eeb';
  const redirectUri = env.CAL_VLP_REDIRECT_URI ?? 'https://api.virtuallaunch.pro/cal/app/oauth/callback';

  const tokenRes = await fetch('https://app.cal.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: calClientId,
      redirect_uri: redirectUri,
      code,
      code_verifier: codeVerifier,
    }),
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    return { ok: false, error: 'TOKEN_EXCHANGE_FAILED', message: tokenData?.error_description ?? 'Token exchange failed' };
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString();
  await d1Run(env.DB,
    'UPDATE accounts SET cal_access_token = ?, cal_refresh_token = ?, cal_token_expiry = ?, updated_at = ? WHERE account_id = ?',
    [tokenData.access_token, tokenData.refresh_token, expiresAt, now, session.account_id]
  );
  return { ok: true };
}

/**
 * FLOW B — Tax pro connects their own Cal.com so clients can book them.
 * App: Tax Monitor Pro Tax Professionals (9d03bcaa...)
 * Redirect: https://api.virtuallaunch.pro/v1/cal/oauth/callback
 * Tokens stored in: cal_connections table
 */
async function handleCalProOAuthCallback(request, env, session) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (!code) return { ok: false, error: 'MISSING_CODE', message: 'Missing authorization code' };

  const calClientId = env.CAL_PRO_OAUTH_CLIENT_ID ?? '9d03bcaa8ee24644d21dc7af5c3c17722ffa314c9790f2c7c83a1f88032b8420';
  const redirectUri = env.CAL_PRO_REDIRECT_URI ?? 'https://api.virtuallaunch.pro/v1/cal/oauth/callback';

  const tokenRes = await fetch('https://app.cal.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: calClientId,
      client_secret: env.CAL_PRO_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code,
    }),
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    return { ok: false, error: 'TOKEN_EXCHANGE_FAILED', message: tokenData?.error_description ?? 'Token exchange failed' };
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString();
  const connectionId = `cal_pro_${session.account_id}`;
  const connection = {
    connectionId, accountId: session.account_id, calApp: 'cal_pro',
    accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token,
    expiresAt, createdAt: now, updatedAt: now,
  };
  await r2Put(env.R2_VIRTUAL_LAUNCH, `cal_connections/${connectionId}.json`, connection);
  await d1Run(env.DB,
    `INSERT INTO cal_connections (connection_id, account_id, cal_app, access_token, refresh_token, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(connection_id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`,
    [connectionId, session.account_id, 'cal_pro', tokenData.access_token, tokenData.refresh_token, expiresAt, now, now]
  );
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Route table
// Each entry: { method, pattern, handler }
// method: HTTP verb string, or '*' to match any (used for webhooks)
// ---------------------------------------------------------------------------

const ROUTES = [

  // -------------------------------------------------------------------------
  // AUTH
  // -------------------------------------------------------------------------

  {
    method: 'GET', pattern: '/v1/auth/session',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      // Read current membership from memberships table (source of truth after checkout)
      let membership = session.membership;
      try {
        const memRow = await env.DB.prepare(
          "SELECT plan_key FROM memberships WHERE account_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
        ).bind(session.account_id).first();
        if (memRow?.plan_key) {
          membership = memRow.plan_key.replace(/^vlp_/, '').replace(/_(?:monthly|yearly)$/, '') || membership;
        }
      } catch {/* fall back to session.membership */}

      return json({
        ok: true,
        session: {
          account_id: session.account_id,
          email: session.email,
          membership,
          platform: session.platform,
          expires_at: session.expires_at,
        },
      });
    },
  },

  {
    method: 'POST', pattern: '/v1/auth/logout',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;
      try {
        await d1Run(env.DB, 'DELETE FROM sessions WHERE session_id = ?', [session.session_id]);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to delete session' }, 500);
      }
      return new Response(JSON.stringify({ ok: true, status: 'logged_out' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS,
          'Set-Cookie': [
            'vlp_session=',
            'Domain=' + (env.COOKIE_DOMAIN ?? '.virtuallaunch.pro'),
            'Path=/',
            'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
            'HttpOnly',
            'Secure',
            'SameSite=Lax',
          ].join('; '),
        },
      });
    },
  },

  {
    method: 'GET', pattern: '/v1/auth/google/start',
    handler: async (_method, _pattern, _params, _request, env) => {
      const state = crypto.randomUUID();
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
      url.searchParams.set('redirect_uri', env.GOOGLE_REDIRECT_URI);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', state);
      return json({ ok: true, status: 'redirect_required', authorizationUrl: url.toString() });
    },
  },

  {
    method: 'GET', pattern: '/v1/auth/google/callback',
    handler: async (_method, _pattern, _params, request, env) => {
      const url = new URL(request.url);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'code and state required' }, 400);
      }
      try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: env.GOOGLE_REDIRECT_URI,
            grant_type: 'authorization_code',
          }),
        });
        if (!tokenRes.ok) return json({ ok: false, error: 'OAUTH_ERROR', message: 'Token exchange failed' }, 502);
        const { access_token } = await tokenRes.json();

        const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        if (!userRes.ok) return json({ ok: false, error: 'OAUTH_ERROR', message: 'Failed to fetch user info' }, 502);
        const user = await userRes.json();

        const { accountId } = await upsertAccount(user.email, user.given_name ?? '', user.family_name ?? '', env);
        const { sessionId } = await createSession(accountId, user.email, env);
        return redirectWithCookie(`https://virtuallaunch.pro/dashboard`, sessionId, env);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Google callback failed' }, 500);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/auth/magic-link/request',
    handler: async (_method, _pattern, _params, request, env) => {
      const body = await parseBody(request);
      if (!body?.email || !body?.redirectUri) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'email and redirectUri required' }, 400);
      }
      const { email, redirectUri } = body;
      try {
        const expMinutes = parseInt(env.MAGIC_LINK_EXPIRATION_MINUTES ?? '15', 10);
        const exp = Math.floor(Date.now() / 1000) + expMinutes * 60;
        const token = await signJwt({ email, redirect_uri: redirectUri, exp }, env.JWT_SECRET);
        const link = `https://virtuallaunch.pro/v1/auth/magic-link/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
        await sendEmail(email, 'Your sign-in link', `<p>Click to sign in: <a href="${link}">${link}</a></p>`, env);
        const eventId = `EVT_${crypto.randomUUID()}`;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/auth/${eventId}.json`, {
          email, requested_at: new Date().toISOString(), event: 'MAGIC_LINK_REQUESTED',
        });
        return json({ ok: true, status: 'requested', email });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Magic link request failed' }, 500);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/auth/magic-link/verify',
    handler: async (_method, _pattern, _params, request, env) => {
      const url = new URL(request.url);
      const token = url.searchParams.get('token');
      const email = url.searchParams.get('email');
      if (!token || !email) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'token and email required' }, 400);
      }
      try {
        const payload = await verifyJwt(token, env.JWT_SECRET);
        if (!payload) return json({ ok: false, error: 'INVALID_TOKEN' }, 401);
        if (payload.email !== email) return json({ ok: false, error: 'INVALID_TOKEN' }, 401);
        const { accountId } = await upsertAccount(email, '', '', env);
        const { sessionId } = await createSession(accountId, email, env);
        return redirectWithCookie(`https://virtuallaunch.pro/dashboard`, sessionId, env);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Magic link verification failed' }, 500);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/auth/sso/oidc/start',
    handler: async (_method, _pattern, _params, _request, env) => {
      const state = crypto.randomUUID();
      const url = new URL(`${env.SSO_OIDC_ISSUER}/o/oauth2/v2/auth`);
      url.searchParams.set('client_id', env.SSO_OIDC_CLIENT_ID);
      url.searchParams.set('redirect_uri', env.SSO_OIDC_REDIRECT_URI);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', state);
      return json({ ok: true, status: 'redirect_required', authorizationUrl: url.toString() });
    },
  },

  {
    method: 'GET', pattern: '/v1/auth/sso/oidc/callback',
    handler: async (_method, _pattern, _params, request, env) => {
      const url = new URL(request.url);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'code and state required' }, 400);
      }
      try {
        const tokenRes = await fetch(`${env.SSO_OIDC_ISSUER}/o/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: env.SSO_OIDC_CLIENT_ID,
            client_secret: env.SSO_OIDC_CLIENT_SECRET,
            redirect_uri: env.SSO_OIDC_REDIRECT_URI,
            grant_type: 'authorization_code',
          }),
        });
        if (!tokenRes.ok) return json({ ok: false, error: 'OAUTH_ERROR', message: 'Token exchange failed' }, 502);
        const { access_token } = await tokenRes.json();

        const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        if (!userRes.ok) return json({ ok: false, error: 'OAUTH_ERROR', message: 'Failed to fetch user info' }, 502);
        const user = await userRes.json();

        const { accountId } = await upsertAccount(user.email, user.given_name ?? '', user.family_name ?? '', env);
        const { sessionId } = await createSession(accountId, user.email, env);
        return jsonWithCookie({ ok: true, status: 'callback_completed', redirectTo: `https://virtuallaunch.pro/dashboard` }, sessionId, env);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'OIDC callback failed' }, 500);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/auth/sso/saml/start',
    handler: async (_method, _pattern, _params, _request, env) => {
      return json({ ok: true, status: 'redirect_required', authorizationUrl: env.SSO_SAML_IDP_SSO_URL });
    },
  },

  {
    method: 'POST', pattern: '/v1/auth/sso/saml/acs',
    handler: async (_method, _pattern, _params, request, env) => {
      const body = await parseBody(request);
      if (!body?.samlResponse || !body?.relayState) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'samlResponse and relayState required' }, 400);
      }
      try {
        const decoded = atob(body.samlResponse);
        let email = null;
        const nameIdMatch = decoded.match(/<(?:[^:>]+:)?NameID[^>]*>([^<]+)<\/(?:[^:>]+:)?NameID>/);
        if (nameIdMatch) email = nameIdMatch[1].trim();
        if (!email) {
          const attrMatch = decoded.match(/email[^>]*>([^<]+@[^<]+)</i);
          if (attrMatch) email = attrMatch[1].trim();
        }
        if (!email) return json({ ok: false, error: 'BAD_REQUEST', message: 'Could not extract email from SAML response' }, 400);
        const { accountId } = await upsertAccount(email, '', '', env);
        const { sessionId } = await createSession(accountId, email, env);
        return redirectWithCookie(`https://virtuallaunch.pro/dashboard`, sessionId, env);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'SAML ACS failed' }, 500);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/auth/2fa/status/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      try {
        const row = await env.DB.prepare(
          'SELECT two_factor_enabled FROM accounts WHERE account_id = ?'
        ).bind(params.account_id).first();
        if (!row) return json({ ok: false, error: 'NOT_FOUND' }, 404);
        return json({ ok: true, accountId: params.account_id, enabled: row.two_factor_enabled === 1 });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: '2FA status lookup failed' }, 500);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/auth/2fa/enroll/init',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      if (!body?.accountId) return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId required' }, 400);
      const { accountId } = body;
      try {
        const secretBytes = crypto.getRandomValues(new Uint8Array(32));
        const secret = base32Encode(secretBytes);
        const row = await env.DB.prepare('SELECT email FROM accounts WHERE account_id = ?').bind(accountId).first();
        if (!row) return json({ ok: false, error: 'NOT_FOUND' }, 404);
        await d1Run(env.DB, 'UPDATE accounts SET totp_pending_secret = ? WHERE account_id = ?', [secret, accountId]);
        const issuer = env.TWOFA_TOTP_ISSUER ?? 'VirtualLaunchPro';
        const otpauthUri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(row.email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
        return json({ ok: true, status: 'enrollment_started', accountId, challenge: { otpauthUri, secret } });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: '2FA enrollment init failed' }, 500);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/auth/2fa/enroll/verify',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      if (!body?.accountId || !body?.otpCode) return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId and otpCode required' }, 400);
      const { accountId, otpCode } = body;
      if (String(otpCode).length !== 6) return json({ ok: false, error: 'INVALID_OTP' }, 401);
      try {
        const row = await env.DB.prepare('SELECT totp_pending_secret, email FROM accounts WHERE account_id = ?').bind(accountId).first();
        if (!row?.totp_pending_secret) return json({ ok: false, error: 'BAD_REQUEST', message: 'No pending enrollment found' }, 400);
        const valid = await verifyTotp(row.totp_pending_secret, String(otpCode));
        if (!valid) return json({ ok: false, error: 'INVALID_OTP' }, 401);
        await d1Run(env.DB,
          'UPDATE accounts SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, two_factor_enabled = 1 WHERE account_id = ?',
          [accountId]
        );
        const now = new Date().toISOString();
        const existing2faEnroll = await env.R2_VIRTUAL_LAUNCH.get(`accounts_vlp/VLP_ACCT_${accountId}.json`);
        const record2faEnroll = existing2faEnroll ? await existing2faEnroll.json() : {};
        record2faEnroll.twoFactorEnabled = true;
        record2faEnroll.updatedAt = now;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `accounts_vlp/VLP_ACCT_${accountId}.json`, record2faEnroll);
        return json({ ok: true, status: 'enrollment_verified', accountId });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: '2FA enrollment verify failed' }, 500);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/auth/2fa/challenge/verify',
    handler: async (_method, _pattern, _params, request, env) => {
      const body = await parseBody(request);
      if (!body?.accountId || !body?.otpCode || !body?.sessionToken) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, otpCode, and sessionToken required' }, 400);
      }
      const { accountId, otpCode, sessionToken } = body;
      try {
        const row = await env.DB.prepare('SELECT totp_secret FROM accounts WHERE account_id = ?').bind(accountId).first();
        if (!row?.totp_secret) return json({ ok: false, error: 'BAD_REQUEST', message: '2FA not enrolled' }, 400);
        const valid = await verifyTotp(row.totp_secret, String(otpCode));
        if (!valid) return json({ ok: false, error: 'INVALID_OTP' }, 401);
        await d1Run(env.DB, 'UPDATE sessions SET two_fa_verified = 1 WHERE session_id = ?', [sessionToken]);
        return json({ ok: true, status: 'verified', accountId });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: '2FA challenge verify failed' }, 500);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/auth/2fa/disable',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      if (!body?.accountId || !body?.challengeToken) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId and challengeToken required' }, 400);
      }
      const { accountId, challengeToken } = body;
      try {
        const row = await env.DB.prepare('SELECT totp_secret, email FROM accounts WHERE account_id = ?').bind(accountId).first();
        if (!row?.totp_secret) return json({ ok: false, error: 'BAD_REQUEST', message: '2FA not enrolled' }, 400);
        const valid = await verifyTotp(row.totp_secret, String(challengeToken));
        if (!valid) return json({ ok: false, error: 'INVALID_OTP' }, 401);
        await d1Run(env.DB, 'UPDATE accounts SET totp_secret = NULL, two_factor_enabled = 0 WHERE account_id = ?', [accountId]);
        const now = new Date().toISOString();
        const existing2faDisable = await env.R2_VIRTUAL_LAUNCH.get(`accounts_vlp/VLP_ACCT_${accountId}.json`);
        const record2faDisable = existing2faDisable ? await existing2faDisable.json() : {};
        record2faDisable.twoFactorEnabled = false;
        record2faDisable.updatedAt = now;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `accounts_vlp/VLP_ACCT_${accountId}.json`, record2faDisable);
        return json({ ok: true, status: 'disabled', accountId });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: '2FA disable failed' }, 500);
      }
    },
  },

  // -------------------------------------------------------------------------
  // CONTACT
  // -------------------------------------------------------------------------

  {
    method: 'POST', pattern: '/v1/contact/submit',
    handler: async (_method, _pattern, _params, request, env) => {
      try {
        const body = await parseBody(request);
        const { email, eventId, message, name, source } = body ?? {};
        if (!email || !eventId || !message || !name || !source) {
          return json({ ok: false, error: 'MISSING_FIELDS', message: 'email, eventId, message, name, source are required' }, 400);
        }
        if (name.length > 200) return json({ ok: false, error: 'VALIDATION', message: 'name max 200 chars' }, 400);
        if (message.length > 5000) return json({ ok: false, error: 'VALIDATION', message: 'message max 5000 chars' }, 400);
        const now = new Date().toISOString();
        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/contact/${eventId}.json`, {
          email, name, message, source, event: 'CONTACT_SUBMITTED', created_at: now,
        });
        await r2Put(env.R2_VIRTUAL_LAUNCH, `contact_submissions/${eventId}.json`, {
          eventId, email, name, message, source, createdAt: now,
        });
        await sendEmail(
          'hello@virtuallaunch.pro',
          `New contact form submission from ${name}`,
          `<p>From: ${name} (${email})</p><p>Source: ${source}</p><p>Message: ${message}</p>`,
          env
        );
        return json({ ok: true, eventId, status: 'submitted' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Contact submit failed' }, 500);
      }
    },
  },

  // -------------------------------------------------------------------------
  // ACCOUNTS
  // -------------------------------------------------------------------------

  {
    method: 'POST', pattern: '/v1/accounts',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      const { accountId, email, firstName, lastName, platform, role, source } = body ?? {};
      if (!accountId || !email || !firstName || !lastName || !platform || !role || !source) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, email, firstName, lastName, platform, role, source required' }, 400);
      }
      try {
        const eventId = `EVT_${crypto.randomUUID()}`;
        const now = new Date().toISOString();
        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/accounts/${eventId}.json`, {
          accountId, email, event: 'ACCOUNT_CREATED', created_at: now, source,
        });
        await d1Run(env.DB,
          `INSERT OR IGNORE INTO accounts (account_id, email, first_name, last_name, platform, role, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
          [accountId, email, firstName, lastName, platform, role, now]
        );
        await r2Put(env.R2_VIRTUAL_LAUNCH, `accounts_vlp/VLP_ACCT_${accountId}.json`, {
          accountId, email, firstName, lastName, platform, role, status: 'active', createdAt: now,
        });
        return json({ ok: true, accountId, status: 'created' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Account creation failed' }, 500);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/accounts/by-email/:email',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      try {
        const row = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?')
          .bind(decodeURIComponent(params.email)).first();
        if (!row) return json({ ok: false, error: 'NOT_FOUND' }, 404);
        return json({ ok: true, account: row });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Account lookup failed' }, 500);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/accounts/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      try {
        const row = await env.DB.prepare('SELECT * FROM accounts WHERE account_id = ?').bind(params.account_id).first();
        if (!row) return json({ ok: false, error: 'NOT_FOUND' }, 404);
        return json({ ok: true, account: row });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Account lookup failed' }, 500);
      }
    },
  },

  {
    method: 'PATCH', pattern: '/v1/accounts/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      if (!body) return json({ ok: false, error: 'BAD_REQUEST', message: 'Request body required' }, 400);
      const allowed = ['email', 'firstName', 'lastName', 'phone', 'status', 'timezone'];
      const dbCols = { email: 'email', firstName: 'first_name', lastName: 'last_name', phone: 'phone', status: 'status', timezone: 'timezone' };
      const sets = [], vals = [];
      for (const key of allowed) {
        if (body[key] !== undefined) { sets.push(`${dbCols[key]} = ?`); vals.push(body[key]); }
      }
      if (sets.length === 0) return json({ ok: false, error: 'BAD_REQUEST', message: 'No updatable fields provided' }, 400);
      const now = new Date().toISOString();
      sets.push('updated_at = ?');
      vals.push(now);
      vals.push(params.account_id);
      try {
        await d1Run(env.DB, `UPDATE accounts SET ${sets.join(', ')} WHERE account_id = ?`, vals);
        const existing = await env.R2_VIRTUAL_LAUNCH.get(`accounts_vlp/VLP_ACCT_${params.account_id}.json`);
        let record = existing ? await existing.json() : {};
        for (const key of allowed) { if (body[key] !== undefined) record[key] = body[key]; }
        record.updatedAt = now;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `accounts_vlp/VLP_ACCT_${params.account_id}.json`, record);
        return json({ ok: true, accountId: params.account_id, status: 'updated' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Account update failed' }, 500);
      }
    },
  },

  {
    method: 'DELETE', pattern: '/v1/accounts/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      try {
        const now = new Date().toISOString();
        await d1Run(env.DB, 'UPDATE accounts SET status = ?, updated_at = ? WHERE account_id = ?', ['archived', now, params.account_id]);
        const existing = await env.R2_VIRTUAL_LAUNCH.get(`accounts_vlp/VLP_ACCT_${params.account_id}.json`);
        let record = existing ? await existing.json() : {};
        record.status = 'archived';
        record.updatedAt = now;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `accounts_vlp/VLP_ACCT_${params.account_id}.json`, record);
        return json({ ok: true, accountId: params.account_id, status: 'archived' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Account archive failed' }, 500);
      }
    },
  },

  // -------------------------------------------------------------------------
  // MEMBERSHIPS
  // -------------------------------------------------------------------------

  {
    method: 'POST', pattern: '/v1/memberships',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401);
      try {
        const body = await parseBody(request);
        const { accountId, membershipId, planKey, status, stripeCustomerId } = body ?? {};
        if (!accountId || !membershipId || !planKey || !status) {
          return json({ ok: false, error: 'MISSING_FIELDS', message: 'accountId, membershipId, planKey, status are required' }, 400);
        }
        const validPlans = ['vlp_free', 'vlp_starter', 'vlp_advanced', 'vlp_scale'];
        if (!validPlans.includes(planKey)) {
          return json({ ok: false, error: 'VALIDATION', message: `planKey must be one of: ${validPlans.join(', ')}` }, 400);
        }
        const validStatuses = ['active', 'cancelled', 'past_due', 'pending', 'trialing'];
        if (!validStatuses.includes(status)) {
          return json({ ok: false, error: 'VALIDATION', message: `status must be one of: ${validStatuses.join(', ')}` }, 400);
        }
        const now = new Date().toISOString();
        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/memberships/${membershipId}.json`, {
          membershipId, accountId, planKey, status, event: 'MEMBERSHIP_CREATED', created_at: now,
        });
        await r2Put(env.R2_VIRTUAL_LAUNCH, `memberships/${membershipId}.json`, {
          membershipId, accountId, planKey, status, stripeCustomerId: stripeCustomerId ?? null, createdAt: now,
        });
        await d1Run(env.DB,
          `INSERT OR IGNORE INTO memberships (membership_id, account_id, plan_key, status, stripe_customer_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [membershipId, accountId, planKey, status, stripeCustomerId ?? null, now]
        );
        return json({ ok: true, membershipId, status: 'created' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Membership creation failed' }, 500);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/memberships/by-account/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401);
      try {
        const rows = await env.DB.prepare(
          `SELECT * FROM memberships WHERE account_id = ? ORDER BY created_at DESC`
        ).bind(params.account_id).all();
        return json({ ok: true, membership: rows.results[0] ?? null });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch membership' }, 500);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/memberships/:membership_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401);
      try {
        const row = await env.DB.prepare(
          `SELECT * FROM memberships WHERE membership_id = ?`
        ).bind(params.membership_id).first();
        if (!row) return json({ ok: false, error: 'NOT_FOUND', message: 'Membership not found' }, 404);
        return json({ ok: true, membership: row });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch membership' }, 500);
      }
    },
  },

  {
    method: 'PATCH', pattern: '/v1/memberships/:membership_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401);
      try {
        const body = await parseBody(request);
        const now = new Date().toISOString();
        const setClauses = ['updated_at = ?'];
        const vals = [now];
        const validPlans = ['vlp_free', 'vlp_starter', 'vlp_advanced', 'vlp_scale'];
        const validStatuses = ['active', 'cancelled', 'past_due', 'pending', 'trialing'];
        if (body?.planKey !== undefined) {
          if (!validPlans.includes(body.planKey)) return json({ ok: false, error: 'VALIDATION', message: `planKey must be one of: ${validPlans.join(', ')}` }, 400);
          setClauses.push('plan_key = ?'); vals.push(body.planKey);
        }
        if (body?.status !== undefined) {
          if (!validStatuses.includes(body.status)) return json({ ok: false, error: 'VALIDATION', message: `status must be one of: ${validStatuses.join(', ')}` }, 400);
          setClauses.push('status = ?'); vals.push(body.status);
        }
        if (body?.stripeSubscriptionId !== undefined) { setClauses.push('stripe_subscription_id = ?'); vals.push(body.stripeSubscriptionId); }
        await d1Run(env.DB,
          `UPDATE memberships SET ${setClauses.join(', ')} WHERE membership_id = ?`,
          [...vals, params.membership_id]
        );
        const existing = await env.R2_VIRTUAL_LAUNCH.get(`memberships/${params.membership_id}.json`);
        const current = existing ? await existing.json().catch(() => ({})) : {};
        const updated = { ...current, updatedAt: now };
        if (body?.planKey !== undefined) updated.planKey = body.planKey;
        if (body?.status !== undefined) updated.status = body.status;
        if (body?.stripeSubscriptionId !== undefined) updated.stripeSubscriptionId = body.stripeSubscriptionId;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `memberships/${params.membership_id}.json`, updated);
        return json({ ok: true, membershipId: params.membership_id, status: 'updated' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Membership update failed' }, 500);
      }
    },
  },

  // -------------------------------------------------------------------------
  // BILLING
  // -------------------------------------------------------------------------

  {
    method: 'GET', pattern: '/v1/billing/config',
    handler: async (_method, _pattern, _params, _request, env) => {
      return json({
        ok: true,
        source: 'wrangler.toml',
        status: 'retrieved',
        config: {
          stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY,
          plans: {
            vlp_free:     { monthly: env.STRIPE_PRICE_VLP_FREE_MONTHLY },
            vlp_starter:  { monthly: env.STRIPE_PRICE_VLP_STARTER_MONTHLY,  yearly: env.STRIPE_PRICE_VLP_STARTER_YEARLY },
            vlp_advanced: { monthly: env.STRIPE_PRICE_VLP_ADVANCED_MONTHLY, yearly: env.STRIPE_PRICE_VLP_ADVANCED_YEARLY },
            vlp_scale:    { monthly: env.STRIPE_PRICE_VLP_SCALE_MONTHLY,    yearly: env.STRIPE_PRICE_VLP_SCALE_YEARLY },
          },
        },
      });
    },
  },

  {
    method: 'GET', pattern: '/v1/pricing',
    handler: async () => {
      return json({
        ok: true,
        pricing: {
          vlp_free:     { label: 'Free',     monthlyUsd: 0,      yearlyUsd: 0 },
          vlp_starter:  { label: 'Starter',  monthlyUsd: 4900,   yearlyUsd: 47900 },
          vlp_advanced: { label: 'Advanced', monthlyUsd: 9900,   yearlyUsd: 95900 },
          vlp_scale:    { label: 'Scale',    monthlyUsd: 19900,  yearlyUsd: 199000 },
        },
      });
    },
  },

  {
    method: 'POST', pattern: '/v1/billing/customers',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      const { accountId, email, eventId, fullName } = body ?? {};
      if (!accountId || !email || !eventId || !fullName) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, email, eventId, fullName required' }, 400);
      }
      try {
        const customer = await stripePost('/customers', {
          email,
          name: fullName,
          metadata: { account_id: accountId },
        }, env);
        const customerId = customer.id;
        const now = new Date().toISOString();

        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/billing/${eventId}.json`, {
          accountId, email, customerId, event: 'BILLING_CUSTOMER_CREATED', created_at: now,
        });
        await r2Put(env.R2_VIRTUAL_LAUNCH, `billing_customers/${accountId}.json`, {
          accountId, email, customerId, stripeCustomerId: customerId, createdAt: now,
        });
        await d1Run(env.DB,
          'INSERT OR REPLACE INTO billing_customers (account_id, stripe_customer_id, email, created_at) VALUES (?, ?, ?, ?)',
          [accountId, customerId, email, now]
        );
        return json({ ok: true, customerId, eventId, status: 'created' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/billing/payment-methods/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      try {
        const row = await env.DB.prepare(
          'SELECT stripe_customer_id FROM billing_customers WHERE account_id = ?'
        ).bind(params.account_id).first();
        if (!row) return json({ ok: true, methods: [], status: 'retrieved' });
        const stripeRes = await stripeGet(`/payment_methods?customer=${row.stripe_customer_id}&type=card`, env);
        return json({ ok: true, methods: stripeRes.data, status: 'retrieved' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/billing/payment-methods/attach',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      const { accountId, customerId, eventId, paymentMethodId, setDefault } = body ?? {};
      if (!accountId || !customerId || !eventId || !paymentMethodId || setDefault === undefined) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, customerId, eventId, paymentMethodId, setDefault required' }, 400);
      }
      try {
        await stripePost(`/payment_methods/${paymentMethodId}/attach`, { customer: customerId }, env);
        if (setDefault) {
          await stripePost(`/customers/${customerId}`, {
            invoice_settings: { default_payment_method: paymentMethodId },
          }, env);
        }
        const now = new Date().toISOString();
        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/billing/${eventId}.json`, {
          accountId, customerId, paymentMethodId, event: 'PAYMENT_METHOD_ATTACHED', created_at: now,
        });
        await r2Put(env.R2_VIRTUAL_LAUNCH, `billing_payment_methods/${accountId}.json`, {
          accountId, customerId, paymentMethodId, setDefault, updatedAt: now,
        });
        return json({ ok: true, paymentMethodId, eventId, status: 'attached' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/billing/setup-intents',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      const { accountId, customerId, eventId, usage } = body ?? {};
      if (!accountId || !customerId || !eventId || !usage) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, customerId, eventId, usage required' }, 400);
      }
      if (usage !== 'off_session' && usage !== 'on_session') {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'usage must be off_session or on_session' }, 400);
      }
      try {
        const si = await stripePost('/setup_intents', {
          customer: customerId,
          usage,
          metadata: { account_id: accountId },
        }, env);
        const setupIntentId = si.id;
        const now = new Date().toISOString();
        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/billing/${eventId}.json`, {
          accountId, customerId, setupIntentId, event: 'SETUP_INTENT_CREATED', created_at: now,
        });
        await r2Put(env.R2_VIRTUAL_LAUNCH, `billing_setup_intents/${eventId}.json`, {
          accountId, customerId, setupIntentId, clientSecret: si.client_secret, usage, createdAt: now,
        });
        return json({ ok: true, setupIntentId, clientSecret: si.client_secret, eventId, status: 'created' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/billing/payment-intents',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      const { accountId, amount, currency, customerId, eventId, metadata } = body ?? {};
      if (!accountId || !amount || !currency || !customerId || !eventId) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, amount, currency, customerId, eventId required' }, 400);
      }
      if (!Number.isInteger(amount) || amount < 1) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'amount must be integer >= 1' }, 400);
      }
      if (currency !== 'usd') {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'currency must be usd' }, 400);
      }
      try {
        const pi = await stripePost('/payment_intents', {
          amount,
          currency,
          customer: customerId,
          metadata: { account_id: accountId, ...(metadata ?? {}) },
        }, env);
        const paymentIntentId = pi.id;
        const now = new Date().toISOString();
        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/billing/${eventId}.json`, {
          accountId, amount, currency, paymentIntentId, event: 'PAYMENT_INTENT_CREATED', created_at: now,
        });
        await r2Put(env.R2_VIRTUAL_LAUNCH, `billing_payment_intents/${eventId}.json`, {
          accountId, amount, currency, customerId, paymentIntentId, clientSecret: pi.client_secret, createdAt: now,
        });
        return json({ ok: true, paymentIntentId, clientSecret: pi.client_secret, eventId, status: 'created' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/billing/subscriptions',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      const { accountId, billingInterval, customerId, eventId, membershipId, planKey, priceId, productId } = body ?? {};
      if (!accountId || !billingInterval || !customerId || !eventId || !membershipId || !planKey || !priceId || !productId) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, billingInterval, customerId, eventId, membershipId, planKey, priceId, productId required' }, 400);
      }
      if (billingInterval !== 'monthly' && billingInterval !== 'yearly') {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'billingInterval must be monthly or yearly' }, 400);
      }
      if (!['vlp_free', 'vlp_starter', 'vlp_advanced', 'vlp_scale'].includes(planKey)) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'Invalid planKey' }, 400);
      }
      try {
        const sub = await stripePost('/subscriptions', {
          customer: customerId,
          items: [{ price: priceId }],
          metadata: { account_id: accountId, membership_id: membershipId, plan_key: planKey },
        }, env);
        const subscriptionId = sub.id;
        const tokenGrant = getTokenGrant(planKey);
        const now = new Date().toISOString();

        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/billing/${eventId}.json`, {
          accountId, membershipId, planKey, subscriptionId, event: 'SUBSCRIPTION_CREATED', created_at: now,
        });
        await r2Put(env.R2_VIRTUAL_LAUNCH, `billing_subscriptions/${membershipId}.json`, {
          accountId, membershipId, planKey, billingInterval, stripeSubscriptionId: subscriptionId,
          stripeCustomerId: customerId, status: 'active', createdAt: now,
        });
        await r2Put(env.R2_VIRTUAL_LAUNCH, `memberships/${membershipId}.json`, {
          accountId, membershipId, planKey, billingInterval, stripeSubscriptionId: subscriptionId,
          stripeCustomerId: customerId, status: 'active', createdAt: now,
        });
        await r2Put(env.R2_VIRTUAL_LAUNCH, `tokens/${accountId}.json`, {
          accountId, ...tokenGrant, updatedAt: now,
        });

        await d1Run(env.DB,
          `INSERT OR REPLACE INTO memberships
           (membership_id, account_id, plan_key, billing_interval, status, stripe_customer_id, stripe_subscription_id, created_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
          [membershipId, accountId, planKey, billingInterval, customerId, subscriptionId, now]
        );
        await d1Run(env.DB,
          'INSERT OR REPLACE INTO tokens (account_id, tax_game_tokens, transcript_tokens, updated_at) VALUES (?, ?, ?, ?)',
          [accountId, tokenGrant.taxGameTokens, tokenGrant.transcriptTokens, now]
        );
        return json({ ok: true, membershipId, subscriptionId, eventId, status: 'created' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502);
      }
    },
  },

  {
    method: 'PATCH', pattern: '/v1/billing/subscriptions/:membership_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      const { billingInterval, eventId, membershipId, planKey, priceId } = body ?? {};
      if (!billingInterval || !eventId || !membershipId || !planKey || !priceId) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'billingInterval, eventId, membershipId, planKey, priceId required' }, 400);
      }
      try {
        const row = await env.DB.prepare('SELECT * FROM memberships WHERE membership_id = ?').bind(params.membership_id).first();
        if (!row) return json({ ok: false, error: 'NOT_FOUND' }, 404);

        // GET current subscription from Stripe to find item ID
        const sub = await stripeGet(`/subscriptions/${row.stripe_subscription_id}`, env);
        const itemId = sub.items?.data?.[0]?.id;
        if (!itemId) return json({ ok: false, error: 'INTERNAL_ERROR', message: 'No subscription item found' }, 502);

        // Update subscription item with new price
        await stripePost(`/subscription_items/${itemId}`, { price: priceId }, env);

        const tokenGrant = getTokenGrant(planKey);
        const now = new Date().toISOString();

        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/billing/${eventId}.json`, {
          membershipId, planKey, event: 'SUBSCRIPTION_UPDATED', created_at: now,
        });

        const existingSub = await env.R2_VIRTUAL_LAUNCH.get(`billing_subscriptions/${params.membership_id}.json`);
        const subRecord = existingSub ? await existingSub.json() : {};
        subRecord.planKey = planKey;
        subRecord.billingInterval = billingInterval;
        subRecord.updatedAt = now;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `billing_subscriptions/${params.membership_id}.json`, subRecord);

        const existingMem = await env.R2_VIRTUAL_LAUNCH.get(`memberships/${params.membership_id}.json`);
        const memRecord = existingMem ? await existingMem.json() : {};
        memRecord.planKey = planKey;
        memRecord.billingInterval = billingInterval;
        memRecord.updatedAt = now;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `memberships/${params.membership_id}.json`, memRecord);

        const existingTokens = await env.R2_VIRTUAL_LAUNCH.get(`tokens/${row.account_id}.json`);
        const tokenRecord = existingTokens ? await existingTokens.json() : {};
        tokenRecord.taxGameTokens = tokenGrant.taxGameTokens;
        tokenRecord.transcriptTokens = tokenGrant.transcriptTokens;
        tokenRecord.updatedAt = now;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `tokens/${row.account_id}.json`, tokenRecord);

        await d1Run(env.DB,
          'UPDATE memberships SET plan_key = ?, billing_interval = ?, updated_at = ? WHERE membership_id = ?',
          [planKey, billingInterval, now, params.membership_id]
        );
        await d1Run(env.DB,
          'INSERT OR REPLACE INTO tokens (account_id, tax_game_tokens, transcript_tokens, updated_at) VALUES (?, ?, ?, ?)',
          [row.account_id, tokenGrant.taxGameTokens, tokenGrant.transcriptTokens, now]
        );
        return json({ ok: true, membershipId: params.membership_id, eventId, status: 'updated' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/billing/subscriptions/:membership_id/cancel',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      const { accountId, cancelAtPeriodEnd, eventId, membershipId, reason } = body ?? {};
      if (!accountId || cancelAtPeriodEnd === undefined || !eventId || !membershipId) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, cancelAtPeriodEnd, eventId, membershipId required' }, 400);
      }
      try {
        const row = await env.DB.prepare('SELECT stripe_subscription_id FROM memberships WHERE membership_id = ?').bind(params.membership_id).first();
        if (!row) return json({ ok: false, error: 'NOT_FOUND' }, 404);

        if (cancelAtPeriodEnd) {
          await stripePost(`/subscriptions/${row.stripe_subscription_id}`, { cancel_at_period_end: true }, env);
        } else {
          await stripeDelete(`/subscriptions/${row.stripe_subscription_id}`, env);
        }

        const now = new Date().toISOString();
        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/billing/${eventId}.json`, {
          accountId, membershipId, cancelAtPeriodEnd, reason, event: 'SUBSCRIPTION_CANCELLED', created_at: now,
        });

        const existingMem = await env.R2_VIRTUAL_LAUNCH.get(`memberships/${params.membership_id}.json`);
        const memRecord = existingMem ? await existingMem.json() : {};
        memRecord.status = 'cancelled';
        memRecord.updatedAt = now;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `memberships/${params.membership_id}.json`, memRecord);

        await d1Run(env.DB,
          'UPDATE memberships SET status = \'cancelled\', updated_at = ? WHERE membership_id = ?',
          [now, params.membership_id]
        );
        return json({ ok: true, membershipId, eventId, status: 'cancelled' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/billing/portal/sessions',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      const { accountId, customerId, eventId, returnUrl } = body ?? {};
      if (!accountId || !customerId || !eventId || !returnUrl) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, customerId, eventId, returnUrl required' }, 400);
      }
      try {
        const portal = await stripePost('/billing_portal/sessions', {
          customer: customerId,
          return_url: returnUrl,
        }, env);
        const portalUrl = portal.url;
        const now = new Date().toISOString();

        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/billing/${eventId}.json`, {
          accountId, customerId, portalUrl, event: 'PORTAL_SESSION_CREATED', created_at: now,
        });

        const existingCustomer = await env.R2_VIRTUAL_LAUNCH.get(`billing_customers/${accountId}.json`);
        const customerRecord = existingCustomer ? await existingCustomer.json() : {};
        customerRecord.lastPortalSession = portalUrl;
        customerRecord.updatedAt = now;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `billing_customers/${accountId}.json`, customerRecord);

        return json({ ok: true, url: portalUrl, eventId, status: 'created' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/billing/tokens/purchase',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      const { accountId, amount, currency, eventId, quantity, tokenType } = body ?? {};
      if (!accountId || !amount || !currency || !eventId || !quantity || !tokenType) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, amount, currency, eventId, quantity, tokenType required' }, 400);
      }
      if (tokenType !== 'tax_game' && tokenType !== 'transcript') {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'tokenType must be tax_game or transcript' }, 400);
      }
      if (currency !== 'usd') {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'currency must be usd' }, 400);
      }
      if (!Number.isInteger(quantity) || quantity < 1) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'quantity must be integer >= 1' }, 400);
      }
      try {
        const pi = await stripePost('/payment_intents', {
          amount,
          currency,
          metadata: { account_id: accountId, token_type: tokenType, quantity },
        }, env);
        const paymentIntentId = pi.id;
        const now = new Date().toISOString();

        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/billing/${eventId}.json`, {
          accountId, tokenType, quantity, amount, paymentIntentId, event: 'TOKENS_PURCHASED', created_at: now,
        });

        // Read-merge-write R2 tokens
        const existingTokens = await env.R2_VIRTUAL_LAUNCH.get(`tokens/${accountId}.json`);
        const tokenRecord = existingTokens ? await existingTokens.json() : { accountId, taxGameTokens: 0, transcriptTokens: 0 };
        if (tokenType === 'tax_game') tokenRecord.taxGameTokens = (tokenRecord.taxGameTokens ?? 0) + quantity;
        else tokenRecord.transcriptTokens = (tokenRecord.transcriptTokens ?? 0) + quantity;
        tokenRecord.updatedAt = now;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `tokens/${accountId}.json`, tokenRecord);

        // Read current D1 tokens, add, update
        const tokenRow = await env.DB.prepare('SELECT * FROM tokens WHERE account_id = ?').bind(accountId).first();
        const currentTaxGame    = tokenRow?.tax_game_tokens    ?? 0;
        const currentTranscript = tokenRow?.transcript_tokens  ?? 0;
        const newTaxGame        = tokenType === 'tax_game'   ? currentTaxGame + quantity    : currentTaxGame;
        const newTranscript     = tokenType === 'transcript' ? currentTranscript + quantity : currentTranscript;
        await d1Run(env.DB,
          'INSERT OR REPLACE INTO tokens (account_id, tax_game_tokens, transcript_tokens, updated_at) VALUES (?, ?, ?, ?)',
          [accountId, newTaxGame, newTranscript, now]
        );
        return json({ ok: true, accountId, eventId, status: 'purchased' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/billing/receipts/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      try {
        const listResult = await env.R2_VIRTUAL_LAUNCH.list({ prefix: 'receipts/billing/', limit: 50 });
        const results = await Promise.all(
          listResult.objects.map(async (obj) => {
            try {
              const item = await env.R2_VIRTUAL_LAUNCH.get(obj.key);
              if (!item) return null;
              const data = await item.json();
              return data.accountId === params.account_id ? data : null;
            } catch { return null; }
          })
        );
        const receipts = results.filter(Boolean);
        return json({ ok: true, receipts, status: 'retrieved' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Receipt listing failed' }, 500);
      }
    },
  },

  // -------------------------------------------------------------------------
  // CHECKOUT
  // -------------------------------------------------------------------------

  // Public route — no session required. Used by the pricing page for guest checkout.
  {
    method: 'POST', pattern: '/v1/checkout/session',
    handler: async (_method, _pattern, _params, request, env) => {
      const body = await parseBody(request);
      const { billingObject, planKey, email } = body ?? {};

      if (!billingObject || !planKey) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'billingObject and planKey are required' }, 400);
      }
      if (planKey === 'vlp_free') {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'Free plan does not require checkout' }, 400);
      }

      const billingInterval = planKey.endsWith('_yearly') ? 'yearly' : 'monthly';
      const membershipId = `MEM_${crypto.randomUUID()}`;
      const pendingAccountId = `PENDING_${crypto.randomUUID()}`;
      const successUrl = `https://virtuallaunch.pro/onboarding?checkout=success&plan=${encodeURIComponent(planKey)}`;
      const cancelUrl = `https://virtuallaunch.pro/pricing`;
      const now = new Date().toISOString();

      try {
        const sessionPayload = {
          mode: 'subscription',
          line_items: [{ price: billingObject, quantity: 1 }],
          success_url: successUrl,
          cancel_url: cancelUrl,
          allow_promotion_codes: 'true',
          metadata: { membership_id: membershipId, plan_key: planKey, billing_interval: billingInterval },
        };
        if (email) sessionPayload.customer_email = email;

        const stripeSession = await stripePost('/checkout/sessions', sessionPayload, env);

        await r2Put(env.R2_VIRTUAL_LAUNCH, `memberships/${membershipId}.json`, {
          membershipId, accountId: null, planKey, billingInterval,
          checkoutSessionId: stripeSession.id, status: 'pending', createdAt: now,
        });
        await d1Run(env.DB,
          `INSERT OR REPLACE INTO memberships
           (membership_id, account_id, plan_key, billing_interval, status, created_at)
           VALUES (?, ?, ?, ?, 'pending', ?)`,
          [membershipId, pendingAccountId, planKey, billingInterval, now]
        );

        return json({ ok: true, url: stripeSession.url });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/checkout/sessions',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      const { accountId, billingInterval, cancelUrl, planKey, successUrl } = body ?? {};
      if (!accountId || !billingInterval || !cancelUrl || !planKey || !successUrl) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, billingInterval, cancelUrl, planKey, successUrl required' }, 400);
      }
      if (planKey === 'vlp_free') {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'Free plan does not require checkout' }, 400);
      }
      const priceId = getPriceId(planKey, billingInterval, env);
      if (!priceId) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'Invalid planKey or billingInterval' }, 400);
      }
      try {
        const membershipId = `MEM_${crypto.randomUUID()}`;
        const session = await stripePost('/checkout/sessions', {
          mode: 'subscription',
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: { account_id: accountId, membership_id: membershipId, plan_key: planKey, billing_interval: billingInterval },
        }, env);
        const checkoutSessionId = session.id;
        const now = new Date().toISOString();

        await r2Put(env.R2_VIRTUAL_LAUNCH, `memberships/${membershipId}.json`, {
          accountId, membershipId, planKey, billingInterval, checkoutSessionId, status: 'pending', createdAt: now,
        });
        await d1Run(env.DB,
          `INSERT OR REPLACE INTO memberships
           (membership_id, account_id, plan_key, billing_interval, status, created_at)
           VALUES (?, ?, ?, ?, 'pending', ?)`,
          [membershipId, accountId, planKey, billingInterval, now]
        );
        return json({ ok: true, checkoutSessionId, status: 'created' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/checkout/status',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const url = new URL(request.url);
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) return json({ ok: false, error: 'BAD_REQUEST', message: 'sessionId required' }, 400);
      try {
        const session = await stripeGet(`/checkout/sessions/${sessionId}`, env);
        return json({
          ok: true,
          status: session.status,
          paymentStatus: session.payment_status,
          customerEmail: session.customer_details?.email,
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502);
      }
    },
  },

  // -------------------------------------------------------------------------
  // WEBHOOKS
  // Stripe and Twilio retry on non-200 — always return 200 immediately.
  // -------------------------------------------------------------------------

  {
    method: 'POST', pattern: '/v1/webhooks/stripe',
    handler: async (_method, _pattern, _params, request, env) => {
      const rawBody = await request.text();
      const sigHeader = request.headers.get('Stripe-Signature') ?? '';

      // Parse t= and v1= from the Stripe-Signature header
      const parts = sigHeader.split(',');
      const tPart = parts.find(p => p.startsWith('t='));
      const v1Parts = parts.filter(p => p.startsWith('v1='));
      const timestamp = tPart?.slice(2);
      const signatures = v1Parts.map(p => p.slice(3));

      if (!timestamp || signatures.length === 0) {
        return json({ ok: false, error: 'INVALID_SIGNATURE' }, 400);
      }

      // Reject stale webhooks (> 300 seconds)
      if (Math.floor(Date.now() / 1000) - parseInt(timestamp) > 300) {
        return json({ ok: false, error: 'INVALID_SIGNATURE' }, 400);
      }

      // Verify HMAC-SHA256 signature
      try {
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey(
          'raw', enc.encode(env.STRIPE_WEBHOOK_SECRET),
          { name: 'HMAC', hash: 'SHA-256' },
          false, ['sign']
        );
        const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${rawBody}`));
        const expectedHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
        const isValid = signatures.some(s => s === expectedHex);
        if (!isValid) return json({ ok: false, error: 'INVALID_SIGNATURE' }, 400);
      } catch {
        return json({ ok: false, error: 'INVALID_SIGNATURE' }, 400);
      }

      // Parse event
      let event;
      try {
        event = JSON.parse(rawBody);
      } catch {
        return json({ ok: true, received: true }); // malformed but always 200
      }

      // Handle event — errors are logged, never returned to Stripe
      try {
        const obj = event.data?.object ?? {};
        const now = new Date().toISOString();

        switch (event.type) {

          case 'checkout.session.completed': {
            const { account_id, membership_id, plan_key, billing_interval } = obj.metadata ?? {};
            if (membership_id) {
              const existingMem = await env.R2_VIRTUAL_LAUNCH.get(`memberships/${membership_id}.json`);
              const memRecord = existingMem ? await existingMem.json() : {};
              memRecord.status = 'active';
              memRecord.stripeSubscriptionId = obj.subscription;
              memRecord.stripeCustomerId = obj.customer;
              memRecord.customerEmail = obj.customer_details?.email ?? null;
              memRecord.updatedAt = now;
              await r2Put(env.R2_VIRTUAL_LAUNCH, `memberships/${membership_id}.json`, memRecord);

              await d1Run(env.DB,
                'UPDATE memberships SET status = \'active\', updated_at = ? WHERE membership_id = ?',
                [now, membership_id]
              );

              // Only grant tokens when we have a real account_id (not a pending guest checkout).
              const isRealAccount = account_id && !String(account_id).startsWith('PENDING_');
              if (isRealAccount) {
                const tokenGrant = getTokenGrant(plan_key);
                await d1Run(env.DB,
                  'INSERT OR REPLACE INTO tokens (account_id, tax_game_tokens, transcript_tokens, updated_at) VALUES (?, ?, ?, ?)',
                  [account_id, tokenGrant.taxGameTokens, tokenGrant.transcriptTokens, now]
                );
                await r2Put(env.R2_VIRTUAL_LAUNCH, `tokens/${account_id}.json`, {
                  accountId: account_id, planKey: plan_key, billingInterval: billing_interval,
                  ...tokenGrant, updatedAt: now,
                });

                // Sync session membership so GET /v1/auth/session reflects the new plan immediately
                const tier = (plan_key ?? '').replace(/^vlp_/, '').replace(/_(?:monthly|yearly)$/, '') || 'free';
                await d1Run(env.DB,
                  'UPDATE sessions SET membership = ? WHERE account_id = ?',
                  [tier, account_id]
                );
              }
            }
            break;
          }

          case 'customer.subscription.updated': {
            const { membership_id } = obj.metadata ?? {};
            if (membership_id) {
              const existingMem = await env.R2_VIRTUAL_LAUNCH.get(`memberships/${membership_id}.json`);
              const memRecord = existingMem ? await existingMem.json() : {};
              memRecord.status = obj.status;
              memRecord.updatedAt = now;
              await r2Put(env.R2_VIRTUAL_LAUNCH, `memberships/${membership_id}.json`, memRecord);
              await d1Run(env.DB,
                'UPDATE memberships SET status = ?, updated_at = ? WHERE membership_id = ?',
                [obj.status, now, membership_id]
              );
            }
            break;
          }

          case 'customer.subscription.deleted': {
            const { membership_id } = obj.metadata ?? {};
            if (membership_id) {
              const existingMem = await env.R2_VIRTUAL_LAUNCH.get(`memberships/${membership_id}.json`);
              const memRecord = existingMem ? await existingMem.json() : {};
              memRecord.status = 'cancelled';
              memRecord.updatedAt = now;
              await r2Put(env.R2_VIRTUAL_LAUNCH, `memberships/${membership_id}.json`, memRecord);
              await d1Run(env.DB,
                'UPDATE memberships SET status = \'cancelled\', updated_at = ? WHERE membership_id = ?',
                [now, membership_id]
              );
            }
            break;
          }

          case 'invoice.paid': {
            const invoiceId = obj.id;
            // Look up accountId from D1 using stripe_customer_id
            const customerRow = await env.DB.prepare(
              'SELECT account_id FROM billing_customers WHERE stripe_customer_id = ?'
            ).bind(obj.customer).first();
            await r2Put(env.R2_VIRTUAL_LAUNCH, `billing_invoices/${invoiceId}.json`, {
              invoiceId,
              accountId: customerRow?.account_id ?? null,
              amount: obj.amount_paid,
              currency: obj.currency,
              status: 'paid',
              paidAt: now,
            });
            break;
          }

          case 'invoice.payment_failed': {
            const invoiceId = obj.id;
            await r2Put(env.R2_VIRTUAL_LAUNCH, `billing_invoices/${invoiceId}.json`, {
              invoiceId, status: 'payment_failed', failedAt: now,
            });
            if (obj.subscription) {
              await d1Run(env.DB,
                'UPDATE memberships SET status = \'past_due\', updated_at = ? WHERE stripe_subscription_id = ?',
                [now, obj.subscription]
              );
            }
            break;
          }

          case 'payment_intent.succeeded': {
            const piId = obj.id;
            await r2Put(env.R2_VIRTUAL_LAUNCH, `billing_payment_intents/${piId}.json`, {
              paymentIntentId: piId, amount: obj.amount, currency: obj.currency,
              status: 'succeeded', succeededAt: now,
            });
            break;
          }

          case 'payment_intent.payment_failed': {
            const piId = obj.id;
            await r2Put(env.R2_VIRTUAL_LAUNCH, `billing_payment_intents/${piId}.json`, {
              paymentIntentId: piId, status: 'failed', failedAt: now,
            });
            break;
          }

          default:
            // Unhandled event type — always return 200
            break;
        }
      } catch (e) {
        console.error(`[webhook] Error handling ${event?.type}: ${e.message}`);
      }

      return json({ ok: true, received: true });
    },
  },

  { method: 'POST', pattern: '/v1/webhooks/twilio', handler: () => json({ ok: true, received: true }) },

  {
    method: 'POST', pattern: '/v1/webhooks/cal',
    handler: async (_method, _pattern, _params, request, env) => {
      const rawBody = await request.text();
      const sigHeader = request.headers.get('X-Cal-Signature-256') ?? '';
      if (env.CAL_WEBHOOK_SECRET) {
        const valid = await verifyCalSignature(rawBody, sigHeader, env.CAL_WEBHOOK_SECRET);
        if (!valid) return json({ ok: false, error: 'INVALID_SIGNATURE' }, 401);
      }
      let payload;
      try { payload = JSON.parse(rawBody); } catch { return json({ ok: false, error: 'INVALID_JSON' }, 400); }

      const eventType = payload?.triggerEvent ?? payload?.type ?? '';
      const now = new Date().toISOString();
      try {
        switch (eventType) {
          case 'BOOKING_CREATED': {
            const uid = payload.payload?.uid;
            const startTime = payload.payload?.startTime;
            const bookingId = `BOOK_${(startTime ?? now).slice(0, 10).replace(/-/g, '')}_${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
            const attendeeEmail = payload.payload?.attendees?.[0]?.email ?? '';
            const accountRow = await env.DB.prepare('SELECT account_id FROM accounts WHERE email = ?').bind(attendeeEmail).first();
            const booking = {
              bookingId,
              accountId: accountRow?.account_id ?? null,
              professionalId: null,
              calBookingUid: uid,
              bookingType: payload.payload?.type ?? 'unknown',
              scheduledAt: startTime ?? now,
              timezone: payload.payload?.attendees?.[0]?.timeZone ?? 'UTC',
              status: 'confirmed',
              createdAt: now, updatedAt: now,
            };
            await r2Put(env.R2_VIRTUAL_LAUNCH, `bookings/cal_${uid}.json`, booking);
            if (accountRow?.account_id) {
              await d1Run(env.DB,
                `INSERT OR IGNORE INTO bookings (booking_id, account_id, professional_id, cal_booking_uid, booking_type, scheduled_at, timezone, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [bookingId, accountRow.account_id, null, uid, booking.bookingType, booking.scheduledAt, booking.timezone, 'confirmed', now, now]
              );
            }
            break;
          }

          case 'BOOKING_RESCHEDULED': {
            const uid = payload.payload?.uid;
            const newStart = payload.payload?.startTime;
            const obj = await env.R2_VIRTUAL_LAUNCH.get(`bookings/cal_${uid}.json`);
            if (obj) {
              const existing = await obj.json();
              const updated = { ...existing, scheduledAt: newStart ?? existing.scheduledAt, status: 'rescheduled', updatedAt: now };
              await r2Put(env.R2_VIRTUAL_LAUNCH, `bookings/cal_${uid}.json`, updated);
              await d1Run(env.DB,
                'UPDATE bookings SET scheduled_at = ?, status = ?, updated_at = ? WHERE cal_booking_uid = ?',
                [newStart ?? existing.scheduledAt, 'rescheduled', now, uid]
              );
            }
            break;
          }

          case 'BOOKING_CANCELLED': {
            const uid = payload.payload?.uid;
            const obj = await env.R2_VIRTUAL_LAUNCH.get(`bookings/cal_${uid}.json`);
            if (obj) {
              const existing = await obj.json();
              await r2Put(env.R2_VIRTUAL_LAUNCH, `bookings/cal_${uid}.json`, { ...existing, status: 'cancelled', updatedAt: now });
              await d1Run(env.DB, 'UPDATE bookings SET status = ?, updated_at = ? WHERE cal_booking_uid = ?', ['cancelled', now, uid]);
            }
            break;
          }

          case 'BOOKING_CONFIRMED': {
            const uid = payload.payload?.uid;
            const obj = await env.R2_VIRTUAL_LAUNCH.get(`bookings/cal_${uid}.json`);
            if (obj) {
              const existing = await obj.json();
              await r2Put(env.R2_VIRTUAL_LAUNCH, `bookings/cal_${uid}.json`, { ...existing, status: 'confirmed', updatedAt: now });
            }
            await d1Run(env.DB, 'UPDATE bookings SET status = ?, updated_at = ? WHERE cal_booking_uid = ?', ['confirmed', now, uid]);
            break;
          }

          case 'BOOKING_DECLINED': {
            const uid = payload.payload?.uid;
            const obj = await env.R2_VIRTUAL_LAUNCH.get(`bookings/cal_${uid}.json`);
            if (obj) {
              const existing = await obj.json();
              await r2Put(env.R2_VIRTUAL_LAUNCH, `bookings/cal_${uid}.json`, { ...existing, status: 'declined', updatedAt: now });
            }
            await d1Run(env.DB, 'UPDATE bookings SET status = ?, updated_at = ? WHERE cal_booking_uid = ?', ['declined', now, uid]);
            break;
          }

          case 'BOOKING_COMPLETED': {
            const uid = payload.payload?.uid;
            const obj = await env.R2_VIRTUAL_LAUNCH.get(`bookings/cal_${uid}.json`);
            if (obj) {
              const existing = await obj.json();
              await r2Put(env.R2_VIRTUAL_LAUNCH, `bookings/cal_${uid}.json`, { ...existing, status: 'completed', updatedAt: now });
            }
            await d1Run(env.DB, 'UPDATE bookings SET status = ?, updated_at = ? WHERE cal_booking_uid = ?', ['completed', now, uid]);
            break;
          }

          case 'MEETING_ENDED': {
            const uid = payload.payload?.uid;
            const obj = await env.R2_VIRTUAL_LAUNCH.get(`bookings/cal_${uid}.json`);
            if (obj) {
              const existing = await obj.json();
              await r2Put(env.R2_VIRTUAL_LAUNCH, `bookings/cal_${uid}.json`, { ...existing, status: 'completed', meetingEndedAt: now, updatedAt: now });
            }
            await d1Run(env.DB, 'UPDATE bookings SET status = ?, updated_at = ? WHERE cal_booking_uid = ?', ['completed', now, uid]);
            break;
          }

          case 'FORM_SUBMITTED': {
            const uid = payload.payload?.uid ?? crypto.randomUUID();
            await r2Put(env.R2_VIRTUAL_LAUNCH, `cal_forms/${uid}.json`, { ...payload.payload, receivedAt: now });
            break;
          }

          case 'RECORDING_READY': {
            const uid = payload.payload?.uid;
            const recordingUrl = payload.payload?.recordingUrl ?? payload.payload?.downloadLink;
            const obj = await env.R2_VIRTUAL_LAUNCH.get(`bookings/cal_${uid}.json`);
            if (obj) {
              const existing = await obj.json();
              await r2Put(env.R2_VIRTUAL_LAUNCH, `bookings/cal_${uid}.json`, { ...existing, recordingUrl, updatedAt: now });
            }
            break;
          }

          case 'PAYMENT_INITIATED': {
            const uid = payload.payload?.uid;
            const paymentId = payload.payload?.paymentId ?? crypto.randomUUID();
            await r2Put(env.R2_VIRTUAL_LAUNCH, `cal_payments/${paymentId}.json`, {
              paymentId, calBookingUid: uid,
              amount: payload.payload?.amount, currency: payload.payload?.currency,
              status: 'initiated', initiatedAt: now,
            });
            break;
          }

          case 'PAYMENT_CONFIRMED': {
            const uid = payload.payload?.uid;
            const paymentId = payload.payload?.paymentId;
            if (paymentId) {
              const obj = await env.R2_VIRTUAL_LAUNCH.get(`cal_payments/${paymentId}.json`);
              if (obj) {
                const existing = await obj.json();
                await r2Put(env.R2_VIRTUAL_LAUNCH, `cal_payments/${paymentId}.json`, { ...existing, status: 'confirmed', confirmedAt: now });
              }
            }
            await d1Run(env.DB, 'UPDATE bookings SET status = ?, updated_at = ? WHERE cal_booking_uid = ?', ['confirmed', now, uid]);
            break;
          }

          case 'PAYMENT_FAILED': {
            const uid = payload.payload?.uid;
            const paymentId = payload.payload?.paymentId;
            if (paymentId) {
              const obj = await env.R2_VIRTUAL_LAUNCH.get(`cal_payments/${paymentId}.json`);
              if (obj) {
                const existing = await obj.json();
                await r2Put(env.R2_VIRTUAL_LAUNCH, `cal_payments/${paymentId}.json`, { ...existing, status: 'failed', failedAt: now });
              }
            }
            await d1Run(env.DB, 'UPDATE bookings SET status = ?, updated_at = ? WHERE cal_booking_uid = ?', ['payment_failed', now, uid]);
            break;
          }

          default:
            // Unhandled event type — always return 200
            break;
        }
      } catch (e) {
        console.error(`[cal-webhook] Error handling ${eventType}: ${e.message}`);
      }
      return json({ ok: true, received: true });
    },
  },

  // ── Cal.com OAuth Flows ──────────────────────────────────────────────
  //
  // FLOW A — VLP user reads back their bookings with the VLP team
  //   App: Virtual Launch Pro App
  //   Client ID: 782133b560b9ee33174a7a765b8cd73343ffeb2ece517be73a3061f370e21eeb
  //   Redirect: https://api.virtuallaunch.pro/cal/app/oauth/callback
  //   PKCE: ON
  //   Tokens stored in: accounts.cal_access_token
  //   Entry point: GET /v1/cal/oauth/start
  //   Used on: Calendar page "Connect Your Cal.com Account" section
  //
  // FLOW B — Tax pro connects their own Cal.com (clients book them)
  //   App: Tax Monitor Pro Tax Professionals
  //   Client ID: 9d03bcaa8ee24644d21dc7af5c3c17722ffa314c9790f2c7c83a1f88032b8420
  //   Redirect: https://api.virtuallaunch.pro/v1/cal/oauth/callback
  //   Tokens stored in: cal_connections table
  //   Entry point: GET /v1/cal/pro/oauth/start
  //   Used on: Profile Setup step 5, Calendar page (secondary section)
  //
  // NOT IN THIS REPO:
  //   Taxpayer App (d6839d7...) — lives in taxmonitor.pro repo only
  // ────────────────────────────────────────────────────────────────────

  {
    // FLOW A start — Calendar page "Connect Your Cal.com Account"
    method: 'GET', pattern: '/v1/cal/oauth/start',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;
      const calClientId = env.CAL_VLP_OAUTH_CLIENT_ID ?? '782133b560b9ee33174a7a765b8cd73343ffeb2ece517be73a3061f370e21eeb';
      const redirectUri = env.CAL_VLP_REDIRECT_URI ?? 'https://api.virtuallaunch.pro/cal/app/oauth/callback';

      const { codeVerifier, codeChallenge } = await generatePKCE();
      const state = btoa(JSON.stringify({
        accountId: session.account_id,
        nonce: crypto.randomUUID(),
        flow: 'vlp',
      }));

      const now = new Date().toISOString();
      await d1Run(env.DB,
        'INSERT OR REPLACE INTO oauth_state (state_key, code_verifier, account_id, flow, created_at) VALUES (?, ?, ?, ?, ?)',
        [state, codeVerifier, session.account_id, 'vlp', now]
      );

      const url = new URL('https://app.cal.com/oauth2/authorize');
      url.searchParams.set('client_id', calClientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      return json({ ok: true, status: 'redirect_required', authorizationUrl: url.toString() });
    },
  },

  {
    // FLOW B start — Profile Setup step 5 (tax pro connects their own Cal.com)
    method: 'GET', pattern: '/v1/cal/pro/oauth/start',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const calClientId = env.CAL_PRO_OAUTH_CLIENT_ID ?? '9d03bcaa8ee24644d21dc7af5c3c17722ffa314c9790f2c7c83a1f88032b8420';
      // Registered redirect URI in Cal.com "Tax Monitor Pro Tax Professionals" app:
      // https://api.virtuallaunch.pro/v1/cal/oauth/callback
      // If this changes, update CAL_PRO_REDIRECT_URI env var.
      const redirectUri = env.CAL_PRO_REDIRECT_URI ?? 'https://api.virtuallaunch.pro/v1/cal/oauth/callback';
      const url = new URL('https://app.cal.com/oauth2/authorize');
      url.searchParams.set('client_id', calClientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      return json({ ok: true, status: 'redirect_required', authorizationUrl: url.toString() });
    },
  },

  {
    // FLOW B callback — tax pro's Cal.com connection
    // Registered redirect URI: https://api.virtuallaunch.pro/v1/cal/oauth/callback
    method: 'GET', pattern: '/v1/cal/oauth/callback',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return Response.redirect('https://virtuallaunch.pro/onboarding?cal=error&reason=session', 302);
      const result = await handleCalProOAuthCallback(request, env, session);
      if (!result.ok) {
        return Response.redirect(`https://virtuallaunch.pro/onboarding?cal=error&reason=${encodeURIComponent(result.error ?? 'unknown')}`, 302);
      }
      return Response.redirect('https://virtuallaunch.pro/onboarding?cal=connected', 302);
    },
  },

  {
    // FLOW A callback — VLP user reads back their bookings
    // Matches the redirect URI registered in the Cal.com VLP App OAuth settings:
    // https://api.virtuallaunch.pro/cal/app/oauth/callback (no /v1/ prefix)
    method: 'GET', pattern: '/cal/app/oauth/callback',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return Response.redirect('https://virtuallaunch.pro/calendar?cal=error&reason=session', 302);
      const result = await handleCalVlpOAuthCallback(request, env, session);
      if (!result.ok) {
        return Response.redirect(`https://virtuallaunch.pro/calendar?cal=error&reason=${encodeURIComponent(result.error ?? 'unknown')}`, 302);
      }
      return Response.redirect('https://virtuallaunch.pro/calendar?cal=connected', 302);
    },
  },

  {
    // Returns connection status for both Cal.com flows
    method: 'GET', pattern: '/v1/cal/status',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;
      try {
        const accountRow = await env.DB.prepare(
          'SELECT cal_access_token FROM accounts WHERE account_id = ?'
        ).bind(session.account_id).first();
        const vlpConnected = !!(accountRow && accountRow.cal_access_token);

        const proRow = await env.DB.prepare(
          'SELECT connection_id FROM cal_connections WHERE account_id = ? AND cal_app = ? LIMIT 1'
        ).bind(session.account_id, 'cal_pro').first();
        const proConnected = !!proRow;

        return json({ ok: true, vlpConnected, proConnected });
      } catch {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to check Cal.com status' }, 500);
      }
    },
  },

  // -------------------------------------------------------------------------
  // BOOKINGS
  // -------------------------------------------------------------------------

  {
    method: 'POST', pattern: '/v1/bookings',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      const { professionalId, bookingType, scheduledAt, timezone } = body ?? {};
      if (!professionalId || !bookingType || !scheduledAt || !timezone) {
        return json({ ok: false, error: 'MISSING_FIELDS', message: 'professionalId, bookingType, scheduledAt, timezone required' }, 400);
      }
      const connectionId = `cal_${professionalId}`;
      const connObj = await env.R2_VIRTUAL_LAUNCH.get(`cal_connections/${connectionId}.json`);
      if (!connObj) return json({ ok: false, error: 'PROFESSIONAL_NOT_CONNECTED', message: 'Professional not connected to Cal.com' }, 422);
      const connection = await connObj.json();

      const now = new Date().toISOString();
      const bookingId = `BOOK_${scheduledAt.slice(0, 10).replace(/-/g, '')}_${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      let calBookingUid = null;
      try {
        const calResult = await calPost('/bookings', {
          eventTypeId: body.eventTypeId,
          start: scheduledAt,
          timeZone: timezone,
          attendee: { name: session.email, email: session.email, timeZone: timezone },
          metadata: { vlp_booking_id: bookingId, account_id: session.account_id },
        }, connection.accessToken);
        calBookingUid = calResult?.uid ?? null;
      } catch (_calErr) {
        // Cal.com call failed — store booking without UID, webhook will reconcile
      }

      const booking = {
        bookingId, accountId: session.account_id, professionalId,
        calBookingUid, bookingType, scheduledAt, timezone,
        status: 'pending', createdAt: now, updatedAt: now,
      };
      await r2Put(env.R2_VIRTUAL_LAUNCH, `bookings/${bookingId}.json`, booking);
      await d1Run(env.DB,
        `INSERT INTO bookings (booking_id, account_id, professional_id, cal_booking_uid, booking_type, scheduled_at, timezone, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [bookingId, session.account_id, professionalId, calBookingUid, bookingType, scheduledAt, timezone, 'pending', now, now]
      );
      return json({ ok: true, booking }, 201);
    },
  },

  {
    method: 'GET', pattern: '/v1/bookings/by-account/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const rows = await env.DB.prepare(
        'SELECT * FROM bookings WHERE account_id = ? ORDER BY scheduled_at DESC'
      ).bind(params.account_id).all();
      return json({ ok: true, bookings: rows.results ?? [] });
    },
  },

  {
    method: 'GET', pattern: '/v1/bookings/by-professional/:professional_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const rows = await env.DB.prepare(
        'SELECT * FROM bookings WHERE professional_id = ? ORDER BY scheduled_at DESC'
      ).bind(params.professional_id).all();
      return json({ ok: true, bookings: rows.results ?? [] });
    },
  },

  {
    method: 'GET', pattern: '/v1/bookings/:booking_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const obj = await env.R2_VIRTUAL_LAUNCH.get(`bookings/${params.booking_id}.json`);
      if (!obj) return json({ ok: false, error: 'NOT_FOUND', message: 'Booking not found' }, 404);
      return json({ ok: true, booking: await obj.json() });
    },
  },

  {
    method: 'PATCH', pattern: '/v1/bookings/:booking_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      const obj = await env.R2_VIRTUAL_LAUNCH.get(`bookings/${params.booking_id}.json`);
      if (!obj) return json({ ok: false, error: 'NOT_FOUND', message: 'Booking not found' }, 404);
      const existing = await obj.json();
      const now = new Date().toISOString();
      const updated = { ...existing, updatedAt: now };
      const setClauses = ['updated_at = ?'];
      const vals = [now];
      if (body?.status)      { updated.status = body.status;           setClauses.unshift('status = ?');       vals.unshift(body.status); }
      if (body?.scheduledAt) { updated.scheduledAt = body.scheduledAt; setClauses.unshift('scheduled_at = ?'); vals.unshift(body.scheduledAt); }
      if (body?.timezone)    { updated.timezone = body.timezone;       setClauses.unshift('timezone = ?');     vals.unshift(body.timezone); }
      if (body?.bookingType) { updated.bookingType = body.bookingType; setClauses.unshift('booking_type = ?'); vals.unshift(body.bookingType); }
      await r2Put(env.R2_VIRTUAL_LAUNCH, `bookings/${params.booking_id}.json`, updated);
      await d1Run(env.DB, `UPDATE bookings SET ${setClauses.join(', ')} WHERE booking_id = ?`, [...vals, params.booking_id]);
      return json({ ok: true, booking: updated });
    },
  },

  // -------------------------------------------------------------------------
  // PROFILES
  // -------------------------------------------------------------------------

  {
    method: 'POST', pattern: '/v1/profiles',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      const { professionalId, displayName } = body ?? {};
      if (!professionalId || !displayName) {
        return json({ ok: false, error: 'MISSING_FIELDS', message: 'professionalId and displayName required' }, 400);
      }
      const now = new Date().toISOString();
      const profile = {
        professionalId, accountId: session.account_id,
        displayName, title: body.title ?? null, bio: body.bio ?? null,
        specialties: body.specialties ?? null, availability: body.availability ?? 'available',
        createdAt: now, updatedAt: now,
      };
      await r2Put(env.R2_VIRTUAL_LAUNCH, `profiles/${professionalId}.json`, profile);
      await d1Run(env.DB,
        `INSERT INTO profiles (professional_id, account_id, display_name, title, bio, specialties, availability, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [professionalId, session.account_id, displayName, profile.title, profile.bio, profile.specialties, profile.availability, now, now]
      );
      return json({ ok: true, profile }, 201);
    },
  },

  {
    method: 'GET', pattern: '/v1/profiles/public/:professional_id',
    handler: async (_method, _pattern, params, _request, env) => {
      const obj = await env.R2_VIRTUAL_LAUNCH.get(`profiles/${params.professional_id}.json`);
      if (!obj) return json({ ok: false, error: 'NOT_FOUND', message: 'Profile not found' }, 404);
      const { accountId: _accountId, ...publicProfile } = await obj.json();
      return json({ ok: true, profile: publicProfile });
    },
  },

  {
    method: 'GET', pattern: '/v1/profiles/:professional_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const obj = await env.R2_VIRTUAL_LAUNCH.get(`profiles/${params.professional_id}.json`);
      if (!obj) return json({ ok: false, error: 'NOT_FOUND', message: 'Profile not found' }, 404);
      return json({ ok: true, profile: await obj.json() });
    },
  },

  {
    method: 'PATCH', pattern: '/v1/profiles/:professional_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      const obj = await env.R2_VIRTUAL_LAUNCH.get(`profiles/${params.professional_id}.json`);
      if (!obj) return json({ ok: false, error: 'NOT_FOUND', message: 'Profile not found' }, 404);
      const existing = await obj.json();
      const now = new Date().toISOString();
      const updated = { ...existing, updatedAt: now };
      const setClauses = ['updated_at = ?'];
      const vals = [now];
      if (body?.displayName)  { updated.displayName = body.displayName;   setClauses.unshift('display_name = ?');  vals.unshift(body.displayName); }
      if (body?.title)        { updated.title = body.title;               setClauses.unshift('title = ?');         vals.unshift(body.title); }
      if (body?.bio)          { updated.bio = body.bio;                   setClauses.unshift('bio = ?');           vals.unshift(body.bio); }
      if (body?.specialties)  { updated.specialties = body.specialties;   setClauses.unshift('specialties = ?');   vals.unshift(body.specialties); }
      if (body?.availability) { updated.availability = body.availability; setClauses.unshift('availability = ?');  vals.unshift(body.availability); }
      await r2Put(env.R2_VIRTUAL_LAUNCH, `profiles/${params.professional_id}.json`, updated);
      await d1Run(env.DB, `UPDATE profiles SET ${setClauses.join(', ')} WHERE professional_id = ?`, [...vals, params.professional_id]);
      return json({ ok: true, profile: updated });
    },
  },

  // -------------------------------------------------------------------------
  // SUPPORT TICKETS
  // -------------------------------------------------------------------------

  {
    method: 'POST', pattern: '/v1/support/tickets',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401);
      try {
        const body = await parseBody(request);
        const { accountId, message, priority, subject, ticketId } = body ?? {};
        if (!accountId || !message || !priority || !subject || !ticketId) {
          return json({ ok: false, error: 'MISSING_FIELDS', message: 'accountId, message, priority, subject, ticketId are required' }, 400);
        }
        const validPriorities = ['high', 'low', 'normal', 'urgent'];
        if (!validPriorities.includes(priority)) {
          return json({ ok: false, error: 'VALIDATION', message: `priority must be one of: ${validPriorities.join(', ')}` }, 400);
        }
        if (subject.length > 255) return json({ ok: false, error: 'VALIDATION', message: 'subject max 255 chars' }, 400);
        if (message.length > 5000) return json({ ok: false, error: 'VALIDATION', message: 'message max 5000 chars' }, 400);
        const now = new Date().toISOString();
        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/support/${ticketId}.json`, {
          ticketId, accountId, subject, priority, event: 'SUPPORT_TICKET_CREATED', created_at: now,
        });
        await r2Put(env.R2_VIRTUAL_LAUNCH, `support_tickets/${ticketId}.json`, {
          ticketId, accountId, subject, message, priority, status: 'open', createdAt: now,
        });
        await d1Run(env.DB,
          `INSERT INTO support_tickets (ticket_id, account_id, subject, message, priority, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)`,
          [ticketId, accountId, subject, message, priority, now]
        );
        return json({ ok: true, ticketId, status: 'created' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Support ticket creation failed' }, 500);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/support/tickets/by-account/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401);
      try {
        const rows = await env.DB.prepare(
          `SELECT * FROM support_tickets WHERE account_id = ? ORDER BY created_at DESC`
        ).bind(params.account_id).all();
        return json({ ok: true, tickets: rows.results });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch tickets' }, 500);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/support/tickets/:ticket_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401);
      try {
        const row = await env.DB.prepare(
          `SELECT * FROM support_tickets WHERE ticket_id = ?`
        ).bind(params.ticket_id).first();
        if (!row) return json({ ok: false, error: 'NOT_FOUND', message: 'Ticket not found' }, 404);
        return json({ ok: true, ticket: row });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch ticket' }, 500);
      }
    },
  },

  {
    method: 'PATCH', pattern: '/v1/support/tickets/:ticket_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401);
      try {
        const body = await parseBody(request);
        const now = new Date().toISOString();
        const setClauses = ['updated_at = ?'];
        const vals = [now];
        const validStatuses = ['closed', 'in_progress', 'open', 'reopened', 'resolved'];
        if (body?.message !== undefined) { setClauses.push('message = ?'); vals.push(body.message); }
        if (body?.status !== undefined) {
          if (!validStatuses.includes(body.status)) return json({ ok: false, error: 'VALIDATION', message: `status must be one of: ${validStatuses.join(', ')}` }, 400);
          setClauses.push('status = ?'); vals.push(body.status);
        }
        await d1Run(env.DB,
          `UPDATE support_tickets SET ${setClauses.join(', ')} WHERE ticket_id = ?`,
          [...vals, params.ticket_id]
        );
        const existing = await env.R2_VIRTUAL_LAUNCH.get(`support_tickets/${params.ticket_id}.json`);
        const current = existing ? await existing.json().catch(() => ({})) : {};
        const updated = { ...current, updatedAt: now };
        if (body?.message !== undefined) updated.message = body.message;
        if (body?.status !== undefined) updated.status = body.status;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `support_tickets/${params.ticket_id}.json`, updated);
        return json({ ok: true, ticketId: params.ticket_id, status: 'updated' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Ticket update failed' }, 500);
      }
    },
  },

  // -------------------------------------------------------------------------
  // NOTIFICATIONS
  // -------------------------------------------------------------------------

  {
    method: 'POST', pattern: '/v1/notifications/in-app',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401);
      try {
        const body = await parseBody(request);
        const { accountId, message, notificationId, severity, title } = body ?? {};
        if (!accountId || !message || !notificationId || !severity || !title) {
          return json({ ok: false, error: 'MISSING_FIELDS', message: 'accountId, message, notificationId, severity, title are required' }, 400);
        }
        const validSeverities = ['error', 'info', 'success', 'warning'];
        if (!validSeverities.includes(severity)) {
          return json({ ok: false, error: 'VALIDATION', message: `severity must be one of: ${validSeverities.join(', ')}` }, 400);
        }
        const now = new Date().toISOString();
        await r2Put(env.R2_VIRTUAL_LAUNCH, `notifications/in-app/${notificationId}.json`, {
          notificationId, accountId, title, message, severity, read: false, createdAt: now,
        });
        await d1Run(env.DB,
          `INSERT INTO notifications (notification_id, account_id, title, message, severity, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`,
          [notificationId, accountId, title, message, severity, now]
        );
        return json({ ok: true, notificationId, status: 'created' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Notification creation failed' }, 500);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/notifications/in-app',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401);
      try {
        const url = new URL(request.url);
        const accountId = url.searchParams.get('accountId');
        if (!accountId) return json({ ok: false, error: 'MISSING_FIELDS', message: 'accountId query param is required' }, 400);
        const limitParam = parseInt(url.searchParams.get('limit') ?? '20', 10);
        const limit = Math.min(isNaN(limitParam) ? 20 : limitParam, 100);
        const rows = await env.DB.prepare(
          `SELECT * FROM notifications WHERE account_id = ? ORDER BY created_at DESC LIMIT ?`
        ).bind(accountId, limit).all();
        return json({ ok: true, notifications: rows.results });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch notifications' }, 500);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/notifications/preferences/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401);
      try {
        const row = await env.DB.prepare(
          `SELECT * FROM vlp_preferences WHERE account_id = ?`
        ).bind(params.account_id).first();
        if (!row) {
          return json({ ok: true, preferences: { accountId: params.account_id, inAppEnabled: true, smsEnabled: false } });
        }
        return json({ ok: true, preferences: {
          accountId: params.account_id,
          inAppEnabled: row.in_app_enabled === 1,
          smsEnabled: row.sms_enabled === 1,
        }});
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch notification preferences' }, 500);
      }
    },
  },

  {
    method: 'PATCH', pattern: '/v1/notifications/preferences/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401);
      try {
        const body = await parseBody(request);
        const now = new Date().toISOString();
        const existing = await env.DB.prepare(
          `SELECT * FROM vlp_preferences WHERE account_id = ?`
        ).bind(params.account_id).first();
        const inAppEnabled = body?.inAppEnabled !== undefined ? (body.inAppEnabled ? 1 : 0) : (existing?.in_app_enabled ?? 1);
        const smsEnabled = body?.smsEnabled !== undefined ? (body.smsEnabled ? 1 : 0) : (existing?.sms_enabled ?? 0);
        await d1Run(env.DB,
          `INSERT OR REPLACE INTO vlp_preferences (account_id, in_app_enabled, sms_enabled, updated_at) VALUES (?, ?, ?, ?)`,
          [params.account_id, inAppEnabled, smsEnabled, now]
        );
        const existingR2 = await env.R2_VIRTUAL_LAUNCH.get(`vlp_preferences/${params.account_id}.json`);
        const current = existingR2 ? await existingR2.json().catch(() => ({})) : {};
        await r2Put(env.R2_VIRTUAL_LAUNCH, `vlp_preferences/${params.account_id}.json`, {
          ...current, inAppEnabled: inAppEnabled === 1, smsEnabled: smsEnabled === 1, updatedAt: now,
        });
        return json({ ok: true, accountId: params.account_id, status: 'updated' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Notification preferences update failed' }, 500);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/notifications/sms/send',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401);
      try {
        const body = await parseBody(request);
        const { accountId, message, phone } = body ?? {};
        if (!accountId || !message || !phone) {
          return json({ ok: false, error: 'MISSING_FIELDS', message: 'accountId, message, phone are required' }, 400);
        }
        if (phone.length < 7) return json({ ok: false, error: 'VALIDATION', message: 'phone min 7 chars' }, 400);
        if (message.length > 1600) return json({ ok: false, error: 'VALIDATION', message: 'message max 1600 chars' }, 400);
        const prefs = await env.DB.prepare(
          `SELECT sms_enabled FROM vlp_preferences WHERE account_id = ?`
        ).bind(accountId).first();
        if (!prefs || prefs.sms_enabled === 0) {
          return json({ ok: false, error: 'SMS_DISABLED', message: 'SMS notifications are disabled for this account' }, 400);
        }
        const now = new Date().toISOString();
        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/notifications/sms_${accountId}_${now}.json`, {
          accountId, phone, message, event: 'SMS_NOTIFICATION_QUEUED', created_at: now,
        });
        const existingR2 = await env.R2_VIRTUAL_LAUNCH.get(`vlp_preferences/${accountId}.json`);
        const current = existingR2 ? await existingR2.json().catch(() => ({})) : {};
        await r2Put(env.R2_VIRTUAL_LAUNCH, `vlp_preferences/${accountId}.json`, {
          ...current, lastSmsQueued: now,
        });
        // Wire Twilio send here when TWILIO_ACCOUNT_SID secret is configured
        return json({ ok: true, accountId, status: 'queued' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'SMS queue failed' }, 500);
      }
    },
  },

  // -------------------------------------------------------------------------
  // TOKENS
  // -------------------------------------------------------------------------

  {
    method: 'GET', pattern: '/v1/tokens/balance/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401);
      try {
        const row = await env.DB.prepare(
          `SELECT * FROM tokens WHERE account_id = ?`
        ).bind(params.account_id).first();
        if (!row) {
          return json({ ok: true, balance: { accountId: params.account_id, taxGameTokens: 0, transcriptTokens: 0, updatedAt: null } });
        }
        return json({ ok: true, balance: {
          accountId: params.account_id,
          taxGameTokens: row.tax_game_tokens,
          transcriptTokens: row.transcript_tokens,
          updatedAt: row.updated_at,
        }});
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch token balance' }, 500);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/tokens/usage/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401);
      try {
        const url = new URL(request.url);
        const limitParam = parseInt(url.searchParams.get('limit') ?? '50', 10);
        const limit = Math.min(isNaN(limitParam) ? 50 : limitParam, 100);
        const tokenEvents = new Set(['TOKENS_PURCHASED', 'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_UPDATED']);
        const listResult = await env.R2_VIRTUAL_LAUNCH.list({ prefix: 'receipts/billing/' });
        const results = await Promise.all(
          listResult.objects.slice(0, 50).map(async (obj) => {
            try {
              const item = await env.R2_VIRTUAL_LAUNCH.get(obj.key);
              if (!item) return null;
              const data = await item.json();
              return data.accountId === params.account_id && tokenEvents.has(data.event) ? data : null;
            } catch { return null; }
          })
        );
        const usage = results
          .filter(Boolean)
          .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
          .slice(0, limit);
        return json({ ok: true, usage });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch token usage' }, 500);
      }
    },
  },

  // -------------------------------------------------------------------------
  // VLP PREFERENCES
  // -------------------------------------------------------------------------

  {
    method: 'GET', pattern: '/v1/vlp/preferences/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401);
      try {
        const row = await env.DB.prepare(
          `SELECT * FROM vlp_preferences WHERE account_id = ?`
        ).bind(params.account_id).first();
        if (!row) {
          return json({ ok: true, preferences: {
            accountId: params.account_id, appearance: 'system', timezone: null,
            defaultDashboard: null, accentColor: null, inAppEnabled: true, smsEnabled: false,
          }, accountId: params.account_id });
        }
        return json({ ok: true, preferences: {
          accountId: params.account_id,
          appearance: row.appearance,
          timezone: row.timezone ?? null,
          defaultDashboard: row.default_dashboard ?? null,
          accentColor: row.accent_color ?? null,
          inAppEnabled: row.in_app_enabled === 1,
          smsEnabled: row.sms_enabled === 1,
        }, accountId: params.account_id });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch VLP preferences' }, 500);
      }
    },
  },

  {
    method: 'PATCH', pattern: '/v1/vlp/preferences/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401);
      try {
        const body = await parseBody(request);
        const now = new Date().toISOString();
        const validAppearances = ['dark', 'light', 'system'];
        if (body?.appearance !== undefined && !validAppearances.includes(body.appearance)) {
          return json({ ok: false, error: 'VALIDATION', message: `appearance must be one of: ${validAppearances.join(', ')}` }, 400);
        }
        const existing = await env.DB.prepare(
          `SELECT * FROM vlp_preferences WHERE account_id = ?`
        ).bind(params.account_id).first();
        const merged = {
          appearance: body?.appearance ?? existing?.appearance ?? 'system',
          timezone: body?.timezone ?? existing?.timezone ?? null,
          defaultDashboard: body?.defaultDashboard ?? existing?.default_dashboard ?? null,
          accentColor: body?.accentColor ?? existing?.accent_color ?? null,
          inAppEnabled: existing?.in_app_enabled ?? 1,
          smsEnabled: existing?.sms_enabled ?? 0,
        };
        await d1Run(env.DB,
          `INSERT OR REPLACE INTO vlp_preferences (account_id, appearance, timezone, default_dashboard, accent_color, in_app_enabled, sms_enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [params.account_id, merged.appearance, merged.timezone, merged.defaultDashboard, merged.accentColor, merged.inAppEnabled, merged.smsEnabled, now]
        );
        const existingR2 = await env.R2_VIRTUAL_LAUNCH.get(`vlp_preferences/${params.account_id}.json`);
        const currentR2 = existingR2 ? await existingR2.json().catch(() => ({})) : {};
        await r2Put(env.R2_VIRTUAL_LAUNCH, `vlp_preferences/${params.account_id}.json`, {
          ...currentR2, ...merged, inAppEnabled: merged.inAppEnabled === 1, smsEnabled: merged.smsEnabled === 1, updatedAt: now,
        });
        return json({ ok: true, accountId: params.account_id, status: 'updated' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'VLP preferences update failed' }, 500);
      }
    },
  },

  // -------------------------------------------------------------------------
  // INQUIRIES
  // -------------------------------------------------------------------------

  {
    method: 'POST', pattern: '/v1/inquiries',
    handler: async (_method, _pattern, _params, request, env) => {
      try {
        const body = await parseBody(request);
        const { inquiryId, firstName, lastName, email, phone } = body ?? {};
        if (!inquiryId || !firstName || !lastName || !email || !phone) {
          return json({ ok: false, error: 'MISSING_FIELDS', message: 'inquiryId, firstName, lastName, email, phone are required' }, 400);
        }
        const now = new Date().toISOString();
        const businessTypes = body.businessTypes ?? [];
        const servicesNeeded = body.servicesNeeded ?? [];
        // 1. R2 receipt
        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/inquiries/${inquiryId}.json`, {
          inquiryId, email, event: 'INQUIRY_CREATED', created_at: now,
        });
        // 2. R2 canonical
        await r2Put(env.R2_VIRTUAL_LAUNCH, `inquiries/${inquiryId}.json`, {
          inquiryId, firstName, lastName, email, phone,
          businessTypes,
          irsNoticeReceived: body.irsNoticeReceived ?? '',
          irsNoticeType: body.irsNoticeType ?? '',
          irsNoticeDate: body.irsNoticeDate ?? '',
          budgetPreference: body.budgetPreference ?? '',
          taxYearsAffected: body.taxYearsAffected ?? '',
          servicesNeeded,
          preferredState: body.preferredState ?? '',
          preferredCity: body.preferredCity ?? '',
          priorAuditExperience: body.priorAuditExperience ? 1 : 0,
          membershipInterest: body.membershipInterest ?? '',
          status: 'new',
          createdAt: now,
        });
        // 3. D1
        await d1Run(env.DB,
          `INSERT INTO inquiries (
            inquiry_id, first_name, last_name, email, phone,
            business_types, irs_notice_received, irs_notice_type, irs_notice_date,
            budget_preference, tax_years_affected, services_needed,
            preferred_state, preferred_city, prior_audit_experience,
            membership_interest, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
          [
            inquiryId, firstName, lastName, email, phone,
            JSON.stringify(businessTypes),
            body.irsNoticeReceived ?? '',
            body.irsNoticeType ?? '',
            body.irsNoticeDate ?? '',
            body.budgetPreference ?? '',
            body.taxYearsAffected ?? '',
            JSON.stringify(servicesNeeded),
            body.preferredState ?? '',
            body.preferredCity ?? '',
            body.priorAuditExperience ? 1 : 0,
            body.membershipInterest ?? '',
            now,
          ]
        );
        return json({ ok: true, inquiryId, status: 'created' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Inquiry creation failed' }, 500);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/inquiries',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      try {
        const url = new URL(request.url);
        const status = url.searchParams.get('status');
        const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
        const validStatuses = ['new', 'responded', 'archived'];
        let rows;
        if (status && validStatuses.includes(status)) {
          rows = await env.DB.prepare(
            `SELECT * FROM inquiries WHERE status = ? ORDER BY created_at DESC LIMIT ?`
          ).bind(status, limit).all();
        } else {
          rows = await env.DB.prepare(
            `SELECT * FROM inquiries ORDER BY created_at DESC LIMIT ?`
          ).bind(limit).all();
        }
        const inquiries = (rows.results ?? []).map((row) => ({
          ...row,
          business_types: (() => { try { return JSON.parse(row.business_types ?? '[]'); } catch { return []; } })(),
          services_needed: (() => { try { return JSON.parse(row.services_needed ?? '[]'); } catch { return []; } })(),
        }));
        return json({ ok: true, inquiries });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch inquiries' }, 500);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/inquiries/:inquiry_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      try {
        const obj = await env.R2_VIRTUAL_LAUNCH.get(`inquiries/${params.inquiry_id}.json`);
        if (!obj) return json({ ok: false, error: 'NOT_FOUND', message: 'Inquiry not found' }, 404);
        const inquiry = await obj.json();
        return json({ ok: true, inquiry });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch inquiry' }, 500);
      }
    },
  },

  {
    method: 'PATCH', pattern: '/v1/inquiries/:inquiry_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      try {
        const body = await parseBody(request);
        const now = new Date().toISOString();
        const validStatuses = ['new', 'responded', 'archived'];
        const setClauses = ['updated_at = ?'];
        const vals = [now];
        if (body?.status !== undefined) {
          if (!validStatuses.includes(body.status)) {
            return json({ ok: false, error: 'VALIDATION', message: `status must be one of: ${validStatuses.join(', ')}` }, 400);
          }
          setClauses.push('status = ?');
          vals.push(body.status);
        }
        if (body?.responseMessage !== undefined) {
          setClauses.push('response_message = ?');
          vals.push(body.responseMessage);
        }
        if (body?.assignedProfessionalId !== undefined) {
          setClauses.push('assigned_professional_id = ?');
          vals.push(body.assignedProfessionalId);
        }
        await d1Run(env.DB,
          `UPDATE inquiries SET ${setClauses.join(', ')} WHERE inquiry_id = ?`,
          [...vals, params.inquiry_id]
        );
        const existing = await env.R2_VIRTUAL_LAUNCH.get(`inquiries/${params.inquiry_id}.json`);
        const current = existing ? await existing.json().catch(() => ({})) : {};
        const updated = { ...current, updatedAt: now };
        if (body?.status !== undefined) updated.status = body.status;
        if (body?.responseMessage !== undefined) updated.responseMessage = body.responseMessage;
        if (body?.assignedProfessionalId !== undefined) updated.assignedProfessionalId = body.assignedProfessionalId;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `inquiries/${params.inquiry_id}.json`, updated);
        return json({ ok: true, inquiryId: params.inquiry_id, status: 'updated' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Inquiry update failed' }, 500);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/inquiries/:inquiry_id/respond',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      try {
        const body = await parseBody(request);
        const { message, professionalName } = body ?? {};
        if (!message || !message.trim()) {
          return json({ ok: false, error: 'MISSING_FIELDS', message: 'message is required' }, 400);
        }
        const now = new Date().toISOString();
        await d1Run(env.DB,
          `UPDATE inquiries SET response_message = ?, status = 'responded', updated_at = ? WHERE inquiry_id = ?`,
          [message, now, params.inquiry_id]
        );
        const existing = await env.R2_VIRTUAL_LAUNCH.get(`inquiries/${params.inquiry_id}.json`);
        const current = existing ? await existing.json().catch(() => ({})) : {};
        await r2Put(env.R2_VIRTUAL_LAUNCH, `inquiries/${params.inquiry_id}.json`, {
          ...current,
          status: 'responded',
          responseMessage: message,
          respondedAt: now,
          respondedBy: professionalName ?? '',
          updatedAt: now,
        });
        // Wire Twilio/email notification here when ready
        return json({ ok: true, inquiryId: params.inquiry_id, status: 'responded' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Respond to inquiry failed' }, 500);
      }
    },
  },

  // -------------------------------------------------------------------------
  // GOOGLE CALENDAR
  // Required env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
  // Set these in the Cloudflare Worker environment variables dashboard.
  // GOOGLE_REDIRECT_URI should be: https://api.virtuallaunch.pro/v1/google/oauth/callback
  // Create OAuth credentials at: https://console.cloud.google.com/apis/credentials
  // Enable: Google Calendar API at https://console.cloud.google.com/apis/library
  // -------------------------------------------------------------------------

  {
    method: 'GET', pattern: '/v1/google/oauth/start',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;
      const redirectUri = env.GOOGLE_REDIRECT_URI ?? 'https://api.virtuallaunch.pro/v1/google/oauth/callback';
      const state = btoa(JSON.stringify({ accountId: session.account_id, nonce: crypto.randomUUID() }));
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.readonly');
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
      url.searchParams.set('state', state);
      return json({ ok: true, authorizationUrl: url.toString() });
    },
  },

  {
    method: 'GET', pattern: '/v1/google/oauth/callback',
    handler: async (_method, _pattern, _params, request, env) => {
      const url = new URL(request.url);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const oauthError = url.searchParams.get('error');
      if (oauthError) {
        return Response.redirect(`https://virtuallaunch.pro/calendar?google=error&reason=${encodeURIComponent(oauthError)}`, 302);
      }
      if (!code || !state) {
        return Response.redirect('https://virtuallaunch.pro/calendar?google=error&reason=missing_params', 302);
      }
      let accountId;
      try {
        accountId = JSON.parse(atob(state)).accountId;
      } catch {
        return Response.redirect('https://virtuallaunch.pro/calendar?google=error&reason=invalid_state', 302);
      }
      const redirectUri = env.GOOGLE_REDIRECT_URI ?? 'https://api.virtuallaunch.pro/v1/google/oauth/callback';
      try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        });
        if (!tokenRes.ok) {
          return Response.redirect('https://virtuallaunch.pro/calendar?google=error&reason=token_exchange_failed', 302);
        }
        const tokenData = await tokenRes.json();
        const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString();
        await d1Run(env.DB,
          `UPDATE accounts SET
             google_access_token = ?,
             google_refresh_token = ?,
             google_token_expiry = ?
           WHERE account_id = ?`,
          [tokenData.access_token, tokenData.refresh_token ?? null, expiresAt, accountId]
        );
        return Response.redirect('https://virtuallaunch.pro/calendar?google=connected', 302);
      } catch {
        return Response.redirect('https://virtuallaunch.pro/calendar?google=error&reason=internal_error', 302);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/google/status',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;
      try {
        const row = await env.DB.prepare(
          'SELECT google_access_token FROM accounts WHERE account_id = ?'
        ).bind(session.account_id).first();
        const connected = !!(row && row.google_access_token);
        return json({ ok: true, connected });
      } catch {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to check Google status' }, 500);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/google/events',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;
      try {
        const row = await env.DB.prepare(
          'SELECT google_access_token, google_refresh_token, google_token_expiry FROM accounts WHERE account_id = ?'
        ).bind(session.account_id).first();
        if (!row || !row.google_access_token) {
          return json({ ok: false, error: 'NOT_CONNECTED', message: 'Google Calendar not connected' }, 400);
        }

        let accessToken = row.google_access_token;

        // Refresh if expired or expiring within 60s
        const expiry = row.google_token_expiry ? new Date(row.google_token_expiry).getTime() : 0;
        if (Date.now() + 60000 > expiry && row.google_refresh_token) {
          const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              refresh_token: row.google_refresh_token,
              client_id: env.GOOGLE_CLIENT_ID,
              client_secret: env.GOOGLE_CLIENT_SECRET,
              grant_type: 'refresh_token',
            }),
          });
          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            accessToken = refreshData.access_token;
            const newExpiry = new Date(Date.now() + (refreshData.expires_in ?? 3600) * 1000).toISOString();
            await d1Run(env.DB,
              'UPDATE accounts SET google_access_token = ?, google_token_expiry = ? WHERE account_id = ?',
              [accessToken, newExpiry, session.account_id]
            );
          }
        }

        const now = new Date();
        const timeMin = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
        const timeMax = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59).toISOString();

        const calUrl = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
        calUrl.searchParams.set('timeMin', timeMin);
        calUrl.searchParams.set('timeMax', timeMax);
        calUrl.searchParams.set('singleEvents', 'true');
        calUrl.searchParams.set('orderBy', 'startTime');
        calUrl.searchParams.set('maxResults', '100');

        let calRes = await fetch(calUrl.toString(), {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });

        // If 401, try one more refresh
        if (calRes.status === 401 && row.google_refresh_token) {
          const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              refresh_token: row.google_refresh_token,
              client_id: env.GOOGLE_CLIENT_ID,
              client_secret: env.GOOGLE_CLIENT_SECRET,
              grant_type: 'refresh_token',
            }),
          });
          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            accessToken = refreshData.access_token;
            const newExpiry = new Date(Date.now() + (refreshData.expires_in ?? 3600) * 1000).toISOString();
            await d1Run(env.DB,
              'UPDATE accounts SET google_access_token = ?, google_token_expiry = ? WHERE account_id = ?',
              [accessToken, newExpiry, session.account_id]
            );
            calRes = await fetch(calUrl.toString(), {
              headers: { 'Authorization': `Bearer ${accessToken}` },
            });
          }
        }

        if (!calRes.ok) {
          return json({ ok: false, error: 'GOOGLE_API_ERROR', message: 'Failed to fetch Google Calendar events' }, 502);
        }

        const calData = await calRes.json();
        const events = (calData.items ?? []).map((e) => ({
          googleEventId: e.id ?? '',
          title: e.summary ?? '(No title)',
          startAt: e.start?.dateTime ?? e.start?.date ?? '',
          endAt: e.end?.dateTime ?? e.end?.date ?? '',
          allDay: !!(e.start?.date && !e.start?.dateTime),
          htmlLink: e.htmlLink ?? '',
          description: e.description ?? '',
          location: e.location ?? '',
          status: e.status ?? 'confirmed',
          colorId: e.colorId ?? '',
        }));

        return json({ ok: true, events });
      } catch {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch Google Calendar events' }, 500);
      }
    },
  },
  // -------------------------------------------------------------------------
  // TOOLS (Phase 1 — TTTMP)
  // Rate limiting must be applied here before any processing.
  // Token debit happens before result is returned — never after.
  // -------------------------------------------------------------------------

  {
    method: 'POST', pattern: '/v1/tools/form2848',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const payload = await parseBody(request);
      if (!payload || typeof payload !== 'object') {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'JSON body required' }, 400);
      }

      if (!payload.account_id || !payload.form_data) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'Missing account_id or form_data' }, 400);
      }

      if (payload.account_id !== session.account_id) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'account_id must match authenticated session' }, 400);
      }

      if (!/^ACCT_[a-f0-9-]{36}$/.test(payload.account_id)) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'Invalid account_id format' }, 400);
      }

      const { form_data: formData } = payload;
      if (!formData || typeof formData !== 'object') {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'form_data must be an object' }, 400);
      }
      if (!formData.taxpayer_name || !formData.taxpayer_ssn || !formData.representative_name) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'Missing required form fields' }, 400);
      }
      if (!/^\d{3}-\d{2}-\d{4}$/.test(formData.taxpayer_ssn)) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'Invalid SSN format (must be XXX-XX-XXXX)' }, 400);
      }

      const allowedPayloadFields = ['account_id', 'form_data'];
      const payloadExtraFields = Object.keys(payload).filter((k) => !allowedPayloadFields.includes(k));
      if (payloadExtraFields.length > 0) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: `Unexpected top-level fields: ${payloadExtraFields.join(', ')}` }, 400);
      }

      const allowedFormFields = ['taxpayer_name', 'taxpayer_ssn', 'representative_name', 'representative_caf', 'tax_matters'];
      const extraFields = Object.keys(formData).filter((k) => !allowedFormFields.includes(k));
      if (extraFields.length > 0) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: `Unexpected fields: ${extraFields.join(', ')}` }, 400);
      }

      if (formData.tax_matters !== undefined && !Array.isArray(formData.tax_matters)) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'tax_matters must be an array when provided' }, 400);
      }

      const accountId = payload.account_id;
      const formDataJson = JSON.stringify(formData);
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(formDataJson));
      const hashHex = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
      const dedupeKey = `${accountId}:${hashHex}`;

      const existingEvent = await env.DB.prepare(
        'SELECT event_id FROM tttmp_tool_usage WHERE dedupe_key = ?'
      ).bind(dedupeKey).first();

      if (existingEvent?.event_id) {
        return json({
          ok: true,
          message: 'Duplicate request detected — returning cached result',
          original_event_id: existingEvent.event_id,
          pdf_url: `https://r2.virtuallaunch.pro/tttmp/tool_results/${accountId}/${existingEvent.event_id}.pdf`,
        });
      }

      const tokenRow = await env.DB.prepare(
        'SELECT tax_game_tokens FROM tokens WHERE account_id = ?'
      ).bind(accountId).first();
      if (!tokenRow || tokenRow.tax_game_tokens < 1) {
        return json({ ok: false, error: 'INSUFFICIENT_TOKENS', message: 'At least 1 tax_game token required' }, 403);
      }

      const eventId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const nowMs = Date.now();

      const receipt = {
        event_id: eventId,
        account_id: accountId,
        dedupe_key: dedupeKey,
        tool_name: 'form2848',
        created_at: nowIso,
        payload,
      };
      await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/tttmp/${accountId}/${eventId}.json`, receipt);

      await d1Run(
        env.DB,
        'UPDATE tokens SET tax_game_tokens = tax_game_tokens - 1, updated_at = ? WHERE account_id = ?',
        [nowIso, accountId]
      );

      const updatedTaxGameTokens = tokenRow.tax_game_tokens - 1;
      await r2Put(env.R2_VIRTUAL_LAUNCH, `tokens/${accountId}.json`, {
        account_id: accountId,
        tax_game_tokens: updatedTaxGameTokens,
        updated_at: nowIso,
      });

      const pdfLines = [
        '%PDF-1.4',
        '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
        '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
        '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj',
        `4 0 obj << /Length 96 >> stream\nBT /F1 12 Tf 72 720 Td (Form 2848 Event ${eventId}) Tj ET\nendstream endobj`,
        'xref',
        '0 5',
        '0000000000 65535 f ',
        'trailer << /Root 1 0 R /Size 5 >>',
        'startxref',
        '0',
        '%%EOF',
      ];
      const pdfBuffer = new TextEncoder().encode(pdfLines.join('\n'));
      const pdfKey = `tttmp/tool_results/${accountId}/${eventId}.pdf`;
      await env.R2_VIRTUAL_LAUNCH.put(pdfKey, pdfBuffer, {
        httpMetadata: { contentType: 'application/pdf' },
        customMetadata: {
          retention: '30-days',
          account_id: accountId,
          event_id: eventId,
        },
      });
      const pdfUrl = `https://r2.virtuallaunch.pro/tttmp/tool_results/${accountId}/${eventId}.pdf`;

      await env.DB.prepare(`
        INSERT INTO tttmp_tool_usage (
          id, account_id, event_id, tool_name, dedupe_key,
          executed_at, tokens_deducted, result_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        `USAGE_${eventId}`,
        accountId,
        eventId,
        'form2848',
        dedupeKey,
        nowMs,
        1,
        pdfUrl
      ).run();

      return json({
        ok: true,
        event_id: eventId,
        status: 'completed',
        tokens_debited: 1,
        token_type: 'tax_game',
        pdf_url: pdfUrl,
      });
    },
  },

  {
    method: 'POST', pattern: '/v1/tools/form-8821',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const body = await parseBody(request);
      if (!body || typeof body !== 'object') {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'JSON body required' }, 400);
      }

      const required = ['eventId', 'taxpayerName', 'taxpayerTin', 'taxpayerAddress', 'appointeeName', 'appointeeAddress', 'taxMatters'];
      for (const field of required) {
        if (!body[field]) return json({ ok: false, error: 'VALIDATION_FAILED', message: `Missing required field: ${field}` }, 400);
      }
      if (!Array.isArray(body.taxMatters) || body.taxMatters.length === 0) {
        return json({ ok: false, error: 'VALIDATION_FAILED', message: 'taxMatters must be a non-empty array' }, 400);
      }

      // Check token balance
      const tokenRow = await env.DB.prepare(
        'SELECT tax_game_tokens FROM tokens WHERE account_id = ?'
      ).bind(session.account_id).first();
      if (!tokenRow || tokenRow.tax_game_tokens < 1) {
        return json({ ok: false, error: 'INSUFFICIENT_TOKENS', message: 'At least 1 tax_game token required' }, 403);
      }

      const now = new Date().toISOString();
      const eventId = body.eventId;

      // 1. Write R2 receipt
      const receipt = {
        eventId, accountId: session.account_id, tool: 'form_8821',
        tokenType: 'tax_game', tokensDebited: 1, createdAt: now,
        payload: { taxpayerName: body.taxpayerName, taxpayerTin: body.taxpayerTin, taxMatters: body.taxMatters },
      };
      await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/tools/form-8821/${eventId}.json`, receipt);

      // Build filled form data
      const formData = {
        form: '8821',
        revision: '2021-01',
        taxpayer: {
          name: body.taxpayerName,
          tin: body.taxpayerTin,
          address: body.taxpayerAddress,
          phone: body.taxpayerPhone ?? '',
        },
        appointee: {
          name: body.appointeeName,
          cafNumber: body.appointeeCafNumber ?? '',
          address: body.appointeeAddress,
          phone: body.appointeePhone ?? '',
        },
        taxMatters: body.taxMatters,
        specificUseNotRecorded: body.specificUseNotRecorded ?? false,
        generatedAt: now,
      };

      // 2. Write R2 canonical tool session
      await r2Put(env.R2_VIRTUAL_LAUNCH, `tttmp_tool_sessions/${eventId}.json`, {
        sessionId: eventId, accountId: session.account_id, tool: 'form_8821',
        tokenType: 'tax_game', tokensDebited: 1, status: 'completed',
        result: formData, createdAt: now,
      });

      // 3. Update D1 — debit token, insert tool session row
      await Promise.all([
        d1Run(env.DB,
          'UPDATE tokens SET tax_game_tokens = tax_game_tokens - 1, updated_at = ? WHERE account_id = ?',
          [now, session.account_id]
        ),
        d1Run(env.DB,
          'INSERT INTO tool_sessions (session_id, account_id, tool, token_type, tokens_debited, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [eventId, session.account_id, 'form_8821', 'tax_game', 1, 'completed', now]
        ),
      ]);

      return json({ ok: true, eventId, status: 'completed', tokensDebited: 1, tokenType: 'tax_game', formData });
    },
  },

  // -------------------------------------------------------------------------
  // TRANSCRIPTS (Phase 1 — TTMP)
  // -------------------------------------------------------------------------

  {
    method: 'POST', pattern: '/v1/transcripts/jobs',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const body = await parseBody(request);
      if (!body || typeof body !== 'object') {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'JSON body required' }, 400);
      }

      const required = ['eventId', 'transcriptText', 'transcriptType'];
      for (const field of required) {
        if (!body[field]) return json({ ok: false, error: 'VALIDATION_FAILED', message: `Missing required field: ${field}` }, 400);
      }
      const validTypes = ['account', 'record_of_account', 'return', 'wage_and_income'];
      if (!validTypes.includes(body.transcriptType)) {
        return json({ ok: false, error: 'VALIDATION_FAILED', message: `transcriptType must be one of: ${validTypes.join(', ')}` }, 400);
      }

      // Check transcript token balance
      const tokenRow = await env.DB.prepare(
        'SELECT transcript_tokens FROM tokens WHERE account_id = ?'
      ).bind(session.account_id).first();
      if (!tokenRow || tokenRow.transcript_tokens < 1) {
        return json({ ok: false, error: 'INSUFFICIENT_TOKENS', message: 'At least 1 transcript token required' }, 403);
      }

      const now = new Date().toISOString();
      const jobId = body.eventId;
      const text = body.transcriptText;

      // Parse transcript — extract structured fields from IRS transcript text
      const tinMatches = [...text.matchAll(/\b\d{3}-\d{2}-\d{4}\b|\b\d{2}-\d{7}\b/g)].map(m => m[0]);
      const dateMatches = [...text.matchAll(/\b\d{2}\/\d{2}\/\d{4}\b/g)].map(m => m[0]);
      const amountMatches = [...text.matchAll(/\$[\d,]+\.?\d{0,2}/g)].map(m => m[0]);
      const cycleMatches = [...text.matchAll(/\bCYCLE\s*:?\s*(\d{8})\b/gi)].map(m => m[1]);
      const balanceMatch = text.match(/ACCOUNT\s+BALANCE\s*:?\s*\$?([\d,.-]+)/i);
      const withheldMatch = text.match(/WITHHELD\s*:?\s*\$?([\d,.-]+)/i);

      const result = {
        jobId,
        transcriptType: body.transcriptType,
        taxYear: body.taxYear ?? null,
        parsedAt: now,
        extractedFields: {
          tins: [...new Set(tinMatches)],
          dates: [...new Set(dateMatches)],
          amounts: [...new Set(amountMatches)],
          cycles: [...new Set(cycleMatches)],
          accountBalance: balanceMatch ? balanceMatch[1] : null,
          withheld: withheldMatch ? withheldMatch[1] : null,
        },
        lineCount: text.split('\n').length,
        charCount: text.length,
      };

      const resultKey = `ttmp_transcript_results/${jobId}.json`;

      // 1. Write R2 receipt
      await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/transcripts/${jobId}.json`, {
        eventId: jobId, accountId: session.account_id, transcriptType: body.transcriptType,
        taxYear: body.taxYear ?? null, tokenType: 'transcript', tokensDebited: 1, createdAt: now,
      });

      // 2. Write R2 canonical job + result (raw transcript stored at TTL-scoped key, not indefinitely)
      await Promise.all([
        r2Put(env.R2_VIRTUAL_LAUNCH, `ttmp_transcript_jobs/${jobId}.json`, {
          jobId, accountId: session.account_id, transcriptType: body.transcriptType,
          taxYear: body.taxYear ?? null, tokensDebited: 1,
          status: 'completed', resultKey, createdAt: now, completedAt: now,
        }),
        r2Put(env.R2_VIRTUAL_LAUNCH, resultKey, result),
      ]);

      // 3. Update D1 — debit token, insert transcript job row, and index in unified tool_sessions table
      await Promise.all([
        d1Run(env.DB,
          'UPDATE tokens SET transcript_tokens = transcript_tokens - 1, updated_at = ? WHERE account_id = ?',
          [now, session.account_id]
        ),
        d1Run(env.DB,
          'INSERT INTO transcript_jobs (job_id, account_id, transcript_type, tax_year, tokens_debited, status, result_key, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [jobId, session.account_id, body.transcriptType, body.taxYear ?? null, 1, 'completed', resultKey, now, now]
        ),
        d1Run(env.DB,
          'INSERT INTO tool_sessions (session_id, account_id, tool, token_type, tokens_debited, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [jobId, session.account_id, 'transcript_parser', 'transcript_tokens', 1, 'completed', now]
        ),
      ]);

      return json({ ok: true, jobId, status: 'completed', tokensDebited: 1, tokenType: 'transcript_tokens', result });
    },
  },

  {
    method: 'GET', pattern: '/v1/transcripts/jobs/:job_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      try {
        const row = await env.DB.prepare(
          'SELECT * FROM transcript_jobs WHERE job_id = ? AND account_id = ?'
        ).bind(params.job_id, session.account_id).first();

        if (!row) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Transcript job not found' }, 404);
        }

        let result = null;
        if (row.result_key) {
          const obj = await env.R2_VIRTUAL_LAUNCH.get(row.result_key);
          if (obj) result = await obj.json();
        }

        return json({
          ok: true,
          jobId: row.job_id,
          transcriptType: row.transcript_type,
          taxYear: row.tax_year,
          status: row.status,
          tokensDebited: row.tokens_debited,
          createdAt: row.created_at,
          completedAt: row.completed_at,
          result,
        });
      } catch {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch transcript job' }, 500);
      }
    },
  },

];
// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function route(method, pathname) {
  // Collect all routes that match the pathname (any method).
  const pathMatches = [];

  for (const entry of ROUTES) {
    const params = matchPath(entry.pattern, pathname);
    if (params === null) continue;

    if (entry.method === method) {
      return { matched: true, handler: entry.handler, pattern: entry.pattern, params };
    }
    pathMatches.push(entry);
  }

  if (pathMatches.length > 0) {
    // Path matched but not the method.
    return { matched: false, reason: 'METHOD_NOT_ALLOWED' };
  }

  return { matched: false, reason: 'NOT_FOUND' };
}

// ---------------------------------------------------------------------------
// Fetch handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    const pathname = url.pathname;

    // Handle CORS preflight.
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const result = route(method, pathname);

    if (!result.matched) {
      if (result.reason === 'METHOD_NOT_ALLOWED') {
        return methodNotAllowed(method, pathname);
      }
      return notFound(pathname);
    }

    return result.handler(method, result.pattern, result.params, request, env, ctx);
  },
};




