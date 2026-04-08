import { PDFDocument } from 'pdf-lib';
import { FORM_843_BASE64 } from './form843-template.js';

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

const ALLOWED_ORIGINS = [
  'https://virtuallaunch.pro',
  'https://api.taxmonitor.pro',
  'https://taxmonitor.pro',
  'https://transcript.taxmonitor.pro',
  'https://taxtools.taxmonitor.pro',
  'https://developers.virtuallaunch.pro',
  'https://games.virtuallaunch.pro',
  'https://taxclaim.virtuallaunch.pro',
  'https://websitelotto.virtuallaunch.pro',
];

function getCorsHeaders(request) {
  const origin = request?.headers?.get('Origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : 'https://virtuallaunch.pro';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status = 200, request) {
  const corsHeaders = getCorsHeaders(request);
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}


function notFound(path, request) {
  return json({ ok: false, error: 'NOT_FOUND', path }, 404, request);
}

function methodNotAllowed(method, path, request) {
  return json({ ok: false, error: 'METHOD_NOT_ALLOWED', route: `${method} ${path}` }, 405, request);
}

/**
 * Match a URL pathname against a pattern that may contain :param segments.
 * Returns an object of extracted params on match, or null on no match.
 */
function matchPath(pattern, pathname) {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i] === '*') {
      // Wildcard — matches this segment and all remaining segments
      params['*'] = pathParts.slice(i).join('/');
      return params;
    } else if (patternParts[i].startsWith(':')) {
      if (i >= pathParts.length) return null;
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }

  // No wildcard — lengths must match exactly
  if (patternParts.length !== pathParts.length) return null;

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

async function r2Get(bucket, key) {
  try {
    const obj = await bucket.get(key);
    if (!obj) return null;
    return await obj.text();
  } catch {
    return null;
  }
}

async function d1Run(db, sql, params) {
  return db.prepare(sql).bind(...params).run();
}

// Get current token balance for an account (R2 canonical, D1 fallback)
async function getCurrentTokenBalance(env, accountId) {
  // Try R2 first (canonical)
  const r2Object = await env.R2_VIRTUAL_LAUNCH.get(`tokens/${accountId}.json`);
  if (r2Object) {
    const data = await r2Object.json();
    return {
      taxGameTokens: data.tax_game_tokens || 0,
      transcriptTokens: data.transcript_tokens || 0,
      updatedAt: data.updated_at
    };
  }

  // Fallback to D1
  try {
    const row = await env.DB.prepare(
      `SELECT * FROM tokens WHERE account_id = ?`
    ).bind(accountId).first();
    if (row) {
      return {
        taxGameTokens: row.tax_game_tokens || 0,
        transcriptTokens: row.transcript_tokens || 0,
        updatedAt: row.updated_at
      };
    }
  } catch (e) {
    console.error('Failed to fetch token balance from D1:', e);
  }

  // Default if neither source has data
  return {
    taxGameTokens: 0,
    transcriptTokens: 0,
    updatedAt: null
  };
}

// ---------------------------------------------------------------------------
// PDF text extraction — lightweight, Worker-compatible
// Handles digitally generated PDFs (IRS transcripts). Does NOT handle scanned
// image PDFs. Extracts text from PDF stream objects by decoding FlateDecode
// streams and pulling BT...ET text blocks.
// ---------------------------------------------------------------------------
function extractTextFromPdf(pdfBytes) {
  const raw = new TextDecoder('latin1').decode(pdfBytes);
  const textChunks = [];

  // Strategy 1: Extract text operators from uncompressed PDF stream objects
  const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
  let streamMatch;
  while ((streamMatch = streamRegex.exec(raw)) !== null) {
    const textFromStream = extractTextOperators(streamMatch[1]);
    if (textFromStream) textChunks.push(textFromStream);
  }

  // Strategy 2: Direct pattern scan for IRS transcript data in raw PDF bytes
  // IRS transcripts are digitally generated — transaction codes, dates, and
  // amounts appear as readable text even without full stream decompression.
  const directText = extractDirectText(raw);
  if (directText) textChunks.push(directText);

  return textChunks.join('\n').trim();
}

function extractTextOperators(content) {
  const chunks = [];
  // Match text between BT (begin text) and ET (end text) blocks
  const btEtRegex = /BT\s([\s\S]*?)ET/g;
  let btMatch;
  while ((btMatch = btEtRegex.exec(content)) !== null) {
    const block = btMatch[1];
    // Extract text from Tj operator: (text) Tj
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      chunks.push(decodePdfString(tjMatch[1]));
    }
    // Extract text from TJ operator (array of strings): [(text) 123 (text)] TJ
    const tjArrayRegex = /\[((?:[^]]*?))\]\s*TJ/gi;
    let arrMatch;
    while ((arrMatch = tjArrayRegex.exec(block)) !== null) {
      const innerRegex = /\(([^)]*)\)/g;
      let innerMatch;
      while ((innerMatch = innerRegex.exec(arrMatch[1])) !== null) {
        chunks.push(decodePdfString(innerMatch[1]));
      }
    }
    // Extract from ' and " operators (move to next line and show text)
    const quoteRegex = /\(([^)]*)\)\s*['"]/g;
    let quoteMatch;
    while ((quoteMatch = quoteRegex.exec(block)) !== null) {
      chunks.push(decodePdfString(quoteMatch[1]));
    }
    if (chunks.length > 0) chunks.push('\n');
  }
  return chunks.join('');
}

function extractDirectText(raw) {
  // Look for readable IRS transcript patterns directly in the raw PDF
  const lines = [];
  // IRS transcripts contain recognizable patterns even in raw PDF data
  // Look for transaction code patterns: 3-digit code + date + amount
  const txLineRegex = /(\d{3})\s+[A-Za-z][\w\s]+?\s+(\d{2}[-/]\d{2}[-/]\d{4})\s+[-]?\$?([\d,]+\.?\d{0,2})/g;
  let match;
  while ((match = txLineRegex.exec(raw)) !== null) {
    lines.push(match[0]);
  }

  // Look for transcript type indicators
  const typePatterns = [
    /Account\s+Transcript/gi,
    /Return\s+Transcript/gi,
    /Record\s+of\s+Account/gi,
    /Wage\s+and\s+Income/gi,
    /Tax\s+Return\s+Filed/gi,
    /ACCOUNT\s+BALANCE/gi,
    /ACCOUNT\s+INFORMATION/gi,
  ];
  for (const pat of typePatterns) {
    const m = raw.match(pat);
    if (m) lines.unshift(m[0]);
  }

  return lines.join('\n');
}

function decodePdfString(str) {
  // Decode PDF escape sequences
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
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
    return { error: json({ ok: false, error: 'UNAUTHORIZED' }, 401, request) };
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

function pemToDer(pem) {
  // Strip BEGIN/END headers and all whitespace/newlines
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');

  // Decode base64 to binary
  const binaryString = atob(body);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function signJwtRS256(payload, pemKey) {
  const enc = new TextEncoder();

  // Parse service account to extract private key
  let privateKeyPem;
  try {
    const serviceAccount = JSON.parse(pemKey);
    privateKeyPem = serviceAccount.private_key.replace(/\\n/g, '\n');
  } catch (e) {
    // If pemKey is already a PEM string, use it directly
    privateKeyPem = pemKey.replace(/\\n/g, '\n');
  }

  // Import RSA private key
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Construct JWT header and payload
  const header = { alg: 'RS256', typ: 'JWT' };
  const headerB64 = base64urlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  // Sign with RSA-SHA256
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    enc.encode(signingInput)
  );

  // Base64url encode signature
  const signatureB64 = base64urlEncode(signature);

  return `${signingInput}.${signatureB64}`;
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

async function sendGmailMessage(env, to, subject, body) {
  try {
    // Parse service account credentials
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(env.GOOGLE_PRIVATE_KEY);
    } catch (e) {
      throw new Error('Failed to parse GOOGLE_PRIVATE_KEY JSON');
    }

    // Create JWT for Google OAuth
    const now = Math.floor(Date.now() / 1000);
    const jwtPayload = {
      iat: now,
      exp: now + 3600,
      iss: serviceAccount.client_email || 'virtual-launch-worker@virtual-launch-pro.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/gmail.send',
      aud: 'https://oauth2.googleapis.com/token',
      sub: env.GMAIL_IMPERSONATE_SUBJECT
    };

    // Sign JWT with RS256
    const token = await signJwtRS256(jwtPayload, env.GOOGLE_PRIVATE_KEY);

    // Exchange JWT for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: token
      })
    });

    if (!tokenResponse.ok) {
      const tokenError = await tokenResponse.text();
      throw new Error(`OAuth token request failed: ${tokenResponse.status} ${tokenError}`);
    }

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
      throw new Error('No access token in OAuth response');
    }

    // Construct RFC 2822 message
    const message = [
      `From: Jamie L Williams <${env.GMAIL_SENDING_ADDRESS}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body
    ].join('\r\n');

    // Base64url encode message
    const encodedMessage = btoa(message).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // Send via Gmail API
    const sendResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ raw: encodedMessage })
    });

    if (!sendResponse.ok) {
      const sendError = await sendResponse.text();
      throw new Error(`Gmail send failed: ${sendResponse.status} ${sendError}`);
    }

    const sendData = await sendResponse.json();
    return { messageId: sendData.id };

  } catch (error) {
    throw new Error(`Gmail send error: ${error.message}`);
  }
}

async function sendEmail(to, subject, htmlBody, env) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Virtual Launch Pro <noreply@virtuallaunch.pro>',
        to: [to],
        subject,
        html: htmlBody,
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.error(`[sendEmail] Resend error: ${res.status}`, JSON.stringify(err))
      return false
    }

    const data = await res.json()
    console.log(`[sendEmail] Sent to ${to} — id: ${data.id}`)
    return true
  } catch (err) {
    console.error(`[sendEmail] Exception:`, err?.message || err)
    return false
  }
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

async function stripePost(path, params, env, secretKey) {
  const key = secretKey || env.STRIPE_SECRET_KEY;
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(flattenStripeParams(params)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `Stripe error ${res.status}`);
  return data;
}

async function stripeGet(path, env, secretKey) {
  const key = secretKey || env.STRIPE_SECRET_KEY;
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { 'Authorization': `Bearer ${key}` },
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
    vlp_free:     { transcriptTokens: 0,  taxGameTokens: 0 },
    vlp_starter:  { transcriptTokens: 2,  taxGameTokens: 5 },
    vlp_pro:      { transcriptTokens: 5,  taxGameTokens: 15 },
    vlp_advanced: { transcriptTokens: 10, taxGameTokens: 40 },
    vlp_scale:    { transcriptTokens: 5,  taxGameTokens: 15 },
  };
  return grants[planKey] ?? { transcriptTokens: 0, taxGameTokens: 0 };
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

function makeSessionCookie(sessionId, env, domainOverride) {
  const ttl = parseInt(env.SESSION_TTL_SECONDS ?? '86400', 10);
  const expires = new Date(Date.now() + ttl * 1000).toUTCString();
  const domain = domainOverride ?? env.COOKIE_DOMAIN ?? '.virtuallaunch.pro';
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

function jsonWithCookie(body, sessionId, env, status = 200, request, domainOverride) {
  const corsHeaders = getCorsHeaders(request);
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      'Set-Cookie': makeSessionCookie(sessionId, env, domainOverride),
    },
  });
}

function cookieDomainForUrl(url) {
  const hostname = typeof url === 'string' ? new URL(url).hostname : url.hostname;
  if (hostname === 'taxmonitor.pro' || hostname.endsWith('.taxmonitor.pro')) return '.taxmonitor.pro';
  return null; // use default (.virtuallaunch.pro)
}

function redirectWithCookie(url, sessionId, env, request) {
  const corsHeaders = getCorsHeaders(request);
  return new Response(null, {
    status: 302,
    headers: {
      'Location': url,
      'Set-Cookie': makeSessionCookie(sessionId, env, cookieDomainForUrl(url)),
      ...corsHeaders,
    },
  });
}

// ---------------------------------------------------------------------------
// TTTMP Session helpers
// ---------------------------------------------------------------------------

async function getTttmpSessionFromRequest(request, env) {
  let sessionId = null;

  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    sessionId = authHeader.slice(7).trim();
  }

  if (!sessionId) {
    const cookieHeader = request.headers.get('Cookie') ?? '';
    const match = cookieHeader.match(/(?:^|;\s*)tttmp_session=([^;]+)/);
    if (match) sessionId = match[1];
  }

  if (!sessionId) return null;

  try {
    const now = new Date().toISOString();
    const session = await env.DB.prepare(
      'SELECT * FROM sessions WHERE session_id = ? AND expires_at > ? AND platform = ?'
    ).bind(sessionId, now, 'tttmp').first();
    return session ?? null;
  } catch {
    return null;
  }
}

async function requireTttmpSession(request, env) {
  const session = await getTttmpSessionFromRequest(request, env);
  if (!session) {
    return { error: json({ ok: false, error: 'UNAUTHORIZED' }, 401, request) };
  }
  return { session };
}

async function createTttmpSession(accountId, email, env) {
  const sessionId = `SES_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const ttl = parseInt(env.SESSION_TTL_SECONDS ?? '86400', 10);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  // Store in D1
  await d1Run(env.DB,
    `INSERT INTO sessions (session_id, account_id, email, platform, membership, created_at, expires_at)
     VALUES (?, ?, ?, 'tttmp', 'free', ?, ?)`,
    [sessionId, accountId, email, now, expiresAt]
  );

  // Store in R2 as well
  const sessionData = {
    session_id: sessionId,
    account_id: accountId,
    email,
    platform: 'tttmp',
    created_at: now,
    expires_at: expiresAt
  };
  await r2Put(env.R2_VIRTUAL_LAUNCH, `tttmp/auth/sessions/${sessionId}.json`, sessionData);

  return { sessionId, expiresAt };
}

function makeTttmpSessionCookie(sessionId, env) {
  const ttl = parseInt(env.SESSION_TTL_SECONDS ?? '86400', 10);
  const expires = new Date(Date.now() + ttl * 1000).toUTCString();
  const domain = env.COOKIE_DOMAIN ?? '.taxmonitor.pro';
  return [
    `tttmp_session=${sessionId}`,
    `Domain=${domain}`,
    `Path=/`,
    `Expires=${expires}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
  ].join('; ');
}

// Token consumption and crediting helpers
async function consumeTokens(accountId, amount, tokenType, env) {
  const tokenKey = `tokens/${accountId}.json`;

  try {
    // Get current balance
    const balanceData = await r2Get(env.R2_VIRTUAL_LAUNCH, tokenKey);
    const balance = balanceData ? JSON.parse(balanceData) : { tax_game_tokens: 0, transcript_tokens: 0 };

    const tokenField = tokenType === 'tax_game' ? 'tax_game_tokens' : 'transcript_tokens';

    if (balance[tokenField] < amount) {
      throw new Error('Insufficient tokens');
    }

    // Deduct tokens
    balance[tokenField] -= amount;
    balance.updated_at = new Date().toISOString();

    // Update R2
    await r2Put(env.R2_VIRTUAL_LAUNCH, tokenKey, balance);

    // Update D1
    const d1Field = tokenType === 'tax_game' ? 'tax_game_tokens' : 'transcript_tokens';
    await d1Run(env.DB,
      `INSERT INTO tokens (account_id, ${d1Field}, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET ${d1Field} = ?, updated_at = ?`,
      [accountId, balance[tokenField], balance.updated_at, balance[tokenField], balance.updated_at]
    );

    return { success: true, newBalance: balance[tokenField] };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function creditTokens(accountId, amount, tokenType, env) {
  const tokenKey = `tokens/${accountId}.json`;

  try {
    // Get current balance
    const balanceData = await r2Get(env.R2_VIRTUAL_LAUNCH, tokenKey);
    const balance = balanceData ? JSON.parse(balanceData) : { tax_game_tokens: 0, transcript_tokens: 0 };

    const tokenField = tokenType === 'tax_game' ? 'tax_game_tokens' : 'transcript_tokens';

    // Add tokens
    balance[tokenField] += amount;
    balance.updated_at = new Date().toISOString();

    // Update R2
    await r2Put(env.R2_VIRTUAL_LAUNCH, tokenKey, balance);

    // Update D1
    const d1Field = tokenType === 'tax_game' ? 'tax_game_tokens' : 'transcript_tokens';
    await d1Run(env.DB,
      `INSERT INTO tokens (account_id, ${d1Field}, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET ${d1Field} = ?, updated_at = ?`,
      [accountId, balance[tokenField], balance.updated_at, balance[tokenField], balance.updated_at]
    );

    return { success: true, newBalance: balance[tokenField] };
  } catch (e) {
    return { success: false, error: e.message };
  }
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

// GVLP Business Rules (hardcoded)
const GVLP_TIERS = {
  starter:    { price_id: 'price_1TDZbk9ROeyeXOqeZOXNz5ig', tokens: 100,  games: 1, monthly: 0  },
  apprentice: { price_id: 'price_1TDZbk9ROeyeXOqeig7pVMaM', tokens: 500,  games: 3, monthly: 9  },
  strategist: { price_id: 'price_1TDZbk9ROeyeXOqeA7GjsVUM', tokens: 1500, games: 6, monthly: 19 },
  navigator:  { price_id: 'price_1TDZbk9ROeyeXOqe5b06ko0z', tokens: 5000, games: 9, monthly: 39 },
};

const GVLP_GAME_UNLOCK = {
  starter:    ['tax-trivia'],
  apprentice: ['tax-trivia', 'tax-match-mania', 'tax-spin-wheel'],
  strategist: ['tax-trivia', 'tax-match-mania', 'tax-spin-wheel', 'tax-word-search', 'irs-fact-or-fiction', 'capital-gains-climb'],
  navigator:  ['tax-trivia', 'tax-match-mania', 'tax-spin-wheel', 'tax-word-search', 'irs-fact-or-fiction', 'capital-gains-climb', 'deduction-dash', 'refund-rush', 'audit-escape-room'],
};

// TCVLP Business Rules (hardcoded)
const IRS_843_MAILING_ADDRESSES = {
  'AL': 'Internal Revenue Service, Austin, TX 73301-0030',
  'AK': 'Internal Revenue Service, Ogden, UT 84201-0030',
  'AZ': 'Internal Revenue Service, Ogden, UT 84201-0030',
  'AR': 'Internal Revenue Service, Austin, TX 73301-0030',
  'CA': 'Internal Revenue Service, Ogden, UT 84201-0030',
  'CO': 'Internal Revenue Service, Ogden, UT 84201-0030',
  'CT': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'DE': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'FL': 'Internal Revenue Service, Austin, TX 73301-0030',
  'GA': 'Internal Revenue Service, Austin, TX 73301-0030',
  'HI': 'Internal Revenue Service, Ogden, UT 84201-0030',
  'ID': 'Internal Revenue Service, Ogden, UT 84201-0030',
  'IL': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'IN': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'IA': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'KS': 'Internal Revenue Service, Austin, TX 73301-0030',
  'KY': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'LA': 'Internal Revenue Service, Austin, TX 73301-0030',
  'ME': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'MD': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'MA': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'MI': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'MN': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'MS': 'Internal Revenue Service, Austin, TX 73301-0030',
  'MO': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'MT': 'Internal Revenue Service, Ogden, UT 84201-0030',
  'NE': 'Internal Revenue Service, Ogden, UT 84201-0030',
  'NV': 'Internal Revenue Service, Ogden, UT 84201-0030',
  'NH': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'NJ': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'NM': 'Internal Revenue Service, Austin, TX 73301-0030',
  'NY': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'NC': 'Internal Revenue Service, Austin, TX 73301-0030',
  'ND': 'Internal Revenue Service, Ogden, UT 84201-0030',
  'OH': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'OK': 'Internal Revenue Service, Austin, TX 73301-0030',
  'OR': 'Internal Revenue Service, Ogden, UT 84201-0030',
  'PA': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'RI': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'SC': 'Internal Revenue Service, Austin, TX 73301-0030',
  'SD': 'Internal Revenue Service, Ogden, UT 84201-0030',
  'TN': 'Internal Revenue Service, Austin, TX 73301-0030',
  'TX': 'Internal Revenue Service, Austin, TX 73301-0030',
  'UT': 'Internal Revenue Service, Ogden, UT 84201-0030',
  'VT': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'VA': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'WA': 'Internal Revenue Service, Ogden, UT 84201-0030',
  'WV': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'WI': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'WY': 'Internal Revenue Service, Ogden, UT 84201-0030',
  'DC': 'Internal Revenue Service, Kansas City, MO 64999-0030',
  'PR': 'Internal Revenue Service, Austin, TX 73301-0030',
  'VI': 'Internal Revenue Service, Austin, TX 73301-0030',
};

// WLVLP Business Rules (hardcoded)
const WLVLP_SCRATCH_PRIZES = [
  { prize_type: 'free_month',    prize_value: 'Free 1-month claim',      weight: 2  },
  { prize_type: 'discount_50',   prize_value: '50% off first month',     weight: 7  },
  { prize_type: 'discount_25',   prize_value: '25% off first month',     weight: 13 },
  { prize_type: 'credit_9',      prize_value: '$9 credit toward claim',  weight: 25 },
  { prize_type: 'free_ticket',   prize_value: 'Free scratch ticket',     weight: 17 },
  { prize_type: 'no_prize',      prize_value: null,                      weight: 36 },
];

// Weighted random: sum weights = 100
function drawScratchPrize() {
  const roll = Math.random() * 100;
  let cumulative = 0;
  for (const prize of WLVLP_SCRATCH_PRIZES) {
    cumulative += prize.weight;
    if (roll < cumulative) return prize;
  }
  return WLVLP_SCRATCH_PRIZES[WLVLP_SCRATCH_PRIZES.length - 1];
}

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

      // Get referral code for affiliate program
      let referralCode = null;
      try {
        const affiliateRow = await env.DB.prepare('SELECT referral_code FROM affiliates WHERE account_id = ?').bind(session.account_id).first();
        if (affiliateRow) {
          referralCode = affiliateRow.referral_code;
        }
      } catch {/* ignore affiliate lookup errors */}

      // Fetch token balance from R2
      let transcriptTokens = 0;
      try {
        const tokenKey = `tokens/${session.account_id}.json`;
        const tokenObj = await env.R2_VIRTUAL_LAUNCH.get(tokenKey);
        if (tokenObj) {
          const tokenData = await tokenObj.json();
          transcriptTokens = tokenData.transcript_tokens ?? 0;
        }
      } catch {}

      return json({
        ok: true,
        session: {
          account_id: session.account_id,
          email: session.email,
          membership,
          platform: session.platform,
          expires_at: session.expires_at,
          referral_code: referralCode,
          transcript_tokens: transcriptTokens,
        },
      }, 200, request);
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
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to delete session' }, 500, request);
      }
      return new Response(JSON.stringify({ ok: true, status: 'logged_out' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(request),
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
    handler: async (_method, _pattern, _params, request, env) => {
      const reqUrl = new URL(request.url)
      const returnTo = reqUrl.searchParams.get('return_to') || 'https://virtuallaunch.pro/dashboard'

      // Determine OAuth client + redirect URI based on target domain
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

      const state = encodeURIComponent(returnTo)
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      url.searchParams.set('client_id', googleClientId)
      url.searchParams.set('redirect_uri', googleRedirectUri)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', 'openid email profile')
      url.searchParams.set('state', state)

      return new Response(null, { status: 302, headers: { 'Location': url.toString() } })
    },
  },

  {
    method: 'GET', pattern: '/v1/auth/google/callback',
    handler: async (_method, _pattern, _params, request, env) => {
      const url = new URL(request.url);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'code and state required' }, 400, request);
      }
      try {
        // Decode the return_to URL from state
        let redirectTarget = 'https://virtuallaunch.pro/dashboard'
        try {
          const decoded = decodeURIComponent(state)
          if (decoded.startsWith('https://')) redirectTarget = decoded
        } catch {}

        // Determine OAuth client + redirect URI based on target domain (must match start handler)
        const isTaxMonitor = redirectTarget.includes('taxmonitor.pro')
        const googleClientId = isTaxMonitor
          ? '1042806598248-ugakuq39veaq2vafgtvkue2m1g0to2su.apps.googleusercontent.com'
          : env.GOOGLE_CLIENT_ID
        const googleClientSecret = isTaxMonitor
          ? env.GOOGLE_CLIENT_SECRET_TMP
          : env.GOOGLE_CLIENT_SECRET
        const googleRedirectUri = isTaxMonitor
          ? 'https://api.taxmonitor.pro/v1/auth/google/callback'
          : env.GOOGLE_REDIRECT_URI

        // Exchange code for token
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: googleClientId,
            client_secret: googleClientSecret,
            redirect_uri: googleRedirectUri,
            grant_type: 'authorization_code',
          }),
        });
        if (!tokenRes.ok) return json({ ok: false, error: 'OAUTH_ERROR', message: 'Token exchange failed' }, 502, request);
        const { access_token } = await tokenRes.json();

        // Get user info
        const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        if (!userRes.ok) return json({ ok: false, error: 'OAUTH_ERROR', message: 'Failed to fetch user info' }, 502, request);
        const user = await userRes.json();

        // Create/update account and session
        const { accountId } = await upsertAccount(user.email, user.given_name ?? '', user.family_name ?? '', env);
        const { sessionId } = await createSession(accountId, user.email, env);

        // Always redirect with cookie — domain is determined by cookieDomainForUrl()
        // api.taxmonitor.pro can set .taxmonitor.pro cookies (same domain family)
        // api.virtuallaunch.pro can set .virtuallaunch.pro cookies (same domain family)
        return redirectWithCookie(redirectTarget, sessionId, env, request)
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Google callback failed' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/auth/magic-link/request',
    handler: async (_method, _pattern, _params, request, env) => {
      const body = await parseBody(request);
      if (!body?.email || !body?.redirectUri) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'email and redirectUri required' }, 400, request);
      }
      const { email, redirectUri } = body;
      try {
        const expMinutes = parseInt(env.MAGIC_LINK_EXPIRATION_MINUTES ?? '15', 10);
        const exp = Math.floor(Date.now() / 1000) + expMinutes * 60;
        const token = await signJwt({ email, redirect_uri: redirectUri, exp }, env.JWT_SECRET);
        const link = `https://api.virtuallaunch.pro/v1/auth/magic-link/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
        const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0f1e;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111827;border-radius:12px;border:1px solid #1f2937;overflow:hidden;">

        <!-- Header -->
        <tr><td style="background:#14b8a6;padding:24px 32px;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#000;">Transcript Tax Monitor Pro</p>
          <p style="margin:4px 0 0;font-size:13px;color:rgba(0,0,0,0.7);">Transcript automation for tax professionals</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f9fafb;">Your sign-in link</p>
          <p style="margin:0 0 24px;font-size:15px;color:#9ca3af;line-height:1.6;">Click the button below to sign in to your account. This link expires in 15 minutes and can only be used once.</p>

          <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr><td style="background:#14b8a6;border-radius:8px;">
              <a href="${link}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#000;text-decoration:none;">
                Sign In to Transcript Tax Monitor →
              </a>
            </td></tr>
          </table>

          <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="margin:0;font-size:12px;color:#14b8a6;word-break:break-all;">${link}</p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 32px;border-top:1px solid #1f2937;">
          <p style="margin:0;font-size:12px;color:#4b5563;">If you didn't request this link, you can safely ignore this email. Your account is secure.</p>
          <p style="margin:8px 0 0;font-size:12px;color:#374151;">&copy; 2026 Lenore, Inc. &nbsp;·&nbsp; <a href="https://transcript.taxmonitor.pro" style="color:#14b8a6;text-decoration:none;">transcript.taxmonitor.pro</a></p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
        await sendEmail(email, 'Your Transcript Tax Monitor sign-in link', emailHtml, env);
        const eventId = `EVT_${crypto.randomUUID()}`;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/auth/${eventId}.json`, {
          email, requested_at: new Date().toISOString(), event: 'MAGIC_LINK_REQUESTED',
        });
        return json({ ok: true, status: 'requested', email }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Magic link request failed' }, 500, request);
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
        return json({ ok: false, error: 'BAD_REQUEST', message: 'token and email required' }, 400, request);
      }
      try {
        const payload = await verifyJwt(token, env.JWT_SECRET);
        if (!payload) return json({ ok: false, error: 'INVALID_TOKEN' }, 401, request);
        if (payload.email !== email) return json({ ok: false, error: 'INVALID_TOKEN' }, 401, request);
        const { accountId } = await upsertAccount(email, '', '', env);
        const { sessionId } = await createSession(accountId, email, env);
        const redirectUri = payload.redirect_uri || 'https://virtuallaunch.pro/dashboard';

        // Check if redirect is to external domain
        const redirectUrl = new URL(redirectUri);
        const isSameSite = redirectUrl.hostname === 'virtuallaunch.pro' ||
                           redirectUrl.hostname.endsWith('.virtuallaunch.pro') ||
                           redirectUrl.hostname === 'taxmonitor.pro' ||
                           redirectUrl.hostname.endsWith('.taxmonitor.pro');
        const isExternalDomain = !isSameSite;

        if (isExternalDomain) {
          // Generate one-time handoff token for cross-domain auth
          const handoffToken = crypto.randomUUID();
          const expiresAt = Math.floor(Date.now() / 1000) + 60; // 60 seconds

          await env.DB.prepare(
            'INSERT INTO handoff_tokens (token, session_id, email, redirect_uri, expires_at) VALUES (?, ?, ?, ?, ?)'
          ).bind(handoffToken, sessionId, email, redirectUri, expiresAt).run();

          // Redirect to external domain callback with handoff token
          const callbackUrl = new URL('/auth/callback', redirectUrl.origin);
          callbackUrl.searchParams.set('token', handoffToken);
          callbackUrl.searchParams.set('redirect', redirectUri);

          return Response.redirect(callbackUrl.toString(), 302);
        }

        // Same domain — set cookie and redirect as before
        return redirectWithCookie(redirectUri, sessionId, env, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Magic link verification failed' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/auth/handoff/exchange',
    handler: async (_method, _pattern, _params, request, env) => {
      const url = new URL(request.url);
      const token = url.searchParams.get('token');
      if (!token) {
        return json({ ok: false, error: 'MISSING_TOKEN' }, 400, request);
      }

      try {
        const row = await env.DB.prepare(
          'SELECT * FROM handoff_tokens WHERE token = ? AND used = 0 AND expires_at > ?'
        ).bind(token, Math.floor(Date.now() / 1000)).first();

        if (!row) {
          return json({ ok: false, error: 'INVALID_OR_EXPIRED_TOKEN' }, 401, request);
        }

        // Mark token as used
        await env.DB.prepare(
          'UPDATE handoff_tokens SET used = 1 WHERE token = ?'
        ).bind(token).run();

        // Return session info with cookie
        const exchangeDomain = row.redirect_uri ? cookieDomainForUrl(row.redirect_uri) : null;
        return jsonWithCookie({
          ok: true,
          sessionId: row.session_id,
          email: row.email,
          redirectUri: row.redirect_uri,
        }, row.session_id, env, 200, request, exchangeDomain);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Handoff exchange failed' }, 500, request);
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
      return new Response(null, { status: 302, headers: { 'Location': url.toString() } })
    },
  },

  {
    method: 'GET', pattern: '/v1/auth/sso/oidc/callback',
    handler: async (_method, _pattern, _params, request, env) => {
      const url = new URL(request.url);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'code and state required' }, 400, request);
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
        if (!tokenRes.ok) return json({ ok: false, error: 'OAUTH_ERROR', message: 'Token exchange failed' }, 502, request);
        const { access_token } = await tokenRes.json();

        const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        if (!userRes.ok) return json({ ok: false, error: 'OAUTH_ERROR', message: 'Failed to fetch user info' }, 502, request);
        const user = await userRes.json();

        const { accountId } = await upsertAccount(user.email, user.given_name ?? '', user.family_name ?? '', env);
        const { sessionId } = await createSession(accountId, user.email, env);
        return jsonWithCookie({ ok: true, status: 'callback_completed', redirectTo: `https://virtuallaunch.pro/dashboard` }, sessionId, env, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'OIDC callback failed' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/auth/sso/saml/start',
    handler: async (_method, _pattern, _params, _request, env) => {
      return new Response(null, { status: 302, headers: { 'Location': env.SSO_SAML_IDP_SSO_URL } });
    },
  },

  {
    method: 'POST', pattern: '/v1/auth/sso/saml/acs',
    handler: async (_method, _pattern, _params, request, env) => {
      const body = await parseBody(request);
      if (!body?.samlResponse || !body?.relayState) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'samlResponse and relayState required' }, 400, request);
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
        if (!email) return json({ ok: false, error: 'BAD_REQUEST', message: 'Could not extract email from SAML response' }, 400, request);
        const { accountId } = await upsertAccount(email, '', '', env);
        const { sessionId } = await createSession(accountId, email, env);
        return redirectWithCookie(`https://virtuallaunch.pro/dashboard`, sessionId, env, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'SAML ACS failed' }, 500, request);
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
        if (!row) return json({ ok: false, error: 'NOT_FOUND' }, 404, request);
        return json({ ok: true, accountId: params.account_id, enabled: row.two_factor_enabled === 1 }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: '2FA status lookup failed' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/auth/2fa/enroll/init',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      if (!body?.accountId) return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId required' }, 400, request);
      const { accountId } = body;
      try {
        const secretBytes = crypto.getRandomValues(new Uint8Array(32));
        const secret = base32Encode(secretBytes);
        const row = await env.DB.prepare('SELECT email FROM accounts WHERE account_id = ?').bind(accountId).first();
        if (!row) return json({ ok: false, error: 'NOT_FOUND' }, 404, request);
        await d1Run(env.DB, 'UPDATE accounts SET totp_pending_secret = ? WHERE account_id = ?', [secret, accountId]);
        const issuer = env.TWOFA_TOTP_ISSUER ?? 'VirtualLaunchPro';
        const otpauthUri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(row.email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
        return json({ ok: true, status: 'enrollment_started', accountId, challenge: { otpauthUri, secret } }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: '2FA enrollment init failed' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/auth/2fa/enroll/verify',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      if (!body?.accountId || !body?.otpCode) return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId and otpCode required' }, 400, request);
      const { accountId, otpCode } = body;
      if (String(otpCode).length !== 6) return json({ ok: false, error: 'INVALID_OTP' }, 401, request);
      try {
        const row = await env.DB.prepare('SELECT totp_pending_secret, email FROM accounts WHERE account_id = ?').bind(accountId).first();
        if (!row?.totp_pending_secret) return json({ ok: false, error: 'BAD_REQUEST', message: 'No pending enrollment found' }, 400, request);
        const valid = await verifyTotp(row.totp_pending_secret, String(otpCode));
        if (!valid) return json({ ok: false, error: 'INVALID_OTP' }, 401, request);
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
        return json({ ok: true, status: 'enrollment_verified', accountId }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: '2FA enrollment verify failed' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/auth/2fa/challenge/verify',
    handler: async (_method, _pattern, _params, request, env) => {
      const body = await parseBody(request);
      if (!body?.accountId || !body?.otpCode || !body?.sessionToken) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, otpCode, and sessionToken required' }, 400, request);
      }
      const { accountId, otpCode, sessionToken } = body;
      try {
        const row = await env.DB.prepare('SELECT totp_secret FROM accounts WHERE account_id = ?').bind(accountId).first();
        if (!row?.totp_secret) return json({ ok: false, error: 'BAD_REQUEST', message: '2FA not enrolled' }, 400, request);
        const valid = await verifyTotp(row.totp_secret, String(otpCode));
        if (!valid) return json({ ok: false, error: 'INVALID_OTP' }, 401, request);
        await d1Run(env.DB, 'UPDATE sessions SET two_fa_verified = 1 WHERE session_id = ?', [sessionToken]);
        return json({ ok: true, status: 'verified', accountId }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: '2FA challenge verify failed' }, 500, request);
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
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId and challengeToken required' }, 400, request);
      }
      const { accountId, challengeToken } = body;
      try {
        const row = await env.DB.prepare('SELECT totp_secret, email FROM accounts WHERE account_id = ?').bind(accountId).first();
        if (!row?.totp_secret) return json({ ok: false, error: 'BAD_REQUEST', message: '2FA not enrolled' }, 400, request);
        const valid = await verifyTotp(row.totp_secret, String(challengeToken));
        if (!valid) return json({ ok: false, error: 'INVALID_OTP' }, 401, request);
        await d1Run(env.DB, 'UPDATE accounts SET totp_secret = NULL, two_factor_enabled = 0 WHERE account_id = ?', [accountId]);
        const now = new Date().toISOString();
        const existing2faDisable = await env.R2_VIRTUAL_LAUNCH.get(`accounts_vlp/VLP_ACCT_${accountId}.json`);
        const record2faDisable = existing2faDisable ? await existing2faDisable.json() : {};
        record2faDisable.twoFactorEnabled = false;
        record2faDisable.updatedAt = now;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `accounts_vlp/VLP_ACCT_${accountId}.json`, record2faDisable);
        return json({ ok: true, status: 'disabled', accountId }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: '2FA disable failed' }, 500, request);
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
          return json({ ok: false, error: 'MISSING_FIELDS', message: 'email, eventId, message, name, source are required' }, 400, request);
        }
        if (name.length > 200) return json({ ok: false, error: 'VALIDATION', message: 'name max 200 chars' }, 400, request);
        if (message.length > 5000) return json({ ok: false, error: 'VALIDATION', message: 'message max 5000 chars' }, 400, request);
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
        return json({ ok: true, eventId, status: 'submitted' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Contact submit failed' }, 500, request);
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
      const { accountId, email, firstName, lastName, platform, role, source, referredBy } = body ?? {};
      if (!accountId || !email || !firstName || !lastName || !platform || !role || !source) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, email, firstName, lastName, platform, role, source required' }, 400, request);
      }
      try {
        const eventId = `EVT_${crypto.randomUUID()}`;
        const now = new Date().toISOString();

        // Generate referral code — 8 char alphanumeric, uppercase
        const referralCode = Array.from(crypto.getRandomValues(new Uint8Array(6)))
          .map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32])
          .join('');

        // Look up referrer account_id if referredBy is provided
        let referrerAccountId = null;
        if (referredBy) {
          try {
            const referrerRow = await env.DB.prepare('SELECT account_id FROM affiliates WHERE referral_code = ?').bind(referredBy).first();
            if (referrerRow) {
              referrerAccountId = referrerRow.account_id;
            }
          } catch (e) {
            // Silently ignore invalid referral code - don't fail account creation
          }
        }

        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/accounts/${eventId}.json`, {
          accountId, email, event: 'ACCOUNT_CREATED', created_at: now, source, referredBy: referrerAccountId,
        });

        await d1Run(env.DB,
          `INSERT OR IGNORE INTO accounts (account_id, email, first_name, last_name, platform, role, status, referred_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
          [accountId, email, firstName, lastName, platform, role, referrerAccountId, now]
        );

        // Insert affiliate row
        await d1Run(env.DB,
          'INSERT OR IGNORE INTO affiliates (account_id, referral_code, created_at) VALUES (?, ?, ?)',
          [accountId, referralCode, now]
        );

        // Write to R2
        await r2Put(env.R2_VIRTUAL_LAUNCH, `affiliates/${accountId}.json`, {
          account_id: accountId,
          referral_code: referralCode,
          connect_status: 'pending',
          balance_pending: 0,
          balance_paid: 0,
          created_at: now
        });

        await r2Put(env.R2_VIRTUAL_LAUNCH, `accounts_vlp/VLP_ACCT_${accountId}.json`, {
          accountId, email, firstName, lastName, platform, role, status: 'active', referredBy: referrerAccountId, createdAt: now,
        });
        return json({ ok: true, accountId, status: 'created' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Account creation failed' }, 500, request);
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
        if (!row) return json({ ok: false, error: 'NOT_FOUND' }, 404, request);
        return json({ ok: true, account: row }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Account lookup failed' }, 500, request);
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
        if (!row) return json({ ok: false, error: 'NOT_FOUND' }, 404, request);
        return json({ ok: true, account: row }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Account lookup failed' }, 500, request);
      }
    },
  },

  {
    method: 'PATCH', pattern: '/v1/accounts/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      if (!body) return json({ ok: false, error: 'BAD_REQUEST', message: 'Request body required' }, 400, request);
      const allowed = ['email', 'firstName', 'lastName', 'phone', 'status', 'timezone'];
      const dbCols = { email: 'email', firstName: 'first_name', lastName: 'last_name', phone: 'phone', status: 'status', timezone: 'timezone' };
      const sets = [], vals = [];
      for (const key of allowed) {
        if (body[key] !== undefined) { sets.push(`${dbCols[key]} = ?`); vals.push(body[key]); }
      }
      if (sets.length === 0) return json({ ok: false, error: 'BAD_REQUEST', message: 'No updatable fields provided' }, 400, request);
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
        return json({ ok: true, accountId: params.account_id, status: 'updated' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Account update failed' }, 500, request);
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
        return json({ ok: true, accountId: params.account_id, status: 'archived' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Account archive failed' }, 500, request);
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
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401, request);
      try {
        const body = await parseBody(request);
        const { accountId, membershipId, planKey, status, stripeCustomerId } = body ?? {};
        if (!accountId || !membershipId || !planKey || !status) {
          return json({ ok: false, error: 'MISSING_FIELDS', message: 'accountId, membershipId, planKey, status are required' }, 400, request);
        }
        const validPlans = ['vlp_free', 'vlp_starter', 'vlp_advanced', 'vlp_scale'];
        if (!validPlans.includes(planKey)) {
          return json({ ok: false, error: 'VALIDATION', message: `planKey must be one of: ${validPlans.join(', ')}` }, 400, request);
        }
        const validStatuses = ['active', 'cancelled', 'past_due', 'pending', 'trialing'];
        if (!validStatuses.includes(status)) {
          return json({ ok: false, error: 'VALIDATION', message: `status must be one of: ${validStatuses.join(', ')}` }, 400, request);
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
        return json({ ok: true, membershipId, status: 'created' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Membership creation failed' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/memberships/by-account/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401, request);
      try {
        const rows = await env.DB.prepare(
          `SELECT * FROM memberships WHERE account_id = ? ORDER BY created_at DESC`
        ).bind(params.account_id).all();
        return json({ ok: true, membership: rows.results[0] ?? null }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch membership' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/memberships/:membership_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401, request);
      try {
        const row = await env.DB.prepare(
          `SELECT * FROM memberships WHERE membership_id = ?`
        ).bind(params.membership_id).first();
        if (!row) return json({ ok: false, error: 'NOT_FOUND', message: 'Membership not found' }, 404, request);
        return json({ ok: true, membership: row }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch membership' }, 500, request);
      }
    },
  },

  {
    method: 'PATCH', pattern: '/v1/memberships/:membership_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401, request);
      try {
        const body = await parseBody(request);
        const now = new Date().toISOString();
        const setClauses = ['updated_at = ?'];
        const vals = [now];
        const validPlans = ['vlp_free', 'vlp_starter', 'vlp_advanced', 'vlp_scale'];
        const validStatuses = ['active', 'cancelled', 'past_due', 'pending', 'trialing'];
        if (body?.planKey !== undefined) {
          if (!validPlans.includes(body.planKey)) return json({ ok: false, error: 'VALIDATION', message: `planKey must be one of: ${validPlans.join(', ')}` }, 400, request);
          setClauses.push('plan_key = ?'); vals.push(body.planKey);
        }
        if (body?.status !== undefined) {
          if (!validStatuses.includes(body.status)) return json({ ok: false, error: 'VALIDATION', message: `status must be one of: ${validStatuses.join(', ')}` }, 400, request);
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
        return json({ ok: true, membershipId: params.membership_id, status: 'updated' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Membership update failed' }, 500, request);
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
      }, 200, _request);
    },
  },

  {
    method: 'GET', pattern: '/v1/pricing',
    handler: async (_method, _pattern, _params, request, _env) => {
      return json({
        ok: true,
        pricing: {
          vlp_free:     { label: 'Free',     monthlyUsd: 0,      yearlyUsd: 0 },
          vlp_starter:  { label: 'Starter',  monthlyUsd: 4900,   yearlyUsd: 47900 },
          vlp_advanced: { label: 'Advanced', monthlyUsd: 9900,   yearlyUsd: 95900 },
          vlp_scale:    { label: 'Scale',    monthlyUsd: 19900,  yearlyUsd: 199000 },
        },
      }, 200, request);
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
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, email, eventId, fullName required' }, 400, request);
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
        return json({ ok: true, customerId, eventId, status: 'created' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502, request);
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
        if (!row) return json({ ok: true, methods: [], status: 'retrieved' }, 200, request);
        const stripeRes = await stripeGet(`/payment_methods?customer=${row.stripe_customer_id}&type=card`, env);
        return json({ ok: true, methods: stripeRes.data, status: 'retrieved' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502, request);
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
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, customerId, eventId, paymentMethodId, setDefault required' }, 400, request);
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
        return json({ ok: true, paymentMethodId, eventId, status: 'attached' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502, request);
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
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, customerId, eventId, usage required' }, 400, request);
      }
      if (usage !== 'off_session' && usage !== 'on_session') {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'usage must be off_session or on_session' }, 400, request);
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
        return json({ ok: true, setupIntentId, clientSecret: si.client_secret, eventId, status: 'created' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502, request);
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
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, amount, currency, customerId, eventId required' }, 400, request);
      }
      if (!Number.isInteger(amount) || amount < 1) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'amount must be integer >= 1' }, 400, request);
      }
      if (currency !== 'usd') {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'currency must be usd' }, 400, request);
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
        return json({ ok: true, paymentIntentId, clientSecret: pi.client_secret, eventId, status: 'created' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502, request);
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
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, billingInterval, customerId, eventId, membershipId, planKey, priceId, productId required' }, 400, request);
      }
      if (billingInterval !== 'monthly' && billingInterval !== 'yearly') {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'billingInterval must be monthly or yearly' }, 400, request);
      }
      if (!['vlp_free', 'vlp_starter', 'vlp_advanced', 'vlp_scale'].includes(planKey)) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'Invalid planKey' }, 400, request);
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
        return json({ ok: true, membershipId, subscriptionId, eventId, status: 'created' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502, request);
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
        return json({ ok: false, error: 'BAD_REQUEST', message: 'billingInterval, eventId, membershipId, planKey, priceId required' }, 400, request);
      }
      try {
        const row = await env.DB.prepare('SELECT * FROM memberships WHERE membership_id = ?').bind(params.membership_id).first();
        if (!row) return json({ ok: false, error: 'NOT_FOUND' }, 404, request);

        // GET current subscription from Stripe to find item ID
        const sub = await stripeGet(`/subscriptions/${row.stripe_subscription_id}`, env);
        const itemId = sub.items?.data?.[0]?.id;
        if (!itemId) return json({ ok: false, error: 'INTERNAL_ERROR', message: 'No subscription item found' }, 502, request);

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
        return json({ ok: true, membershipId: params.membership_id, eventId, status: 'updated' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502, request);
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
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, cancelAtPeriodEnd, eventId, membershipId required' }, 400, request);
      }
      try {
        const row = await env.DB.prepare('SELECT stripe_subscription_id FROM memberships WHERE membership_id = ?').bind(params.membership_id).first();
        if (!row) return json({ ok: false, error: 'NOT_FOUND' }, 404, request);

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
        return json({ ok: true, membershipId, eventId, status: 'cancelled' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502, request);
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
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, customerId, eventId, returnUrl required' }, 400, request);
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

        return json({ ok: true, url: portalUrl, eventId, status: 'created' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502, request);
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
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, amount, currency, eventId, quantity, tokenType required' }, 400, request);
      }
      if (tokenType !== 'tax_game' && tokenType !== 'transcript') {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'tokenType must be tax_game or transcript' }, 400, request);
      }
      if (currency !== 'usd') {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'currency must be usd' }, 400, request);
      }
      if (!Number.isInteger(quantity) || quantity < 1) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'quantity must be integer >= 1' }, 400, request);
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
        return json({ ok: true, accountId, eventId, status: 'purchased' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502, request);
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
        return json({ ok: true, receipts, status: 'retrieved' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Receipt listing failed' }, 500, request);
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
        return json({ ok: false, error: 'BAD_REQUEST', message: 'billingObject and planKey are required' }, 400, request);
      }
      if (planKey === 'vlp_free') {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'Free plan does not require checkout' }, 400, request);
      }

      const billingInterval = planKey.endsWith('_yearly') ? 'yearly' : 'monthly';
      const membershipId = `MEM_${crypto.randomUUID()}`;
      const pendingAccountId = `PENDING_${crypto.randomUUID()}`;
      const successUrl = `https://virtuallaunch.pro/onboarding?checkout=success&plan=${encodeURIComponent(planKey)}`;
      const cancelUrl = `https://virtuallaunch.pro/pricing`;
      const now = new Date().toISOString();

      try {
        // VLP plan price IDs live in the Virtual Launch Pro Stripe account.
        // Must use STRIPE_SECRET_KEY_VLP (not the TMP-account STRIPE_SECRET_KEY).
        const vlpSecretKey = env.STRIPE_SECRET_KEY_VLP;
        if (!vlpSecretKey) {
          return json({ ok: false, error: 'STRIPE_NOT_CONFIGURED', message: 'STRIPE_SECRET_KEY_VLP is not set' }, 503, request);
        }

        const sessionPayload = {
          mode: 'subscription',
          line_items: [{ price: billingObject, quantity: 1 }],
          success_url: successUrl,
          cancel_url: cancelUrl,
          allow_promotion_codes: 'true',
          metadata: { membership_id: membershipId, plan_key: planKey, billing_interval: billingInterval },
        };
        if (email) sessionPayload.customer_email = email;

        const stripeSession = await stripePost('/checkout/sessions', sessionPayload, env, vlpSecretKey);

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

        return json({ ok: true, url: stripeSession.url }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502, request);
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
        return json({ ok: false, error: 'BAD_REQUEST', message: 'accountId, billingInterval, cancelUrl, planKey, successUrl required' }, 400, request);
      }
      if (planKey === 'vlp_free') {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'Free plan does not require checkout' }, 400, request);
      }
      const priceId = getPriceId(planKey, billingInterval, env);
      if (!priceId) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'Invalid planKey or billingInterval' }, 400, request);
      }
      try {
        // VLP plan prices live in the Virtual Launch Pro Stripe account.
        const vlpSecretKey = env.STRIPE_SECRET_KEY_VLP;
        if (!vlpSecretKey) {
          return json({ ok: false, error: 'STRIPE_NOT_CONFIGURED', message: 'STRIPE_SECRET_KEY_VLP is not set' }, 503, request);
        }
        const membershipId = `MEM_${crypto.randomUUID()}`;
        const session = await stripePost('/checkout/sessions', {
          mode: 'subscription',
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: { account_id: accountId, membership_id: membershipId, plan_key: planKey, billing_interval: billingInterval },
        }, env, vlpSecretKey);
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
        return json({ ok: true, checkoutSessionId, status: 'created' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502, request);
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
      if (!sessionId) return json({ ok: false, error: 'BAD_REQUEST', message: 'sessionId required' }, 400, request);
      try {
        // VLP checkout sessions are created on the VLP Stripe account.
        const session = await stripeGet(`/checkout/sessions/${sessionId}`, env, env.STRIPE_SECRET_KEY_VLP);
        return json({
          ok: true,
          status: session.status,
          paymentStatus: session.payment_status,
          customerEmail: session.customer_details?.email,
        }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 502, request);
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
        return json({ ok: false, error: 'INVALID_SIGNATURE' }, 400, request);
      }

      // Reject stale webhooks (> 300 seconds)
      if (Math.floor(Date.now() / 1000) - parseInt(timestamp) > 300) {
        return json({ ok: false, error: 'INVALID_SIGNATURE' }, 400, request);
      }

      // Verify HMAC-SHA256 signature.
      // VLP routes webhooks from BOTH the TaxMonitor Pro account (TMP plans)
      // and the Virtual Launch Pro account (VLP plans, WLVLP, GVLP, TTTMP/TTMP
      // token packages, affiliates) to this same endpoint, so we accept either
      // signing secret.
      try {
        const enc = new TextEncoder();
        const candidateSecrets = [
          env.STRIPE_WEBHOOK_SECRET,
          env.STRIPE_WEBHOOK_SECRET_VLP,
        ].filter(Boolean);

        if (candidateSecrets.length === 0) {
          return json({ ok: false, error: 'INVALID_SIGNATURE' }, 400, request);
        }

        let isValid = false;
        for (const secret of candidateSecrets) {
          const key = await crypto.subtle.importKey(
            'raw', enc.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false, ['sign']
          );
          const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${rawBody}`));
          const expectedHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
          if (signatures.some(s => s === expectedHex)) {
            isValid = true;
            break;
          }
        }
        if (!isValid) return json({ ok: false, error: 'INVALID_SIGNATURE' }, 400, request);
      } catch {
        return json({ ok: false, error: 'INVALID_SIGNATURE' }, 400, request);
      }

      // Parse event
      let event;
      try {
        event = JSON.parse(rawBody);
      } catch {
        return json({ ok: true, received: true }, 200, request); // malformed but always 200
      }

      // Handle event — errors are logged, never returned to Stripe
      try {
        const obj = event.data?.object ?? {};
        const now = new Date().toISOString();

        switch (event.type) {

          case 'checkout.session.completed': {
            const { account_id, membership_id, plan_key, billing_interval, platform } = obj.metadata ?? {};

            // Handle TCVLP subscriptions
            if (platform === 'tcvlp' && account_id) {
              try {
                await d1Run(env.DB,
                  'UPDATE tcvlp_pros SET stripe_customer_id = ?, stripe_subscription_id = ?, status = ?, updated_at = ? WHERE account_id = ?',
                  [obj.customer, obj.subscription, 'active', now, account_id]
                );
              } catch (e) {
                console.error('TCVLP Stripe webhook error:', e);
              }
            }

            // Handle TMP membership activation
            if (platform === 'tmp' && plan_key) {
              try {
                // Reconcile anonymous checkout: look up or create account by Stripe email
                let tmpAccountId = account_id;
                if (!tmpAccountId || tmpAccountId === 'anonymous') {
                  const stripeEmail = obj.customer_details?.email || obj.customer_email || null;
                  if (!stripeEmail) {
                    console.error('TMP anonymous checkout missing Stripe email; cannot reconcile', obj.id);
                    break;
                  }
                  const emailLower = stripeEmail.toLowerCase();
                  const existing = await env.DB.prepare(
                    'SELECT account_id FROM accounts WHERE email = ?'
                  ).bind(emailLower).first();
                  if (existing?.account_id) {
                    tmpAccountId = existing.account_id;
                  } else {
                    tmpAccountId = `ACCT_${crypto.randomUUID()}`;
                    await d1Run(env.DB,
                      `INSERT INTO accounts (account_id, email, first_name, last_name, platform, role, status, created_at)
                       VALUES (?, ?, '', '', 'tmp', 'member', 'active', ?)
                       ON CONFLICT(email) DO NOTHING`,
                      [tmpAccountId, emailLower, now]
                    );
                    // Re-read in case ON CONFLICT raced
                    const row = await env.DB.prepare(
                      'SELECT account_id FROM accounts WHERE email = ?'
                    ).bind(emailLower).first();
                    if (row?.account_id) tmpAccountId = row.account_id;
                    await r2Put(env.R2_VIRTUAL_LAUNCH, `accounts_vlp/VLP_ACCT_${tmpAccountId}.json`, {
                      accountId: tmpAccountId, email: emailLower, firstName: '', lastName: '',
                      platform: 'tmp', role: 'member', status: 'active', createdAt: now, updatedAt: now,
                    });
                  }
                  console.log(`TMP anonymous checkout reconciled to account ${tmpAccountId} via ${emailLower}`);
                }

                const membershipId = `MEM_${crypto.randomUUID()}`;

                // Write receipt to R2
                await r2Put(env.R2_VIRTUAL_LAUNCH, `tmp/receipts/memberships/${tmpAccountId}/${now}.json`, {
                  event_type: 'membership_activated',
                  account_id: tmpAccountId,
                  plan_key,
                  membership_id: membershipId,
                  stripe_customer_id: obj.customer,
                  stripe_subscription_id: obj.subscription,
                  stripe_session_id: obj.id,
                  addon_mfj: obj.metadata?.addon_mfj === 'true',
                  timestamp: now
                });

                // Write canonical to R2
                await r2Put(env.R2_VIRTUAL_LAUNCH, `tmp/memberships/${tmpAccountId}.json`, {
                  membership_id: membershipId,
                  account_id: tmpAccountId,
                  plan_key,
                  status: 'active',
                  stripe_customer_id: obj.customer,
                  stripe_subscription_id: obj.subscription,
                  addon_mfj: obj.metadata?.addon_mfj === 'true',
                  created_at: now,
                  updated_at: now
                });

                // Upsert into memberships table
                await d1Run(env.DB,
                  `INSERT OR REPLACE INTO memberships
                   (membership_id, account_id, plan_key, status, stripe_customer_id, stripe_subscription_id, created_at, updated_at)
                   VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
                  [membershipId, tmpAccountId, plan_key, obj.customer, obj.subscription, now, now]
                );

                console.log(`TMP membership activated: ${tmpAccountId} -> ${plan_key}`);
              } catch (e) {
                console.error('TMP membership activation error:', e);
              }
            }

            // Handle WLVLP site purchase
            if (platform === 'wlvlp' && obj.metadata?.slug) {
              try {
                const slug = obj.metadata.slug;
                const tier = obj.metadata.tier;

                // Reconcile anonymous checkout: look up or create account by Stripe email
                let wlvlpAccountId = account_id;
                if (!wlvlpAccountId || wlvlpAccountId === 'anonymous') {
                  const stripeEmail = obj.customer_details?.email || obj.customer_email || null;
                  if (!stripeEmail) {
                    console.error('WLVLP anonymous checkout missing Stripe email; cannot reconcile', obj.id);
                    break;
                  }
                  const emailLower = stripeEmail.toLowerCase();
                  const existing = await env.DB.prepare(
                    'SELECT account_id FROM accounts WHERE email = ?'
                  ).bind(emailLower).first();
                  if (existing?.account_id) {
                    wlvlpAccountId = existing.account_id;
                  } else {
                    wlvlpAccountId = `ACCT_${crypto.randomUUID()}`;
                    await d1Run(env.DB,
                      `INSERT INTO accounts (account_id, email, first_name, last_name, platform, role, status, created_at)
                       VALUES (?, ?, '', '', 'wlvlp', 'member', 'active', ?)
                       ON CONFLICT(email) DO NOTHING`,
                      [wlvlpAccountId, emailLower, now]
                    );
                    const row = await env.DB.prepare(
                      'SELECT account_id FROM accounts WHERE email = ?'
                    ).bind(emailLower).first();
                    if (row?.account_id) wlvlpAccountId = row.account_id;
                    await r2Put(env.R2_VIRTUAL_LAUNCH, `accounts_vlp/VLP_ACCT_${wlvlpAccountId}.json`, {
                      accountId: wlvlpAccountId, email: emailLower, firstName: '', lastName: '',
                      platform: 'wlvlp', role: 'member', status: 'active', createdAt: now, updatedAt: now,
                    });
                  }
                  console.log(`WLVLP anonymous checkout reconciled to account ${wlvlpAccountId} via ${emailLower}`);
                }

                const purchasedAt = now;
                const hostingExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

                // Receipt to R2
                await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/wlvlp/purchase/${slug}.json`, {
                  event_type: 'wlvlp_purchase_completed',
                  account_id: wlvlpAccountId,
                  slug,
                  tier,
                  stripe_customer_id: obj.customer,
                  stripe_session_id: obj.id,
                  amount_paid: obj.amount_total,
                  purchased_at: purchasedAt
                });

                // Canonical site instance to R2
                await r2Put(env.R2_VIRTUAL_LAUNCH, `wlvlp/sites/${slug}.json`, {
                  owner: wlvlpAccountId,
                  slug,
                  tier,
                  status: 'active',
                  purchased_at: purchasedAt,
                  hosting_expires_at: hostingExpiresAt
                });

                // D1 projection — update template + purchase record (best-effort)
                try {
                  await env.DB.prepare(
                    "UPDATE wlvlp_templates SET status = 'sold', current_owner_id = ?, updated_at = ? WHERE slug = ?"
                  ).bind(wlvlpAccountId, purchasedAt, slug).run();
                } catch (_) {}

                try {
                  const purchaseId = `PUR_${crypto.randomUUID()}`;
                  await env.DB.prepare(
                    `INSERT INTO wlvlp_purchases
                     (purchase_id, account_id, slug, acquisition_type, monthly_price, stripe_customer_id, stripe_subscription_id, status, created_at, updated_at, tier, purchased_at, hosting_expires_at, stripe_session_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`
                  ).bind(purchaseId, wlvlpAccountId, slug, tier, Math.round((obj.amount_total || 0) / 100), obj.customer, obj.subscription || null, purchasedAt, purchasedAt, tier, purchasedAt, hostingExpiresAt, obj.id).run();
                } catch (_) {}

                console.log(`WLVLP purchase activated: ${wlvlpAccountId} -> ${slug} (${tier})`);

                // Post-purchase email notification (queue + immediate send)
                try {
                  const buyerEmail = obj.customer_details?.email || obj.customer_email || null;
                  const siteName = slug
                    .split('-')
                    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(' ');
                  const priceDollars = ((obj.amount_total || 0) / 100).toFixed(2);
                  const notifTimestamp = Date.now();

                  // 1) Queue notification in R2 (fallback / audit trail)
                  const notification = {
                    type: 'purchase_confirmation',
                    to: buyerEmail,
                    slug,
                    tier,
                    price: priceDollars,
                    site_name: siteName,
                    hosting_expires_at: hostingExpiresAt,
                    created_at: purchasedAt
                  };
                  await r2Put(
                    env.R2_VIRTUAL_LAUNCH,
                    `wlvlp/notifications/purchase-${slug}-${notifTimestamp}.json`,
                    notification
                  );

                  // 2) Immediate Gmail send via existing integration
                  if (buyerEmail) {
                    try {
                      const subject = `Your Website Lotto purchase: ${siteName}`;
                      const body = [
                        `Hi,`,
                        ``,
                        `Thanks for your purchase on Website Lotto VLP.`,
                        ``,
                        `Site: ${siteName}`,
                        `Tier: ${tier}`,
                        `Amount: $${priceDollars}`,
                        `Hosting active until: ${hostingExpiresAt}`,
                        ``,
                        `You can view your site here:`,
                        `https://websitelotto.virtuallaunch.pro/sites/${slug}/`,
                        ``,
                        `Manage your purchases at:`,
                        `https://websitelotto.virtuallaunch.pro/dashboard`,
                        ``,
                        `— Virtual Launch Pro`
                      ].join('\n');
                      await sendGmailMessage(env, buyerEmail, subject, body);
                      console.log(`WLVLP purchase email sent to ${buyerEmail} for ${slug}`);
                    } catch (mailErr) {
                      console.error('WLVLP purchase email send failed:', mailErr?.message || mailErr);
                    }
                  } else {
                    console.warn(`WLVLP purchase ${slug}: no buyer email; notification queued only`);
                  }
                } catch (notifErr) {
                  console.error('WLVLP purchase notification error:', notifErr);
                }
              } catch (e) {
                console.error('WLVLP purchase activation error:', e);
              }
            }

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

            // TOKEN PURCHASE CREDIT on checkout.session.completed
            const { type } = obj.metadata ?? {};
            if (type === 'token_purchase' && account_id) {
              try {
                // Extract price_id from line_items
                let price_id = null;
                if (obj.line_items?.data?.[0]?.price?.id) {
                  price_id = obj.line_items.data[0].price.id;
                } else {
                  // Fallback: lookup price from session.
                  // Token purchase price IDs (TTMP/TTTMP) live in the VLP Stripe account.
                  const sessionDetails = await fetch(`https://api.stripe.com/v1/checkout/sessions/${obj.id}?expand[]=line_items`, {
                    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY_VLP || env.STRIPE_SECRET_KEY}` }
                  });
                  if (sessionDetails.ok) {
                    const session = await sessionDetails.json();
                    price_id = session.line_items?.data?.[0]?.price?.id;
                  }
                }

                if (price_id) {
                  // Token purchase mapping
                  const TOKEN_PURCHASE_MAP = {
                    // TTTMP game tokens
                    [env.STRIPE_PRICE_TTTMP_30_TOKENS]:  { type: 'tax_game',   quantity: 30  },
                    [env.STRIPE_PRICE_TTTMP_80_TOKENS]:  { type: 'tax_game',   quantity: 80  },
                    [env.STRIPE_PRICE_TTTMP_200_TOKENS]: { type: 'tax_game',   quantity: 200 },
                    // TTMP transcript tokens
                    [env.STRIPE_PRICE_TTMP_10_TOKENS]:  { type: 'transcript', quantity: 10  },
                    [env.STRIPE_PRICE_TTMP_25_TOKENS]:  { type: 'transcript', quantity: 25  },
                    [env.STRIPE_PRICE_TTMP_100_TOKENS]: { type: 'transcript', quantity: 100 },
                  };

                  const purchaseInfo = TOKEN_PURCHASE_MAP[price_id];
                  if (purchaseInfo) {
                    const eventId = `EVT_${crypto.randomUUID()}`;

                    // Write receipt
                    await r2Put(env.R2_VIRTUAL_LAUNCH, `tokens/receipts/purchases/${account_id}/${Date.now()}.json`, {
                      event_id: eventId,
                      account_id: account_id,
                      price_id: price_id,
                      token_type: purchaseInfo.type,
                      quantity: purchaseInfo.quantity,
                      stripe_session_id: obj.id,
                      amount_paid: obj.amount_total,
                      created_at: now
                    });

                    // Credit the correct token type + quantity
                    if (purchaseInfo.type === 'tax_game') {
                      await d1Run(env.DB,
                        `INSERT INTO tokens (account_id, tax_game_tokens, transcript_tokens, updated_at)
                         VALUES (?, ?, 0, ?)
                         ON CONFLICT(account_id) DO UPDATE SET
                           tax_game_tokens = tax_game_tokens + ?,
                           updated_at = ?`,
                        [account_id, purchaseInfo.quantity, now, purchaseInfo.quantity, now]
                      );
                    } else if (purchaseInfo.type === 'transcript') {
                      await d1Run(env.DB,
                        `INSERT INTO tokens (account_id, tax_game_tokens, transcript_tokens, updated_at)
                         VALUES (?, 0, ?, ?)
                         ON CONFLICT(account_id) DO UPDATE SET
                           transcript_tokens = transcript_tokens + ?,
                           updated_at = ?`,
                        [account_id, purchaseInfo.quantity, now, purchaseInfo.quantity, now]
                      );
                    }
                  }
                }
              } catch (e) {
                console.error('Token purchase processing error:', e);
                // Don't fail the webhook - just log the error
              }
            }

            // SCALE attribution tracking - check if purchase is from SCALE prospect
            try {
              const customerEmail = obj.customer_details?.email ?? obj.customer_email ?? '';

              if (customerEmail) {
                // Read prospect index to check for SCALE attribution
                const prospectIndexObj = await env.R2_VIRTUAL_LAUNCH.get('vlp-scale/prospect-index.json');

                if (prospectIndexObj) {
                  const prospectIndex = await prospectIndexObj.json();
                  const slug = prospectIndex[customerEmail];

                  if (slug) {
                    // This purchase is attributable to SCALE - create purchase event
                    const eventId = event.id ?? crypto.randomUUID();
                    const amount = obj.amount_total ?? 0;
                    const currency = obj.currency ?? 'usd';

                    // Extract product name from line items
                    let productName = 'Unknown Product';
                    if (obj.line_items?.data?.[0]?.description) {
                      productName = obj.line_items.data[0].description;
                    } else if (obj.display_items?.[0]?.custom?.name) {
                      productName = obj.display_items[0].custom.name;
                    }

                    const purchaseEvent = {
                      slug: slug,
                      event_type: 'purchase',
                      stripe_event_id: event.id,
                      customer_email: customerEmail,
                      amount: amount,
                      currency: currency,
                      product: productName,
                      created_at: now
                    };

                    await r2Put(env.R2_VIRTUAL_LAUNCH, `vlp-scale/responses/${slug}/purchases/${eventId}.json`, purchaseEvent);
                    console.log(`[stripe-webhook] SCALE purchase attributed: ${customerEmail} -> ${slug}`);
                  }
                }
              }
            } catch (scaleError) {
              // SCALE attribution failure should not block normal Stripe webhook processing
              console.error('[stripe-webhook] SCALE attribution error:', scaleError.message);
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

            // Handle TCVLP subscription cancellation
            try {
              await d1Run(env.DB,
                'UPDATE tcvlp_pros SET status = ?, updated_at = ? WHERE stripe_subscription_id = ?',
                ['inactive', now, obj.id]
              );
            } catch (e) {
              console.error('TCVLP Stripe subscription deletion error:', e);
            }

            // Handle TMP subscription cancellation
            try {
              await d1Run(env.DB,
                'UPDATE memberships SET status = \'cancelled\', updated_at = ? WHERE stripe_subscription_id = ? AND plan_key LIKE \'tmp_%\'',
                [now, obj.id]
              );
            } catch (e) {
              console.error('TMP Stripe subscription deletion error:', e);
            }

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

            const accountId = customerRow?.account_id;

            await r2Put(env.R2_VIRTUAL_LAUNCH, `billing_invoices/${invoiceId}.json`, {
              invoiceId,
              accountId,
              amount: obj.amount_paid,
              currency: obj.currency,
              status: 'paid',
              paidAt: now,
            });

            // Process affiliate commission if account has a referrer
            if (accountId) {
              try {
                const accountRow = await env.DB.prepare('SELECT referred_by FROM accounts WHERE account_id = ?').bind(accountId).first();
                if (accountRow?.referred_by) {
                  const referrerAccountId = accountRow.referred_by;

                  // Calculate commission: 20% flat rate
                  const commissionAmount = Math.floor(obj.amount_paid * parseFloat(env.AFFILIATE_COMMISSION_RATE));

                  // Generate event_id
                  const eventId = `EVT_${crypto.randomUUID()}`;

                  // Detect platform from metadata or price/product mapping
                  const platform = obj.metadata?.platform || 'vlp'; // Default to vlp if not specified

                  // Write receipt
                  await r2Put(env.R2_VIRTUAL_LAUNCH, `affiliates/receipts/${eventId}.json`, {
                    event_id: eventId,
                    referrer_account_id: referrerAccountId,
                    referred_account_id: accountId,
                    stripe_invoice_id: invoiceId,
                    platform,
                    gross_amount: obj.amount_paid,
                    commission_amount: commissionAmount,
                    status: 'pending',
                    created_at: now
                  });

                  // Write event
                  await r2Put(env.R2_VIRTUAL_LAUNCH, `affiliate_events/${eventId}.json`, {
                    event_id: eventId,
                    referrer_account_id: referrerAccountId,
                    referred_account_id: accountId,
                    stripe_invoice_id: invoiceId,
                    platform,
                    gross_amount: obj.amount_paid,
                    commission_amount: commissionAmount,
                    status: 'pending',
                    created_at: now
                  });

                  // Insert into affiliate_events table
                  await d1Run(env.DB,
                    'INSERT INTO affiliate_events (event_id, referrer_account_id, referred_account_id, stripe_invoice_id, platform, gross_amount, commission_amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [eventId, referrerAccountId, accountId, invoiceId, platform, obj.amount_paid, commissionAmount, 'pending', now]
                  );

                  // Update affiliates balance_pending
                  await d1Run(env.DB,
                    'UPDATE affiliates SET balance_pending = balance_pending + ?, updated_at = ? WHERE account_id = ?',
                    [commissionAmount, now, referrerAccountId]
                  );

                  // Update R2 canonical affiliate record
                  const existingAffiliate = await env.R2_VIRTUAL_LAUNCH.get(`affiliates/${referrerAccountId}.json`);
                  if (existingAffiliate) {
                    const affiliateRecord = await existingAffiliate.json();
                    affiliateRecord.balance_pending = (affiliateRecord.balance_pending || 0) + commissionAmount;
                    affiliateRecord.updated_at = now;
                    await r2Put(env.R2_VIRTUAL_LAUNCH, `affiliates/${referrerAccountId}.json`, affiliateRecord);
                  }
                }
              } catch (e) {
                console.error('Affiliate commission processing error:', e);
                // Don't fail the webhook - just log the error
              }
            }

            // TOKEN GRANTS on invoice.paid (subscription renewals)
            // Process token grants after affiliate commission
            if (accountId) {
              try {
                // Get account's membership plan_key
                const membershipRow = await env.DB.prepare(
                  "SELECT plan_key FROM memberships WHERE account_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
                ).bind(accountId).first();

                if (membershipRow?.plan_key) {
                  // Token grant mapping
                  const TOKEN_GRANTS = {
                    'vlp_starter':   { tax_game: 30,  transcript: 30  },
                    'vlp_scale':     { tax_game: 120, transcript: 100 },
                    'vlp_advanced':  { tax_game: 300, transcript: 250 },
                    'tmp_essential': { tax_game: 5,   transcript: 2   },
                    'tmp_plus':      { tax_game: 15,  transcript: 5   },
                    'tmp_premier':   { tax_game: 40,  transcript: 10  },
                    'tmp_bronze':    { tax_game: 5,   transcript: 5   },
                    'tmp_silver':    { tax_game: 10,  transcript: 10  },
                    'tmp_gold':      { tax_game: 20,  transcript: 20  },
                    'tmp_snapshot':  { tax_game: 0,   transcript: 1   },
                  };

                  const grant = TOKEN_GRANTS[membershipRow.plan_key];
                  if (grant) {
                    const eventId = `EVT_${crypto.randomUUID()}`;

                    // Write receipt
                    await r2Put(env.R2_VIRTUAL_LAUNCH, `tokens/receipts/grants/${accountId}/${Date.now()}.json`, {
                      event_id: eventId,
                      account_id: accountId,
                      plan_key: membershipRow.plan_key,
                      tax_game_tokens_granted: grant.tax_game,
                      transcript_tokens_granted: grant.transcript,
                      stripe_invoice_id: invoiceId,
                      created_at: now
                    });

                    // Update or insert tokens record
                    await d1Run(env.DB,
                      `INSERT INTO tokens (account_id, tax_game_tokens, transcript_tokens, updated_at)
                       VALUES (?, ?, ?, ?)
                       ON CONFLICT(account_id) DO UPDATE SET
                         tax_game_tokens = tax_game_tokens + ?,
                         transcript_tokens = transcript_tokens + ?,
                         updated_at = ?`,
                      [accountId, grant.tax_game, grant.transcript, now,
                       grant.tax_game, grant.transcript, now]
                    );
                  }
                }
              } catch (e) {
                console.error('Token grant processing error:', e);
                // Don't fail the webhook - just log the error
              }
            }

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

      return json({ ok: true, received: true }, 200, request);
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
        if (!valid) return json({ ok: false, error: 'INVALID_SIGNATURE' }, 401, request);
      }
      let payload;
      try { payload = JSON.parse(rawBody); } catch { return json({ ok: false, error: 'INVALID_JSON' }, 400, request); }

      const eventType = payload?.triggerEvent ?? payload?.type ?? '';
      const now = new Date().toISOString();

      // SCALE attribution tracking - extract slug from booking URL and store event
      try {
        const bookingUrl = payload.payload?.bookingUrl ?? payload.payload?.bookingLink ?? '';
        let slug = 'unattributed';

        if (bookingUrl) {
          try {
            const url = new URL(bookingUrl);
            const slugParam = url.searchParams.get('slug');
            if (slugParam) {
              slug = slugParam;
            }
          } catch (e) {
            // If URL parsing fails, keep default slug
          }
        }

        // Extract booking details for SCALE tracking
        const attendeeEmail = payload.payload?.attendees?.[0]?.email ?? '';
        const attendeeName = payload.payload?.attendees?.[0]?.name ?? '';
        const bookingId = payload.payload?.uid ?? payload.payload?.id ?? crypto.randomUUID();
        const startTime = payload.payload?.startTime ?? '';
        const endTime = payload.payload?.endTime ?? '';

        // Write SCALE event to vlp-scale/responses/{slug}/bookings/{event_id}.json
        const scaleEvent = {
          slug: slug,
          event_type: eventType,
          booking_id: bookingId,
          attendee_email: attendeeEmail,
          attendee_name: attendeeName,
          start_time: startTime,
          end_time: endTime,
          created_at: now,
          raw_trigger: eventType
        };

        await r2Put(env.R2_VIRTUAL_LAUNCH, `vlp-scale/responses/${slug}/bookings/${bookingId}.json`, scaleEvent);
      } catch (scaleError) {
        // SCALE tracking failure should not block the main webhook processing
        console.error('[cal-webhook] SCALE tracking error:', scaleError.message);
      }

      // Continue with existing booking logic
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
      return json({ ok: true, received: true }, 200, request);
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
      return json({ ok: true, status: 'redirect_required', authorizationUrl: url.toString() }, 200, request);
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
      return json({ ok: true, status: 'redirect_required', authorizationUrl: url.toString() }, 200, request);
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

        return json({ ok: true, vlpConnected, proConnected }, 200, request);
      } catch {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to check Cal.com status' }, 500, request);
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
        return json({ ok: false, error: 'MISSING_FIELDS', message: 'professionalId, bookingType, scheduledAt, timezone required' }, 400, request);
      }
      const connectionId = `cal_${professionalId}`;
      const connObj = await env.R2_VIRTUAL_LAUNCH.get(`cal_connections/${connectionId}.json`);
      if (!connObj) return json({ ok: false, error: 'PROFESSIONAL_NOT_CONNECTED', message: 'Professional not connected to Cal.com' }, 422, request);
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
      return json({ ok: true, booking }, 201, request);
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
      return json({ ok: true, bookings: rows.results ?? [] }, 200, request);
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
      return json({ ok: true, bookings: rows.results ?? [] }, 200, request);
    },
  },

  {
    method: 'GET', pattern: '/v1/bookings/:booking_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const obj = await env.R2_VIRTUAL_LAUNCH.get(`bookings/${params.booking_id}.json`);
      if (!obj) return json({ ok: false, error: 'NOT_FOUND', message: 'Booking not found' }, 404, request);
      return json({ ok: true, booking: await obj.json() }, 200, request);
    },
  },

  {
    method: 'PATCH', pattern: '/v1/bookings/:booking_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      const obj = await env.R2_VIRTUAL_LAUNCH.get(`bookings/${params.booking_id}.json`);
      if (!obj) return json({ ok: false, error: 'NOT_FOUND', message: 'Booking not found' }, 404, request);
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
      return json({ ok: true, booking: updated }, 200, request);
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
        return json({ ok: false, error: 'MISSING_FIELDS', message: 'professionalId and displayName required' }, 400, request);
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
      return json({ ok: true, profile }, 201, request);
    },
  },

  {
    method: 'GET', pattern: '/v1/profiles/public/:professional_id',
    handler: async (_method, _pattern, params, _request, env) => {
      const obj = await env.R2_VIRTUAL_LAUNCH.get(`profiles/${params.professional_id}.json`);
      if (!obj) return json({ ok: false, error: 'NOT_FOUND', message: 'Profile not found' }, 404, _request);
      const { accountId: _accountId, ...publicProfile } = await obj.json();
      return json({ ok: true, profile: publicProfile }, 200, _request);
    },
  },

  {
    method: 'GET', pattern: '/v1/profiles/:professional_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const obj = await env.R2_VIRTUAL_LAUNCH.get(`profiles/${params.professional_id}.json`);
      if (!obj) return json({ ok: false, error: 'NOT_FOUND', message: 'Profile not found' }, 404, request);
      return json({ ok: true, profile: await obj.json() }, 200, request);
    },
  },

  {
    method: 'PATCH', pattern: '/v1/profiles/:professional_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return error;
      const body = await parseBody(request);
      const obj = await env.R2_VIRTUAL_LAUNCH.get(`profiles/${params.professional_id}.json`);
      if (!obj) return json({ ok: false, error: 'NOT_FOUND', message: 'Profile not found' }, 404, request);
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
      return json({ ok: true, profile: updated }, 200, request);
    },
  },

  // -------------------------------------------------------------------------
  // SUPPORT TICKETS
  // -------------------------------------------------------------------------

  {
    method: 'POST', pattern: '/v1/support/tickets',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401, request);
      try {
        const body = await parseBody(request);
        const { accountId, message, priority, subject, ticketId } = body ?? {};
        if (!accountId || !message || !priority || !subject || !ticketId) {
          return json({ ok: false, error: 'MISSING_FIELDS', message: 'accountId, message, priority, subject, ticketId are required' }, 400, request);
        }
        const validPriorities = ['high', 'low', 'normal', 'urgent'];
        if (!validPriorities.includes(priority)) {
          return json({ ok: false, error: 'VALIDATION', message: `priority must be one of: ${validPriorities.join(', ')}` }, 400, request);
        }
        if (subject.length > 255) return json({ ok: false, error: 'VALIDATION', message: 'subject max 255 chars' }, 400, request);
        if (message.length > 5000) return json({ ok: false, error: 'VALIDATION', message: 'message max 5000 chars' }, 400, request);
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
        return json({ ok: true, ticketId, status: 'created' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Support ticket creation failed' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/support/tickets/by-account/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401, request);
      try {
        const rows = await env.DB.prepare(
          `SELECT * FROM support_tickets WHERE account_id = ? ORDER BY created_at DESC`
        ).bind(params.account_id).all();
        return json({ ok: true, tickets: rows.results }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch tickets' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/support/tickets/:ticket_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401, request);
      try {
        const row = await env.DB.prepare(
          `SELECT * FROM support_tickets WHERE ticket_id = ?`
        ).bind(params.ticket_id).first();
        if (!row) return json({ ok: false, error: 'NOT_FOUND', message: 'Ticket not found' }, 404, request);
        return json({ ok: true, ticket: row }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch ticket' }, 500, request);
      }
    },
  },

  {
    method: 'PATCH', pattern: '/v1/support/tickets/:ticket_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401, request);
      try {
        const body = await parseBody(request);
        const now = new Date().toISOString();
        const setClauses = ['updated_at = ?'];
        const vals = [now];
        const validStatuses = ['closed', 'in_progress', 'open', 'reopened', 'resolved'];
        if (body?.message !== undefined) { setClauses.push('message = ?'); vals.push(body.message); }
        if (body?.status !== undefined) {
          if (!validStatuses.includes(body.status)) return json({ ok: false, error: 'VALIDATION', message: `status must be one of: ${validStatuses.join(', ')}` }, 400, request);
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
        return json({ ok: true, ticketId: params.ticket_id, status: 'updated' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Ticket update failed' }, 500, request);
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
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401, request);
      try {
        const body = await parseBody(request);
        const { accountId, message, notificationId, severity, title } = body ?? {};
        if (!accountId || !message || !notificationId || !severity || !title) {
          return json({ ok: false, error: 'MISSING_FIELDS', message: 'accountId, message, notificationId, severity, title are required' }, 400, request);
        }
        const validSeverities = ['error', 'info', 'success', 'warning'];
        if (!validSeverities.includes(severity)) {
          return json({ ok: false, error: 'VALIDATION', message: `severity must be one of: ${validSeverities.join(', ')}` }, 400, request);
        }
        const now = new Date().toISOString();
        await r2Put(env.R2_VIRTUAL_LAUNCH, `notifications/in-app/${notificationId}.json`, {
          notificationId, accountId, title, message, severity, read: false, createdAt: now,
        });
        await d1Run(env.DB,
          `INSERT INTO notifications (notification_id, account_id, title, message, severity, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`,
          [notificationId, accountId, title, message, severity, now]
        );
        return json({ ok: true, notificationId, status: 'created' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Notification creation failed' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/notifications/in-app',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401, request);
      try {
        const url = new URL(request.url);
        const accountId = url.searchParams.get('accountId');
        if (!accountId) return json({ ok: false, error: 'MISSING_FIELDS', message: 'accountId query param is required' }, 400, request);
        const limitParam = parseInt(url.searchParams.get('limit') ?? '20', 10);
        const limit = Math.min(isNaN(limitParam) ? 20 : limitParam, 100);
        const rows = await env.DB.prepare(
          `SELECT * FROM notifications WHERE account_id = ? ORDER BY created_at DESC LIMIT ?`
        ).bind(accountId, limit).all();
        return json({ ok: true, notifications: rows.results }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch notifications' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/notifications/preferences/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401, request);
      try {
        const row = await env.DB.prepare(
          `SELECT * FROM vlp_preferences WHERE account_id = ?`
        ).bind(params.account_id).first();
        if (!row) {
          return json({ ok: true, preferences: { accountId: params.account_id, inAppEnabled: true, smsEnabled: false } }, 200, request);
        }
        return json({ ok: true, preferences: {
          accountId: params.account_id,
          inAppEnabled: row.in_app_enabled === 1,
          smsEnabled: row.sms_enabled === 1,
        }}, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch notification preferences' }, 500, request);
      }
    },
  },

  {
    method: 'PATCH', pattern: '/v1/notifications/preferences/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401, request);
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
        return json({ ok: true, accountId: params.account_id, status: 'updated' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Notification preferences update failed' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/notifications/sms/send',
    handler: async (_method, _pattern, _params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401, request);
      try {
        const body = await parseBody(request);
        const { accountId, message, phone } = body ?? {};
        if (!accountId || !message || !phone) {
          return json({ ok: false, error: 'MISSING_FIELDS', message: 'accountId, message, phone are required' }, 400, request);
        }
        if (phone.length < 7) return json({ ok: false, error: 'VALIDATION', message: 'phone min 7 chars' }, 400, request);
        if (message.length > 1600) return json({ ok: false, error: 'VALIDATION', message: 'message max 1600 chars' }, 400, request);
        const prefs = await env.DB.prepare(
          `SELECT sms_enabled FROM vlp_preferences WHERE account_id = ?`
        ).bind(accountId).first();
        if (!prefs || prefs.sms_enabled === 0) {
          return json({ ok: false, error: 'SMS_DISABLED', message: 'SMS notifications are disabled for this account' }, 400, request);
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
        return json({ ok: true, accountId, status: 'queued' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'SMS queue failed' }, 500, request);
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
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401, request);
      try {
        const balance = await getCurrentTokenBalance(env, params.account_id);
        return json({
          ok: true,
          balance: {
            accountId: params.account_id,
            taxGameTokens: balance.taxGameTokens,
            transcriptTokens: balance.transcriptTokens,
            tax_game_tokens: balance.taxGameTokens,
            transcript_tokens: balance.transcriptTokens,
            updatedAt: balance.updatedAt,
          }
        }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch token balance' }, 500, request);
      }
    },
  },

  // -------------------------------------------------------------------------
  // TTTMP arcade — global token spend + play access check
  // Contracts: contracts/tttmp/tttmp.tokens.spend.v1.json
  //            contracts/tttmp/tttmp.games.access.v1.json
  // -------------------------------------------------------------------------

  {
    method: 'POST', pattern: '/v1/tokens/spend',
    handler: async (_method, _pattern, _params, request, env) => {
      // 1. Validate session
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      // 2. Parse and validate body against contract schema
      const body = await parseBody(request);
      if (!body || typeof body !== 'object') {
        return json({ ok: false, error: 'validation_failed', message: 'JSON body required' }, 400, request);
      }
      const { amount, idempotencyKey, reason, slug } = body;
      if (!Number.isInteger(amount) || amount < 1) {
        return json({ ok: false, error: 'validation_failed', message: 'amount must be integer >= 1' }, 400, request);
      }
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 1) {
        return json({ ok: false, error: 'validation_failed', message: 'idempotencyKey required' }, 400, request);
      }
      if (reason !== 'arcade_play') {
        return json({ ok: false, error: 'validation_failed', message: 'reason must be "arcade_play"' }, 400, request);
      }
      if (typeof slug !== 'string' || slug.length < 1) {
        return json({ ok: false, error: 'validation_failed', message: 'slug required' }, 400, request);
      }
      // Guard against path traversal in R2 keys
      if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(slug) || !/^[A-Za-z0-9_-]{1,128}$/.test(idempotencyKey)) {
        return json({ ok: false, error: 'validation_failed', message: 'invalid slug or idempotencyKey format' }, 400, request);
      }

      const receiptKey = `receipts/tttmp/tokens-spend/${idempotencyKey}.json`;

      try {
        // 3. Idempotency check — if receipt exists, return deduped response
        const existingReceipt = await r2Get(env.R2_VIRTUAL_LAUNCH, receiptKey);
        if (existingReceipt) {
          try {
            const parsed = JSON.parse(existingReceipt);
            // Only honor dedupe for the same account (prevent key reuse across users)
            if (parsed.account_id === session.account_id) {
              return json({ ok: true, deduped: true, grantId: parsed.grantId }, 200, request);
            }
            return json({ ok: false, error: 'validation_failed', message: 'idempotencyKey in use' }, 409, request);
          } catch {
            // Corrupt receipt — fall through and re-write
          }
        }

        // 4. Read current token balance from R2
        const balance = await getCurrentTokenBalance(env, session.account_id);

        // 5. Insufficient balance check
        if (balance.taxGameTokens < amount) {
          return json({ ok: false, error: 'insufficient_balance' }, 402, request);
        }

        // 6. Generate grant ID
        const grantId = `GRANT_${crypto.randomUUID()}`;
        const nowIso = new Date().toISOString();

        // 7. Write receipt to R2 (step 1 of write pipeline: receiptAppend)
        await r2Put(env.R2_VIRTUAL_LAUNCH, receiptKey, {
          account_id: session.account_id,
          slug,
          amount,
          grantId,
          reason,
          created_at: nowIso,
        });

        // 8. Write play grant to R2 (canonicalUpsert — overwrites any prior grant for this slug)
        await r2Put(env.R2_VIRTUAL_LAUNCH, `game-grants/${session.account_id}/${slug}.json`, {
          grantId,
          slug,
          account_id: session.account_id,
          created_at: nowIso,
          session_based: true,
        });

        // 9. Update token balance in R2
        const newTaxGame = balance.taxGameTokens - amount;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `tokens/${session.account_id}.json`, {
          account_id: session.account_id,
          tax_game_tokens: newTaxGame,
          transcript_tokens: balance.transcriptTokens,
          updated_at: nowIso,
        });

        // 10. Update D1 projection
        try {
          await d1Run(env.DB,
            `INSERT INTO tokens (account_id, tax_game_tokens, transcript_tokens, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(account_id) DO UPDATE SET tax_game_tokens = ?, updated_at = ?`,
            [session.account_id, newTaxGame, balance.transcriptTokens, nowIso, newTaxGame, nowIso]
          );
        } catch (e) {
          console.error('D1 tokens projection update failed:', e);
          // R2 is canonical — do not fail the request
        }

        // 11. Return success
        return json({ ok: true, grantId, slug }, 200, request);
      } catch (e) {
        console.error('/v1/tokens/spend error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to spend tokens' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/games/access',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const url = new URL(request.url);
      const slug = url.searchParams.get('slug');
      if (!slug || !/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(slug)) {
        return json({ ok: false, error: 'validation_failed', message: 'slug required' }, 400, request);
      }

      try {
        const grantRaw = await r2Get(env.R2_VIRTUAL_LAUNCH, `game-grants/${session.account_id}/${slug}.json`);
        if (!grantRaw) {
          return json({ ok: true, allowed: false }, 200, request);
        }
        const grant = JSON.parse(grantRaw);
        if (grant.session_based === true && grant.grantId) {
          return json({ ok: true, allowed: true, grantId: grant.grantId }, 200, request);
        }
        return json({ ok: true, allowed: false }, 200, request);
      } catch (e) {
        console.error('/v1/games/access error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to check game access' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/tokens/purchase',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const payload = await parseBody(request);
      if (!payload || typeof payload !== 'object') {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'JSON body required' }, 400, request);
      }

      const { price_id, token_type } = payload;
      if (!price_id || !token_type) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'Missing price_id or token_type' }, 400, request);
      }

      if (!['tax_game', 'transcript'].includes(token_type)) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'token_type must be tax_game or transcript' }, 400, request);
      }

      // Token purchase mapping
      const TOKEN_PURCHASE_MAP = {
        // TTTMP game tokens
        [env.STRIPE_PRICE_TTTMP_30_TOKENS]:  { type: 'tax_game',   quantity: 30  },
        [env.STRIPE_PRICE_TTTMP_80_TOKENS]:  { type: 'tax_game',   quantity: 80  },
        [env.STRIPE_PRICE_TTTMP_200_TOKENS]: { type: 'tax_game',   quantity: 200 },
        // TTMP transcript tokens
        [env.STRIPE_PRICE_TTMP_10_TOKENS]:  { type: 'transcript', quantity: 10  },
        [env.STRIPE_PRICE_TTMP_25_TOKENS]:  { type: 'transcript', quantity: 25  },
        [env.STRIPE_PRICE_TTMP_100_TOKENS]: { type: 'transcript', quantity: 100 },
      };

      const purchaseInfo = TOKEN_PURCHASE_MAP[price_id];
      if (!purchaseInfo) {
        return json({ ok: false, error: 'INVALID_PRICE_ID', message: 'Unknown price_id' }, 400, request);
      }

      if (purchaseInfo.type !== token_type) {
        return json({ ok: false, error: 'TOKEN_TYPE_MISMATCH', message: 'price_id does not match token_type' }, 400, request);
      }

      try {
        // TTMP/TTTMP token package prices live in the VLP Stripe account.
        const vlpSecretKey = env.STRIPE_SECRET_KEY_VLP;
        if (!vlpSecretKey) {
          return json({ ok: false, error: 'STRIPE_NOT_CONFIGURED', message: 'STRIPE_SECRET_KEY_VLP is not set' }, 503, request);
        }
        // Create Stripe Checkout session for one-time payment
        const checkoutSession = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${vlpSecretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            'mode': 'payment',
            'success_url': 'https://virtuallaunch.pro/dashboard/tokens?success=true',
            'cancel_url': 'https://virtuallaunch.pro/dashboard/tokens?cancelled=true',
            'client_reference_id': session.account_id,
            'line_items[0][price]': price_id,
            'line_items[0][quantity]': '1',
            'metadata[platform]': 'vlp',
            'metadata[type]': 'token_purchase',
            'metadata[account_id]': session.account_id,
            'metadata[token_type]': token_type,
          }),
        });

        if (!checkoutSession.ok) {
          const errorText = await checkoutSession.text();
          console.error('Stripe checkout session creation failed:', errorText);
          return json({ ok: false, error: 'STRIPE_ERROR', message: 'Failed to create checkout session' }, 500, request);
        }

        const sessionData = await checkoutSession.json();
        return json({ ok: true, session_url: sessionData.url }, 200, request);
      } catch (e) {
        console.error('Token purchase error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to create purchase session' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/tokens/pricing',
    handler: async (_method, _pattern, _params, _request, env) => {
      // No auth required - public pricing information
      return json({
        ok: true,
        packages: {
          transcript: [
            { price_id: env.STRIPE_PRICE_TTMP_10_TOKENS, quantity: 10, price_usd: 19, label: '10 Transcript Tokens' },
            { price_id: env.STRIPE_PRICE_TTMP_25_TOKENS, quantity: 25, price_usd: 29, label: '25 Transcript Tokens' },
            { price_id: env.STRIPE_PRICE_TTMP_100_TOKENS, quantity: 100, price_usd: 129, label: '100 Transcript Tokens' }
          ],
          tax_game: [
            { price_id: env.STRIPE_PRICE_TTTMP_30_TOKENS || 'price_1TGTiqQEa4WBi79guSRnECvw', quantity: 30, price_usd: 9, label: '30 Game Tokens' },
            { price_id: env.STRIPE_PRICE_TTTMP_80_TOKENS || 'price_1TGTiqQEa4WBi79gScrpsUab', quantity: 80, price_usd: 19, label: '80 Game Tokens' },
            { price_id: env.STRIPE_PRICE_TTTMP_200_TOKENS || 'price_1TGTiqQEa4WBi79gpTsbsLIi', quantity: 200, price_usd: 39, label: '200 Game Tokens' }
          ]
        }
      }, 200, _request);
    },
  },

  {
    method: 'GET', pattern: '/v1/tokens/usage/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401, request);
      try {
        const url = new URL(request.url);
        const limitParam = parseInt(url.searchParams.get('limit') ?? '50', 10);
        const limit = Math.min(isNaN(limitParam) ? 50 : limitParam, 100);
        const accountId = params.account_id;

        // Scan multiple receipt prefixes that touch the user's token balance:
        //   receipts/billing/        — purchases / subscription credits
        //   receipts/ttmp/consume/   — transcript token consumption
        //   receipts/ttmp/credit/    — manual credits
        //   receipts/tttmp/          — tax-game tool consumption
        const prefixes = [
          'receipts/billing/',
          'receipts/ttmp/consume/',
          'receipts/ttmp/credit/',
          'receipts/tttmp/',
        ];
        const billingTokenEvents = new Set(['TOKENS_PURCHASED', 'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_UPDATED', 'SUBSCRIPTION_RENEWED']);

        const collected = [];
        for (const prefix of prefixes) {
          const listResult = await env.R2_VIRTUAL_LAUNCH.list({ prefix, limit: 200 });
          const items = await Promise.all(
            (listResult.objects || []).map(async (obj) => {
              try {
                const item = await env.R2_VIRTUAL_LAUNCH.get(obj.key);
                if (!item) return null;
                const data = await item.json();
                const ownerId = data.account_id ?? data.accountId;
                if (ownerId !== accountId) return null;

                // Normalize into TokenUsageEntry shape
                if (prefix === 'receipts/billing/') {
                  if (!billingTokenEvents.has(data.event)) return null;
                  return {
                    eventId: data.event_id ?? data.eventId ?? obj.key,
                    accountId,
                    tokenType: 'transcript',
                    amount: data.transcript_tokens ?? data.tokens ?? 0,
                    action: (data.event || 'tokens_credited').toLowerCase(),
                    createdAt: data.created_at ?? data.createdAt ?? obj.uploaded?.toISOString?.() ?? '',
                  };
                }
                if (prefix === 'receipts/ttmp/consume/') {
                  return {
                    eventId: data.request_id ?? obj.key,
                    accountId,
                    tokenType: 'transcript',
                    amount: data.amount ?? 1,
                    action: data.action ?? 'token_consume',
                    createdAt: data.created_at ?? '',
                  };
                }
                if (prefix === 'receipts/ttmp/credit/') {
                  return {
                    eventId: data.request_id ?? obj.key,
                    accountId,
                    tokenType: 'transcript',
                    amount: data.amount ?? 0,
                    action: data.action ?? 'token_credit',
                    createdAt: data.created_at ?? '',
                  };
                }
                if (prefix === 'receipts/tttmp/') {
                  return {
                    eventId: data.event_id ?? data.eventId ?? obj.key,
                    accountId,
                    tokenType: 'tax_game',
                    amount: data.tokens_debited ?? data.amount ?? 1,
                    action: data.action ?? data.tool ?? 'tool_use',
                    createdAt: data.created_at ?? data.createdAt ?? '',
                  };
                }
                return null;
              } catch { return null; }
            })
          );
          for (const it of items) if (it) collected.push(it);
        }

        const usage = collected
          .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
          .slice(0, limit);

        return json({ ok: true, usage }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch token usage' }, 500, request);
      }
    },
  },

  // Token consumption for TTMP transcripts
  {
    method: 'POST', pattern: '/v1/tokens/consume',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const body = await parseBody(request);
      if (!body || typeof body !== 'object') {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'JSON body required' }, 400, request);
      }

      const required = ['account_id', 'amount', 'request_id'];
      for (const field of required) {
        if (!body[field]) {
          return json({ ok: false, error: 'VALIDATION_FAILED', message: `Missing required field: ${field}` }, 400, request);
        }
      }

      if (body.amount !== 1) {
        return json({ ok: false, error: 'VALIDATION_FAILED', message: 'amount must equal 1' }, 400, request);
      }

      if (body.account_id !== session.account_id) {
        return json({ ok: false, error: 'UNAUTHORIZED', message: 'account_id must match authenticated session' }, 403, request);
      }

      const requestId = body.request_id;
      const accountId = body.account_id;
      const nowIso = new Date().toISOString();

      // Dedupe check
      const dedupeKey = `receipts/ttmp/consume/${requestId}.json`;
      const existingReceipt = await env.R2_VIRTUAL_LAUNCH.get(dedupeKey);
      if (existingReceipt) {
        const receiptData = await existingReceipt.json();
        const currentBalance = await getCurrentTokenBalance(env, accountId);
        return json({
          ok: true,
          message: 'Duplicate request detected — returning cached response',
          balance_after: currentBalance.transcriptTokens,
          request_id: requestId
        }, 200, request);
      }

      // Check current balance
      const currentBalance = await getCurrentTokenBalance(env, accountId);
      if (currentBalance.transcriptTokens < 1) {
        return json({
          ok: false,
          error: 'insufficient_balance',
          balance: currentBalance.transcriptTokens,
          message: 'Insufficient transcript tokens'
        }, 400, request);
      }

      // Write pipeline: receipt → R2 canonical → D1 projection
      // 1. Receipt
      await r2Put(env.R2_VIRTUAL_LAUNCH, dedupeKey, {
        request_id: requestId,
        account_id: accountId,
        action: 'token_consume',
        amount: 1,
        balance_before: currentBalance.transcriptTokens,
        balance_after: currentBalance.transcriptTokens - 1,
        created_at: nowIso
      });

      // 2. Update canonical token balance in R2
      const newBalance = currentBalance.transcriptTokens - 1;
      await r2Put(env.R2_VIRTUAL_LAUNCH, `tokens/${accountId}.json`, {
        account_id: accountId,
        tax_game_tokens: currentBalance.taxGameTokens,
        transcript_tokens: newBalance,
        updated_at: nowIso
      });

      // 3. Update D1 projection
      await d1Run(env.DB,
        `INSERT OR REPLACE INTO tokens (account_id, tax_game_tokens, transcript_tokens, updated_at)
         VALUES (?, ?, ?, ?)`,
        [accountId, currentBalance.taxGameTokens, newBalance, nowIso]
      );

      return json({
        ok: true,
        balance_after: newBalance,
        request_id: requestId
      }, 200, request);
    },
  },

  // Token credit for TTMP purchases
  {
    method: 'POST', pattern: '/v1/tokens/credit',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const body = await parseBody(request);
      if (!body || typeof body !== 'object') {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'JSON body required' }, 400, request);
      }

      const required = ['account_id', 'amount', 'request_id', 'reason'];
      for (const field of required) {
        if (!body[field]) {
          return json({ ok: false, error: 'VALIDATION_FAILED', message: `Missing required field: ${field}` }, 400, request);
        }
      }

      if (typeof body.amount !== 'number' || body.amount <= 0) {
        return json({ ok: false, error: 'VALIDATION_FAILED', message: 'amount must be a positive number' }, 400, request);
      }

      const requestId = body.request_id;
      const accountId = body.account_id;
      const amount = body.amount;
      const reason = body.reason;
      const nowIso = new Date().toISOString();

      // Dedupe check
      const dedupeKey = `receipts/ttmp/credit/${requestId}.json`;
      const existingReceipt = await env.R2_VIRTUAL_LAUNCH.get(dedupeKey);
      if (existingReceipt) {
        const receiptData = await existingReceipt.json();
        const currentBalance = await getCurrentTokenBalance(env, accountId);
        return json({
          ok: true,
          message: 'Duplicate request detected — returning cached response',
          balance_after: currentBalance.transcriptTokens,
          request_id: requestId
        }, 200, request);
      }

      // Get current balance
      const currentBalance = await getCurrentTokenBalance(env, accountId);

      // Write pipeline: receipt → R2 canonical → D1 projection
      // 1. Receipt
      await r2Put(env.R2_VIRTUAL_LAUNCH, dedupeKey, {
        request_id: requestId,
        account_id: accountId,
        action: 'token_credit',
        amount: amount,
        reason: reason,
        balance_before: currentBalance.transcriptTokens,
        balance_after: currentBalance.transcriptTokens + amount,
        created_at: nowIso
      });

      // 2. Update canonical token balance in R2
      const newBalance = currentBalance.transcriptTokens + amount;
      await r2Put(env.R2_VIRTUAL_LAUNCH, `tokens/${accountId}.json`, {
        account_id: accountId,
        tax_game_tokens: currentBalance.taxGameTokens,
        transcript_tokens: newBalance,
        updated_at: nowIso
      });

      // 3. Update D1 projection
      await d1Run(env.DB,
        `INSERT OR REPLACE INTO tokens (account_id, tax_game_tokens, transcript_tokens, updated_at)
         VALUES (?, ?, ?, ?)`,
        [accountId, currentBalance.taxGameTokens, newBalance, nowIso]
      );

      return json({
        ok: true,
        balance_after: newBalance,
        request_id: requestId
      }, 200, request);
    },
  },

  // -------------------------------------------------------------------------
  // ADMIN
  // -------------------------------------------------------------------------

  {
    method: 'POST', pattern: '/v1/admin/tokens/grant',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env)
      if (error) return error

      // Only allow VLP admin accounts
      const adminEmails = ['jamie.williams@virtuallaunch.pro', 'hello@virtuallaunch.pro']
      if (!adminEmails.includes(session.email)) {
        return json({ ok: false, error: 'FORBIDDEN' }, 403, request)
      }

      const body = await parseBody(request)
      const { account_id, transcript_tokens, tax_game_tokens, reason } = body || {}

      if (!account_id || (transcript_tokens === undefined && tax_game_tokens === undefined)) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'account_id and at least one token type required' }, 400, request)
      }

      const nowIso = new Date().toISOString()

      // R2 canonical — read current, update, write back
      const current = await getCurrentTokenBalance(env, account_id)
      const newTranscript = transcript_tokens !== undefined
        ? current.transcriptTokens + parseInt(transcript_tokens)
        : current.transcriptTokens
      const newGame = tax_game_tokens !== undefined
        ? current.taxGameTokens + parseInt(tax_game_tokens)
        : current.taxGameTokens

      const newTokenData = {
        account_id,
        transcript_tokens: newTranscript,
        tax_game_tokens: newGame,
        updated_at: nowIso,
      }

      await r2Put(env.R2_VIRTUAL_LAUNCH, `tokens/${account_id}.json`, newTokenData)

      // D1 projection
      await d1Run(env.DB,
        `INSERT OR REPLACE INTO tokens (account_id, transcript_tokens, tax_game_tokens, updated_at) VALUES (?, ?, ?, ?)`,
        [account_id, newTranscript, newGame, nowIso]
      )

      // Receipt in R2
      await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/admin/token-grant-${crypto.randomUUID()}.json`, {
        account_id,
        granted_by: session.email,
        transcript_tokens_added: transcript_tokens || 0,
        tax_game_tokens_added: tax_game_tokens || 0,
        balance_after: newTokenData,
        reason: reason || 'manual grant',
        created_at: nowIso,
      })

      return json({
        ok: true,
        account_id,
        balance: {
          transcriptTokens: newTranscript,
          taxGameTokens: newGame,
        },
      }, 200, request)
    },
  },

  {
    method: 'GET', pattern: '/v1/admin/support/tickets',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env)
      if (error) return error

      const adminEmails = ['jamie.williams@virtuallaunch.pro', 'hello@virtuallaunch.pro']
      if (!adminEmails.includes((session.email || '').toLowerCase())) {
        return json({ ok: false, error: 'FORBIDDEN' }, 403, request)
      }

      try {
        const result = await env.DB.prepare(
          `SELECT t.ticket_id, t.account_id, t.subject, t.message, t.priority, t.status,
                  t.created_at, t.updated_at, a.email, a.platform
             FROM support_tickets t
             LEFT JOIN accounts a ON a.account_id = t.account_id
            ORDER BY t.created_at DESC
            LIMIT 100`
        ).all()
        return json({ ok: true, tickets: result.results || [] }, 200, request)
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 500, request)
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/admin/stats',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env)
      if (error) return error

      const adminEmails = ['jamie.williams@virtuallaunch.pro', 'hello@virtuallaunch.pro']
      if (!adminEmails.includes((session.email || '').toLowerCase())) {
        return json({ ok: false, error: 'FORBIDDEN' }, 403, request)
      }

      try {
        // Total accounts
        const accountsRow = await env.DB.prepare(
          `SELECT COUNT(*) AS total FROM accounts`
        ).first()

        // Active memberships grouped by plan_key
        const memRows = await env.DB.prepare(
          `SELECT plan_key, COUNT(*) AS count
             FROM memberships
            WHERE status = 'active'
            GROUP BY plan_key`
        ).all()

        // Token totals from D1 projection (R2 is authoritative but D1 mirrors it)
        const tokenRow = await env.DB.prepare(
          `SELECT
              COALESCE(SUM(transcript_tokens), 0) AS transcript_total,
              COALESCE(SUM(tax_game_tokens), 0)   AS tax_game_total,
              COUNT(*)                             AS holder_count
            FROM tokens`
        ).first()

        // Recent transactions — pulled from R2 receipts/billing/ prefix
        const recentTransactions = []
        try {
          const listResult = await env.R2_VIRTUAL_LAUNCH.list({
            prefix: 'receipts/billing/',
            limit: 100,
          })
          // Sort by uploaded desc and take 20
          const sorted = (listResult.objects || [])
            .slice()
            .sort((a, b) => new Date(b.uploaded).getTime() - new Date(a.uploaded).getTime())
            .slice(0, 20)
          const items = await Promise.all(sorted.map(async (obj) => {
            try {
              const r = await env.R2_VIRTUAL_LAUNCH.get(obj.key)
              if (!r) return null
              const data = await r.json()
              return {
                key: obj.key,
                uploaded: obj.uploaded,
                event_type: data.eventType || data.type || null,
                account_id: data.accountId || data.account_id || null,
                amount: data.amount || data.amount_total || null,
                currency: data.currency || null,
              }
            } catch { return null }
          }))
          recentTransactions.push(...items.filter(Boolean))
        } catch (e) {
          // R2 list failure shouldn't break stats
        }

        const membershipsByTier = {}
        for (const row of (memRows.results || [])) {
          membershipsByTier[row.plan_key] = row.count
        }

        return json({
          ok: true,
          stats: {
            total_accounts: accountsRow?.total || 0,
            memberships_by_tier: membershipsByTier,
            tokens: {
              transcript_total: tokenRow?.transcript_total || 0,
              tax_game_total: tokenRow?.tax_game_total || 0,
              holder_count: tokenRow?.holder_count || 0,
            },
            recent_transactions: recentTransactions,
          },
        }, 200, request)
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 500, request)
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/scale/dashboard',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env)
      if (error) return error

      // Only allow VLP admin accounts
      const adminEmails = ['jamie.williams@virtuallaunch.pro', 'hello@virtuallaunch.pro']
      if (!adminEmails.includes(session.email)) {
        return json({ ok: false, error: 'forbidden' }, 403, request)
      }

      const nowIso = new Date().toISOString()

      // Read existing R2 objects plus additional ones for expanded dashboard
      const [email1Obj, email2Obj, sendStateObj, batchHistoryObj, prospectsCSVObj, prospectIndexObj] = await Promise.all([
        env.R2_VIRTUAL_LAUNCH.get('vlp-scale/send-queue/email1-pending.json'),
        env.R2_VIRTUAL_LAUNCH.get('vlp-scale/send-queue/email2-pending.json'),
        env.R2_VIRTUAL_LAUNCH.get('vlp-scale/send-state.json'),
        env.R2_VIRTUAL_LAUNCH.get('vlp-scale/batch-history.json'),
        env.R2_VIRTUAL_LAUNCH.get('vlp-scale/prospects/master.csv'),
        env.R2_VIRTUAL_LAUNCH.get('vlp-scale/prospect-index.json')
      ])

      // Parse objects or use empty fallbacks
      let email1Queue = []
      let email2Queue = []
      let sendState = {}
      let batchHistory = []
      let prospectCount = 0
      let pipeline = null

      try {
        if (email1Obj) {
          email1Queue = await email1Obj.json()
        }
      } catch (e) {
        // If JSON parsing fails, use empty array
        email1Queue = []
      }

      try {
        if (email2Obj) {
          email2Queue = await email2Obj.json()
        }
      } catch (e) {
        // If JSON parsing fails, use empty array
        email2Queue = []
      }

      try {
        if (sendStateObj) {
          sendState = await sendStateObj.json()
        }
      } catch (e) {
        // If JSON parsing fails, use empty object
        sendState = {}
      }

      try {
        if (batchHistoryObj) {
          batchHistory = await batchHistoryObj.json()
        }
      } catch (e) {
        batchHistory = []
      }

      // Parse prospect index for count
      try {
        if (prospectIndexObj) {
          const prospectIndex = await prospectIndexObj.json()
          prospectCount = Object.keys(prospectIndex).length
        }
      } catch (e) {
        prospectCount = 0
      }

      // Parse CSV for pipeline stats
      try {
        if (prospectsCSVObj) {
          const csvText = await prospectsCSVObj.text()
          const lines = csvText.split('\n').filter(line => line.trim())

          if (lines.length > 1) { // Has header + data
            const header = lines[0].split(',').map(col => col.trim().replace(/"/g, ''))

            // Find column indices
            const emailFoundIdx = header.indexOf('email_found')
            const emailStatusIdx = header.indexOf('email_status')
            const email1PreparedIdx = header.indexOf('email_1_prepared_at')

            let total = 0
            let eligible = 0
            let exhausted = 0

            for (let i = 1; i < lines.length; i++) {
              const cols = lines[i].split(',').map(col => col.trim().replace(/"/g, ''))
              if (cols.length >= Math.max(emailFoundIdx, emailStatusIdx, email1PreparedIdx) + 1) {
                total++

                const emailFound = cols[emailFoundIdx] || ''
                const emailStatus = cols[emailStatusIdx] || ''
                const email1Prepared = cols[email1PreparedIdx] || ''

                if (email1Prepared) {
                  exhausted++
                } else if (emailFound && emailStatus !== 'invalid') {
                  eligible++
                }
              }
            }

            const daysRemaining = eligible > 0 ? Math.ceil(eligible / 50) : 0
            pipeline = { total, eligible, exhausted, days_remaining: daysRemaining }
          }
        }
      } catch (e) {
        // If CSV parsing fails, leave pipeline as null
        pipeline = null
      }

      // Aggregate responses from vlp-scale/responses/ prefix
      const responses = {
        bookings: { created: 0, cancelled: 0, rescheduled: 0, paid: 0, no_show: 0 },
        purchases: { count: 0, total_revenue: 0 }
      }

      try {
        const responsesList = await env.R2_VIRTUAL_LAUNCH.list({
          prefix: 'vlp-scale/responses/'
        })

        if (responsesList.objects) {
          for (const obj of responsesList.objects) {
            try {
              const responseObj = await env.R2_VIRTUAL_LAUNCH.get(obj.key)
              if (responseObj) {
                const data = await responseObj.json()

                if (obj.key.includes('/bookings/')) {
                  // Booking event
                  const eventType = data.event_type || data.raw_trigger || ''
                  if (eventType.includes('CREATED')) responses.bookings.created++
                  else if (eventType.includes('CANCELLED')) responses.bookings.cancelled++
                  else if (eventType.includes('RESCHEDULED')) responses.bookings.rescheduled++
                  else if (eventType.includes('PAID')) responses.bookings.paid++
                  else if (eventType.includes('NO_SHOW')) responses.bookings.no_show++
                } else if (obj.key.includes('/purchases/')) {
                  // Purchase event
                  responses.purchases.count++
                  if (data.amount) {
                    responses.purchases.total_revenue += data.amount
                  }
                }
              }
            } catch (e) {
              // Skip individual response files that fail to parse
              continue
            }
          }
        }
      } catch (e) {
        // If responses aggregation fails, use zeroed counts (already set above)
      }

      return json({
        email1_queue: email1Queue,
        email2_queue: email2Queue,
        send_state: sendState,
        batch_history: batchHistory,
        pipeline: pipeline,
        prospect_count: prospectCount,
        responses: responses,
        analytics: null,
        fetched_at: nowIso
      }, 200, request)
    },
  },

  {
    method: 'GET', pattern: '/v1/scale/analytics',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env)
      if (error) return error

      // Only allow VLP admin accounts
      const adminEmails = ['jamie.williams@virtuallaunch.pro', 'hello@virtuallaunch.pro']
      if (!adminEmails.includes(session.email)) {
        return json({ ok: false, error: 'forbidden' }, 403, request)
      }

      // Check CF_API_TOKEN is configured
      if (!env.CF_API_TOKEN) {
        return json({ error: 'CF_API_TOKEN not configured', ok: false }, 503, request)
      }

      const nowIso = new Date().toISOString()
      const accountId = 'b14e124b2f5dd7e86dfb1546f9ed6e91'

      // The 8 platform domains
      const domains = [
        'virtuallaunch.pro',
        'taxmonitor.pro',
        'transcript.taxmonitor.pro',
        'taxtools.taxmonitor.pro',
        'developers.virtuallaunch.pro',
        'games.virtuallaunch.pro',
        'taxclaim.virtuallaunch.pro',
        'websitelotto.virtuallaunch.pro'
      ]

      // Zone mapping for subdomains - they use parent zone IDs
      const zoneMapping = {
        'virtuallaunch.pro': null, // resolved via API
        'taxmonitor.pro': null, // resolved via API
        'transcript.taxmonitor.pro': 'taxmonitor.pro', // parent zone
        'taxtools.taxmonitor.pro': 'taxmonitor.pro',
        'developers.virtuallaunch.pro': 'virtuallaunch.pro',
        'games.virtuallaunch.pro': 'virtuallaunch.pro',
        'taxclaim.virtuallaunch.pro': 'virtuallaunch.pro',
        'websitelotto.virtuallaunch.pro': 'virtuallaunch.pro',
      }

      // Cache zone IDs in global variable for subsequent requests
      if (!globalThis.cfZoneIdCache) {
        globalThis.cfZoneIdCache = {}
      }

      const sites = []

      for (const domain of domains) {
        try {
          let zoneId = globalThis.cfZoneIdCache[domain]
          let zoneLookupDomain = zoneMapping[domain] || domain
          let isSubdomain = zoneMapping[domain] !== null

          // Resolve zone ID if not cached
          if (!zoneId) {
            const zoneResponse = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${zoneLookupDomain}`, {
              headers: {
                'Authorization': `Bearer ${env.CF_API_TOKEN}`,
                'Content-Type': 'application/json'
              }
            })

            if (zoneResponse.ok) {
              const zoneData = await zoneResponse.json()
              if (zoneData.result && zoneData.result.length > 0) {
                zoneId = zoneData.result[0].id
                globalThis.cfZoneIdCache[domain] = zoneId
              }
            }
          }

          if (!zoneId) {
            sites.push({
              domain: domain,
              zone_id: null,
              error: 'zone not found'
            })
            continue
          }

          // Query analytics for the last 30 days
          const endDate = new Date()
          const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000)

          const graphqlQuery = {
            query: `
              query($zoneTag: string, $since: string, $until: string, $hostname: string) {
                viewer {
                  zones(filter: { zoneTag: $zoneTag }) {
                    ${isSubdomain ? `
                    httpRequestsOverview: httpRequestsAdaptiveGroups(
                      filter: {
                        date_geq: $since,
                        date_leq: $until,
                        clientRequestHTTPHost: $hostname
                      }
                      limit: 1000
                    ) {
                      count
                      sum {
                        edgeResponseBytes
                      }
                      uniq {
                        uniques
                      }
                      dimensions {
                        date
                      }
                    }` : `
                    httpRequestsOverview: httpRequests1dGroups(
                      limit: 30
                      filter: {
                        date_geq: $since,
                        date_leq: $until
                      }
                    ) {
                      dimensions {
                        date
                      }
                      sum {
                        requests
                        pageViews
                        bytes
                      }
                      uniq {
                        uniques
                      }
                    }`}
                  }
                }
              }
            `,
            variables: {
              zoneTag: zoneId,
              since: startDate.toISOString().split('T')[0],
              until: endDate.toISOString().split('T')[0],
              ...(isSubdomain && { hostname: domain })
            }
          }

          const analyticsResponse = await fetch('https://api.cloudflare.com/client/v4/graphql', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.CF_API_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(graphqlQuery)
          })

          if (analyticsResponse.ok) {
            const analyticsData = await analyticsResponse.json()
            const zone = analyticsData.data?.viewer?.zones?.[0]

            if (zone && zone.httpRequestsOverview) {
              const dailyData = zone.httpRequestsOverview

              // Aggregate daily data into totals
              let totalPageViews = 0
              let totalUniqueVisitors = 0
              let totalBandwidth = 0

              for (const day of dailyData) {
                if (isSubdomain) {
                  // httpRequestsAdaptiveGroups structure
                  totalPageViews += day.count || 0 // Use count as proxy for page views
                  totalUniqueVisitors += day.uniq?.uniques || 0
                  totalBandwidth += day.sum?.edgeResponseBytes || 0
                } else {
                  // httpRequests1dGroups structure
                  totalPageViews += day.sum?.pageViews || 0
                  totalUniqueVisitors += day.uniq?.uniques || 0
                  totalBandwidth += day.sum?.bytes || 0
                }
              }

              sites.push({
                domain: domain,
                zone_id: zoneId,
                page_views: totalPageViews,
                unique_visitors: totalUniqueVisitors,
                bandwidth: totalBandwidth,
                top_pages: [] // Simplified - can add back later with proper query
              })
            } else {
              sites.push({
                domain: domain,
                zone_id: zoneId,
                error: 'no analytics data'
              })
            }
          } else {
            const errorText = await analyticsResponse.text()
            sites.push({
              domain: domain,
              zone_id: zoneId,
              error: 'analytics request failed'
            })
          }
        } catch (e) {
          sites.push({
            domain: domain,
            zone_id: null,
            error: 'processing error'
          })
        }
      }

      return json({
        period: 'last_30_days',
        domains: sites,
        fetched_at: nowIso
      }, 200, request)
    },
  },

  // -------------------------------------------------------------------------
  // VLP PREFERENCES
  // -------------------------------------------------------------------------

  {
    method: 'GET', pattern: '/v1/vlp/preferences/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401, request);
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
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch VLP preferences' }, 500, request);
      }
    },
  },

  {
    method: 'PATCH', pattern: '/v1/vlp/preferences/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { error } = await requireSession(request, env);
      if (error) return json({ ok: false, error: 'UNAUTHORIZED', message: error }, 401, request);
      try {
        const body = await parseBody(request);
        const now = new Date().toISOString();
        const validAppearances = ['dark', 'light', 'system'];
        if (body?.appearance !== undefined && !validAppearances.includes(body.appearance)) {
          return json({ ok: false, error: 'VALIDATION', message: `appearance must be one of: ${validAppearances.join(', ')}` }, 400, request);
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
        return json({ ok: true, accountId: params.account_id, status: 'updated' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'VLP preferences update failed' }, 500, request);
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
          return json({ ok: false, error: 'MISSING_FIELDS', message: 'inquiryId, firstName, lastName, email, phone are required' }, 400, request);
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
        return json({ ok: true, inquiryId, status: 'created' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Inquiry creation failed' }, 500, request);
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
        return json({ ok: true, inquiries }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch inquiries' }, 500, request);
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
        if (!obj) return json({ ok: false, error: 'NOT_FOUND', message: 'Inquiry not found' }, 404, request);
        const inquiry = await obj.json();
        return json({ ok: true, inquiry }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch inquiry' }, 500, request);
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
            return json({ ok: false, error: 'VALIDATION', message: `status must be one of: ${validStatuses.join(', ')}` }, 400, request);
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
        return json({ ok: true, inquiryId: params.inquiry_id, status: 'updated' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Inquiry update failed' }, 500, request);
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
          return json({ ok: false, error: 'MISSING_FIELDS', message: 'message is required' }, 400, request);
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
        return json({ ok: true, inquiryId: params.inquiry_id, status: 'responded' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Respond to inquiry failed' }, 500, request);
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
      return json({ ok: true, authorizationUrl: url.toString() }, 200, request);
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
        return json({ ok: true, connected }, 200, request);
      } catch {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to check Google status' }, 500, request);
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
          return json({ ok: false, error: 'NOT_CONNECTED', message: 'Google Calendar not connected' }, 400, request);
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
          return json({ ok: false, error: 'GOOGLE_API_ERROR', message: 'Failed to fetch Google Calendar events' }, 502, request);
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
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch Google Calendar events' }, 500, request);
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
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'JSON body required' }, 400, request);
      }

      if (!payload.account_id || !payload.form_data) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'Missing account_id or form_data' }, 400, request);
      }

      if (payload.account_id !== session.account_id) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'account_id must match authenticated session' }, 400, request);
      }

      if (!/^ACCT_[a-f0-9-]{36}$/.test(payload.account_id)) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'Invalid account_id format' }, 400, request);
      }

      // Check membership — form tools free with any paid subscription
      const membership = await env.DB.prepare(
        "SELECT status, plan_key FROM memberships WHERE account_id = ? AND status = 'active'"
      ).bind(session.account_id).first();

      if (!membership || membership.plan_key === 'free' || membership.plan_key === 'vlp_free') {
        return json({
          ok: false,
          error: 'SUBSCRIPTION_REQUIRED',
          message: 'An active paid subscription is required to use form tools.',
          upgrade_url: '/pricing'
        }, 402, request);
      }

      const { form_data: formData } = payload;
      if (!formData || typeof formData !== 'object') {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'form_data must be an object' }, 400, request);
      }
      if (!formData.taxpayer_name || !formData.taxpayer_ssn || !formData.representative_name) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'Missing required form fields' }, 400, request);
      }
      if (!/^\d{3}-\d{2}-\d{4}$/.test(formData.taxpayer_ssn)) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'Invalid SSN format (must be XXX-XX-XXXX)' }, 400, request);
      }

      const allowedPayloadFields = ['account_id', 'form_data'];
      const payloadExtraFields = Object.keys(payload).filter((k) => !allowedPayloadFields.includes(k));
      if (payloadExtraFields.length > 0) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: `Unexpected top-level fields: ${payloadExtraFields.join(', ')}` }, 400, request);
      }

      const allowedFormFields = ['taxpayer_name', 'taxpayer_ssn', 'representative_name', 'representative_caf', 'tax_matters'];
      const extraFields = Object.keys(formData).filter((k) => !allowedFormFields.includes(k));
      if (extraFields.length > 0) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: `Unexpected fields: ${extraFields.join(', ')}` }, 400, request);
      }

      if (formData.tax_matters !== undefined && !Array.isArray(formData.tax_matters)) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'tax_matters must be an array when provided' }, 400, request);
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

      // Form tools are free with paid subscription - no token consumption

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

      // Form tools don't consume tokens for paid subscribers

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


  // -------------------------------------------------------------------------
  // TTTMP — Transcript Parser Tool (Phase 1)
  // -------------------------------------------------------------------------

  {
    method: 'POST', pattern: '/v1/tools/transcript-parser',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      // Rate limit: 5 req/min per account
      const rlKey = `rl:transcript_parser:${session.account_id}`;
      const rlObj = await env.R2_VIRTUAL_LAUNCH.get(rlKey);
      if (rlObj) {
        const rlData = await rlObj.json();
        const windowStart = Date.now() - 60000;
        const recentHits = (rlData.hits || []).filter((t) => t > windowStart);
        if (recentHits.length >= 5) {
          return json({ ok: false, error: 'RATE_LIMIT_EXCEEDED', message: 'Maximum 5 transcript parses per minute' }, 429, request);
        }
        recentHits.push(Date.now());
        await r2Put(env.R2_VIRTUAL_LAUNCH, rlKey, { hits: recentHits });
      } else {
        await r2Put(env.R2_VIRTUAL_LAUNCH, rlKey, { hits: [Date.now()] });
      }

      const payload = await parseBody(request);
      if (!payload || typeof payload !== 'object') {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'JSON body required' }, 400, request);
      }

      if (!payload.account_id || !payload.transcript_data) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'Missing account_id or transcript_data' }, 400, request);
      }

      if (payload.account_id !== session.account_id) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'account_id must match authenticated session' }, 400, request);
      }

      if (!/^ACCT_[a-f0-9-]{36}$/.test(payload.account_id)) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'Invalid account_id format' }, 400, request);
      }

      // Whitelist top-level fields
      const allowedPayloadFields = ['account_id', 'transcript_data'];
      const payloadExtraFields = Object.keys(payload).filter((k) => !allowedPayloadFields.includes(k));
      if (payloadExtraFields.length > 0) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: `Unexpected top-level fields: ${payloadExtraFields.join(', ')}` }, 400, request);
      }

      const { transcript_data } = payload;
      if (!transcript_data || typeof transcript_data !== 'object') {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'transcript_data must be an object' }, 400, request);
      }
      if (!transcript_data.transcript_type || !transcript_data.transactions) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'Missing required transcript fields: transcript_type, transactions' }, 400, request);
      }

      const validTypes = ['account', 'return', 'wage_income', 'record_of_account'];
      if (!validTypes.includes(transcript_data.transcript_type)) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: `Invalid transcript_type. Must be one of: ${validTypes.join(', ')}` }, 400, request);
      }

      if (!Array.isArray(transcript_data.transactions) || transcript_data.transactions.length === 0) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'transactions must be a non-empty array' }, 400, request);
      }

      // Validate each transaction
      for (let i = 0; i < transcript_data.transactions.length; i++) {
        const t = transcript_data.transactions[i];
        if (!t || typeof t !== 'object') {
          return json({ ok: false, error: 'INVALID_PAYLOAD', message: `transactions[${i}] must be an object` }, 400, request);
        }
        if (t.code === undefined || t.date === undefined || t.amount === undefined) {
          return json({ ok: false, error: 'INVALID_PAYLOAD', message: `transactions[${i}] missing required fields: code, date, amount` }, 400, request);
        }
        if (!/^\d{3}$/.test(t.code)) {
          return json({ ok: false, error: 'INVALID_PAYLOAD', message: `transactions[${i}].code must be a 3-digit string` }, 400, request);
        }
        if (typeof t.amount !== 'number') {
          return json({ ok: false, error: 'INVALID_PAYLOAD', message: `transactions[${i}].amount must be a number` }, 400, request);
        }
      }

      // Dedupe check via SHA-256 hash of transcript_data
      const accountId = payload.account_id;
      const transcriptJson = JSON.stringify(transcript_data);
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(transcriptJson));
      const hashHex = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
      const dedupeKey = `${accountId}:${hashHex}`;

      const existingEvent = await env.DB.prepare(
        'SELECT session_id FROM tool_sessions WHERE account_id = ? AND tool = ? AND status = ? ORDER BY created_at DESC LIMIT 1'
      ).bind(accountId, 'transcript_parser', 'completed').first();

      // Check R2 for existing result with this dedupe key
      const dedupeCheckKey = `tttmp/dedupe/${dedupeKey}`;
      const existingDedupe = await env.R2_VIRTUAL_LAUNCH.get(dedupeCheckKey);
      if (existingDedupe) {
        const dedupeData = await existingDedupe.json();
        return json({
          ok: true,
          message: 'Duplicate transcript detected — returning cached result',
          original_event_id: dedupeData.event_id,
          result_url: `https://r2.virtuallaunch.pro/tttmp/tool_results/${accountId}/${dedupeData.event_id}.json`,
        });
      }

      // Token check (transcript_tokens, not tax_tool_tokens)
      const tokenRow = await env.DB.prepare(
        'SELECT transcript_tokens FROM tokens WHERE account_id = ?'
      ).bind(accountId).first();
      const tokensRemaining = tokenRow?.transcript_tokens || 0;
      if (tokensRemaining < 1) {
        return json({
          ok: false,
          error: 'INSUFFICIENT_TOKENS',
          tokens_remaining: tokensRemaining,
          upgrade_url: '/pricing'
        }, 402, request);
      }

      // --- Write pipeline ---
      const eventId = crypto.randomUUID();
      const nowIso = new Date().toISOString();

      // 1. Receipt
      const receipt = {
        event_id: eventId,
        account_id: accountId,
        dedupe_key: dedupeKey,
        tool_name: 'transcript_parser',
        created_at: nowIso,
        payload,
      };
      await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/tttmp/${accountId}/${eventId}.json`, receipt);

      // 2. Token deduction (transcript_tokens)
      await d1Run(
        env.DB,
        'UPDATE tokens SET transcript_tokens = transcript_tokens - 1, updated_at = ? WHERE account_id = ?',
        [nowIso, accountId]
      );

      const updatedTranscriptTokens = tokenRow.transcript_tokens - 1;
      await r2Put(env.R2_VIRTUAL_LAUNCH, `tokens/${accountId}.json`, {
        account_id: accountId,
        transcript_tokens: updatedTranscriptTokens,
        updated_at: nowIso,
      });

      // 3. Parse transcript
      const codesFound = [...new Set(transcript_data.transactions.map((t) => t.code))];
      let balanceOwed = 0;
      let refundAmount = 0;
      transcript_data.transactions.forEach((t) => {
        // Assessment/adjustment codes add to balance
        if (['150', '290', '300'].includes(t.code)) {
          balanceOwed += t.amount;
        }
        // Refund issued code
        if (t.code === '846') {
          refundAmount += Math.abs(t.amount);
        }
      });
      const parsedSummary = {
        total_transactions: transcript_data.transactions.length,
        codes_found: codesFound,
        balance_owed: Math.max(0, balanceOwed),
        refund_amount: refundAmount,
      };

      // 4. PII redaction + result storage
      const resultData = {
        event_id: eventId,
        transcript_type: transcript_data.transcript_type,
        parsed_summary: parsedSummary,
        transactions: transcript_data.transactions,
        created_at: nowIso,
      };
      // Redact SSN/EIN patterns from stored result
      const ssnPattern = /\d{3}-\d{2}-\d{4}/g;
      const einPattern = /\d{2}-\d{7}/g;
      let resultJson = JSON.stringify(resultData);
      resultJson = resultJson.replace(ssnPattern, 'XXX-XX-XXXX');
      resultJson = resultJson.replace(einPattern, 'XX-XXXXXXX');
      const redactedResult = JSON.parse(resultJson);

      const resultKey = `tttmp/tool_results/${accountId}/${eventId}.json`;
      await env.R2_VIRTUAL_LAUNCH.put(resultKey, JSON.stringify(redactedResult), {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          retention: '30-days',
          account_id: accountId,
          event_id: eventId,
        },
      });

      // 5. D1 index (tool_sessions table)
      await d1Run(
        env.DB,
        'INSERT INTO tool_sessions (session_id, account_id, tool, token_type, tokens_debited, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [eventId, accountId, 'transcript_parser', 'transcript', 1, 'completed', nowIso]
      );

      // Store dedupe marker
      await r2Put(env.R2_VIRTUAL_LAUNCH, dedupeCheckKey, { event_id: eventId, created_at: nowIso });

      return json({
        ok: true,
        event_id: eventId,
        status: 'completed',
        result_url: `https://r2.virtuallaunch.pro/tttmp/tool_results/${accountId}/${eventId}.json`,
        parsed_summary: parsedSummary,
        tokens_remaining: updatedTranscriptTokens,
        tokens_debited: 1,
        token_type: 'transcript',
      });
    },
  },

  // -------------------------------------------------------------------------
  // TRANSCRIPT UPLOAD — PDF → structured JSON (Phase 2 — TTTMP)
  // -------------------------------------------------------------------------

  {
    method: 'POST', pattern: '/v1/transcripts/upload',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      // Rate limit: 10 req/min per account
      const rlKey = `rl:transcript_upload:${session.account_id}`;
      const rlObj = await env.R2_VIRTUAL_LAUNCH.get(rlKey);
      if (rlObj) {
        const rlData = await rlObj.json();
        const windowStart = Date.now() - 60000;
        const recentHits = (rlData.hits || []).filter((t) => t > windowStart);
        if (recentHits.length >= 10) {
          return json({ ok: false, error: 'RATE_LIMIT_EXCEEDED', message: 'Maximum 10 transcript uploads per minute' }, 429, request);
        }
        recentHits.push(Date.now());
        await r2Put(env.R2_VIRTUAL_LAUNCH, rlKey, { hits: recentHits });
      } else {
        await r2Put(env.R2_VIRTUAL_LAUNCH, rlKey, { hits: [Date.now()] });
      }

      // Parse multipart/form-data
      let formData;
      try {
        formData = await request.formData();
      } catch {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'multipart/form-data required with a file field' }, 400, request);
      }

      const file = formData.get('file');
      if (!file || typeof file === 'string') {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'Missing file field — upload a PDF via multipart/form-data' }, 400, request);
      }

      // Validate file type
      if (file.type !== 'application/pdf' && !file.name?.toLowerCase().endsWith('.pdf')) {
        return json({ ok: false, error: 'INVALID_FILE_TYPE', message: 'Only PDF files are accepted' }, 400, request);
      }

      // Validate file size (5 MB max)
      const MAX_FILE_SIZE = 5 * 1024 * 1024;
      const fileBuffer = await file.arrayBuffer();
      if (fileBuffer.byteLength > MAX_FILE_SIZE) {
        return json({ ok: false, error: 'FILE_TOO_LARGE', message: 'PDF must be under 5 MB' }, 400, request);
      }
      if (fileBuffer.byteLength === 0) {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'Uploaded file is empty' }, 400, request);
      }

      // --- PDF text extraction (lightweight, Worker-compatible) ---
      // IRS transcripts are digitally generated PDFs with embedded text streams.
      // We extract text from PDF stream objects without a full PDF library.
      const pdfBytes = new Uint8Array(fileBuffer);
      const pdfText = extractTextFromPdf(pdfBytes);

      if (!pdfText || pdfText.trim().length < 20) {
        return json({
          ok: false, error: 'EXTRACTION_FAILED',
          message: 'Could not extract text from PDF. The file may be scanned/image-based. Please use a digitally generated IRS transcript.',
        }, 422, request);
      }

      // --- Detect transcript type ---
      const lowerText = pdfText.toLowerCase();
      let transcriptType = null;
      if (lowerText.includes('record of account') || lowerText.includes('record_of_account')) {
        transcriptType = 'record_of_account';
      } else if (lowerText.includes('wage and income') || lowerText.includes('wage & income')) {
        transcriptType = 'wage_income';
      } else if (lowerText.includes('return transcript') || lowerText.includes('tax return transcript')) {
        transcriptType = 'return';
      } else if (lowerText.includes('account transcript') || lowerText.includes('account information')) {
        transcriptType = 'account';
      }

      if (!transcriptType) {
        return json({
          ok: false, error: 'UNRECOGNIZED_TRANSCRIPT',
          message: 'Could not detect transcript type. Supported: Account, Return, Wage & Income, Record of Account.',
        }, 422, request);
      }

      // --- Extract transaction lines ---
      // IRS transcript transaction format:
      //   CODE  Description text  MM-DD-YYYY  $X,XXX.XX
      //   or:   CODE  Description text  MM-DD-YYYY  -$X,XXX.XX
      const transactions = [];
      const lines = pdfText.split('\n');
      // Pattern: 3-digit code at line start, followed by description, date, and amount
      const txPattern = /^\s*(\d{3})\s+.+?\s+(\d{2}[-/]\d{2}[-/]\d{4})\s+[-]?\$?([\d,]+\.?\d{0,2})/;
      // Alternate pattern: code and amount on same line without clear date
      const txPatternAlt = /^\s*(\d{3})\s+.+?\s+(\d{2}[-/]\d{2}[-/]\d{4})\s+([-]?[\d,]+\.?\d{0,2})/;

      for (const line of lines) {
        let match = line.match(txPattern);
        if (!match) match = line.match(txPatternAlt);
        if (!match) continue;

        const code = match[1];
        const rawDate = match[2].replace(/\//g, '-');
        const rawAmount = match[3].replace(/,/g, '');
        const amount = parseFloat(rawAmount);

        // Normalize date from MM-DD-YYYY to YYYY-MM-DD
        const dateParts = rawDate.split('-');
        let isoDate = rawDate;
        if (dateParts.length === 3 && dateParts[2].length === 4) {
          isoDate = `${dateParts[2]}-${dateParts[0]}-${dateParts[1]}`;
        }

        // Check for negative indicator on the line
        const isNegative = line.includes('-$') || (line.match(/\(\$?[\d,]+\.?\d*\)/) !== null);

        if (!isNaN(amount)) {
          transactions.push({
            code,
            date: isoDate,
            amount: isNegative && amount > 0 ? -amount : amount,
          });
        }
      }

      if (transactions.length === 0) {
        return json({
          ok: false, error: 'NO_TRANSACTIONS_FOUND',
          message: 'No IRS transaction codes found in the PDF. Ensure this is a valid IRS transcript with transaction lines.',
        }, 422, request);
      }

      // --- Dedupe check via SHA-256 of file content ---
      const hashBuffer = await crypto.subtle.digest('SHA-256', fileBuffer);
      const hashHex = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
      const dedupeKey = `${session.account_id}:${hashHex}`;
      const dedupeCheckKey = `tttmp/upload_dedupe/${dedupeKey}`;
      const existingDedupe = await env.R2_VIRTUAL_LAUNCH.get(dedupeCheckKey);
      if (existingDedupe) {
        const dedupeData = await existingDedupe.json();
        return json({
          ok: true,
          message: 'Duplicate PDF detected — returning cached extraction',
          original_job_id: dedupeData.job_id,
          extracted_data: dedupeData.extracted_data,
          preview: dedupeData.preview,
        });
      }

      // --- Build response data ---
      const dates = transactions.map((t) => t.date).filter(Boolean).sort();
      const codesFound = [...new Set(transactions.map((t) => t.code))];
      const dateRange = dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : 'unknown';

      const extractedData = {
        transcript_type: transcriptType,
        transactions,
      };

      const preview = {
        total_transactions: transactions.length,
        date_range: dateRange,
        codes_found: codesFound,
      };

      // --- Write pipeline (no token deduction — preview only) ---
      const nowIso = new Date().toISOString();
      const dateStamp = nowIso.slice(0, 10).replace(/-/g, '');
      const randomSuffix = crypto.randomUUID().slice(0, 8);
      const jobId = `JOB_${dateStamp}_${randomSuffix}`;
      const accountId = session.account_id;

      // 1. Receipt
      await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/tttmp/${accountId}/${jobId}.json`, {
        job_id: jobId,
        account_id: accountId,
        dedupe_key: dedupeKey,
        action: 'transcript_upload',
        file_name: file.name || 'transcript.pdf',
        file_size: fileBuffer.byteLength,
        file_hash: hashHex,
        transcript_type: transcriptType,
        transactions_found: transactions.length,
        created_at: nowIso,
      });

      // 2. Store uploaded PDF (24h TTL metadata — actual cleanup via R2 lifecycle rule)
      await env.R2_VIRTUAL_LAUNCH.put(`tttmp/uploads/${accountId}/${jobId}.pdf`, fileBuffer, {
        httpMetadata: { contentType: 'application/pdf' },
        customMetadata: {
          retention: '24-hours',
          account_id: accountId,
          job_id: jobId,
          uploaded_at: nowIso,
        },
      });

      // 3. Store extraction result
      await r2Put(env.R2_VIRTUAL_LAUNCH, `tttmp/extractions/${accountId}/${jobId}.json`, {
        job_id: jobId,
        account_id: accountId,
        extracted_data: extractedData,
        preview,
        created_at: nowIso,
      });

      // 4. Store dedupe marker
      await r2Put(env.R2_VIRTUAL_LAUNCH, dedupeCheckKey, {
        job_id: jobId,
        extracted_data: extractedData,
        preview,
        created_at: nowIso,
      });

      return json({
        ok: true,
        job_id: jobId,
        extracted_data: extractedData,
        preview,
      });
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
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'JSON body required' }, 400, request);
      }

      const required = ['eventId', 'transcriptText', 'transcriptType'];
      for (const field of required) {
        if (!body[field]) return json({ ok: false, error: 'VALIDATION_FAILED', message: `Missing required field: ${field}` }, 400, request);
      }
      const validTypes = ['account', 'record_of_account', 'return', 'wage_and_income'];
      if (!validTypes.includes(body.transcriptType)) {
        return json({ ok: false, error: 'VALIDATION_FAILED', message: `transcriptType must be one of: ${validTypes.join(', ')}` }, 400, request);
      }

      // Check transcript token balance
      const tokenRow = await env.DB.prepare(
        'SELECT transcript_tokens FROM tokens WHERE account_id = ?'
      ).bind(session.account_id).first();
      if (!tokenRow || tokenRow.transcript_tokens < 1) {
        return json({ ok: false, error: 'INSUFFICIENT_TOKENS', message: 'At least 1 transcript token required' }, 403, request);
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

      // 3. Update D1 — debit token, insert transcript job row
      await Promise.all([
        d1Run(env.DB,
          'UPDATE tokens SET transcript_tokens = transcript_tokens - 1, updated_at = ? WHERE account_id = ?',
          [now, session.account_id]
        ),
        d1Run(env.DB,
          'INSERT INTO transcript_jobs (job_id, account_id, transcript_type, tax_year, tokens_debited, status, result_key, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [jobId, session.account_id, body.transcriptType, body.taxYear ?? null, 1, 'completed', resultKey, now, now]
        ),
      ]);

      return json({ ok: true, jobId, status: 'completed', tokensDebited: 1, tokenType: 'transcript', result });
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
          return json({ ok: false, error: 'NOT_FOUND', message: 'Transcript job not found' }, 404, request);
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
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch transcript job' }, 500, request);
      }
    },
  },

  // -------------------------------------------------------------------------
  // TRANSCRIPT PARSER — HISTORY
  // -------------------------------------------------------------------------

  {
    method: 'GET', pattern: '/v1/tools/transcript-parser/history/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      // Authorization: account must match session
      if (params.account_id !== session.account_id) {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Account mismatch' }, 403, request);
      }

      try {
        const rows = await env.DB.prepare(
          'SELECT job_id, transcript_type, tax_year, status, created_at, completed_at FROM transcript_jobs WHERE account_id = ? ORDER BY created_at DESC LIMIT 100'
        ).bind(session.account_id).all();

        const jobs = (rows.results ?? []).map(row => ({
          job_id: row.job_id,
          transcript_type: row.transcript_type,
          tax_year: row.tax_year,
          status: row.status,
          created_at: row.created_at,
          completed_at: row.completed_at,
        }));

        return json({ ok: true, jobs });
      } catch {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch transcript history' }, 500, request);
      }
    },
  },

  // -------------------------------------------------------------------------
  // TTMP REPORT MANAGEMENT
  // -------------------------------------------------------------------------

  // Create report preview with token consumption
  {
    method: 'POST', pattern: '/v1/transcripts/preview',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const body = await parseBody(request);
      if (!body || typeof body !== 'object') {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'JSON body required' }, 400, request);
      }

      const required = ['report_data', 'event_id'];
      for (const field of required) {
        if (!body[field]) {
          return json({ ok: false, error: 'VALIDATION_FAILED', message: `Missing required field: ${field}` }, 400, request);
        }
      }

      const eventId = body.event_id;
      const reportData = body.report_data;
      const accountId = session.account_id;
      const nowIso = new Date().toISOString();

      // Check and consume 1 token
      const currentBalance = await getCurrentTokenBalance(env, accountId);
      if (currentBalance.transcriptTokens < 1) {
        return json({
          ok: false,
          error: 'insufficient_balance',
          balance: currentBalance.transcriptTokens,
          message: 'Insufficient transcript tokens'
        }, 400, request);
      }

      // Dedupe check for token consumption
      const consumeDedupeKey = `receipts/ttmp/consume/${eventId}.json`;
      const existingConsumeReceipt = await env.R2_VIRTUAL_LAUNCH.get(consumeDedupeKey);
      if (!existingConsumeReceipt) {
        // Consume token: receipt → R2 canonical → D1 projection
        await r2Put(env.R2_VIRTUAL_LAUNCH, consumeDedupeKey, {
          request_id: eventId,
          account_id: accountId,
          action: 'token_consume',
          amount: 1,
          balance_before: currentBalance.transcriptTokens,
          balance_after: currentBalance.transcriptTokens - 1,
          created_at: nowIso
        });

        const newBalance = currentBalance.transcriptTokens - 1;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `tokens/${accountId}.json`, {
          account_id: accountId,
          tax_game_tokens: currentBalance.taxGameTokens,
          transcript_tokens: newBalance,
          updated_at: nowIso
        });

        await d1Run(env.DB,
          `INSERT OR REPLACE INTO tokens (account_id, tax_game_tokens, transcript_tokens, updated_at)
           VALUES (?, ?, ?, ?)`,
          [accountId, currentBalance.taxGameTokens, newBalance, nowIso]
        );
      }

      const finalBalance = currentBalance.transcriptTokens - 1;

      // Generate report ID
      const dateStamp = nowIso.slice(0, 10).replace(/-/g, '');
      const randomSuffix = crypto.randomUUID().slice(0, 8);
      const reportId = `RPT_${dateStamp}_${randomSuffix}`;

      // Write pipeline: receipt → R2 canonical → D1 projection

      // 1. Store report in R2
      await r2Put(env.R2_VIRTUAL_LAUNCH, `ttmp/reports/${accountId}/${reportId}.json`, {
        report_id: reportId,
        account_id: accountId,
        report_data: reportData,
        event_id: eventId,
        created_at: nowIso,
        status: 'completed'
      });

      // 2. Store short link mapping in R2
      const reportUrl = `https://transcript.taxmonitor.pro/app/report?report_id=${reportId}`;
      await r2Put(env.R2_VIRTUAL_LAUNCH, `ttmp/report-links/${reportId}.json`, {
        report_id: reportId,
        account_id: accountId,
        short_url: `https://api.virtuallaunch.pro/v1/transcripts/report?r=${reportId}`,
        report_url: reportUrl,
        created_at: nowIso
      });

      // 3. Index report in D1
      await d1Run(env.DB,
        `INSERT INTO ttmp_reports (id, account_id, report_id, created_at, status, report_url, event_id, tokens_used)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [reportId, accountId, reportId, nowIso, 'completed', reportUrl, eventId, 1]
      );

      return json({
        ok: true,
        report_id: reportId,
        report_url: reportUrl,
        balance_after: finalBalance,
        event_id: eventId
      }, 200, request);
    },
  },

  // List reports for authenticated account
  {
    method: 'GET', pattern: '/v1/transcripts/reports',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const url = new URL(request.url);
      const limitParam = parseInt(url.searchParams.get('limit') ?? '25', 10);
      const limit = Math.min(isNaN(limitParam) ? 25 : limitParam, 100);
      const cursor = url.searchParams.get('cursor') || '';

      try {
        let sql = `SELECT report_id, created_at, status, report_url
                   FROM ttmp_reports
                   WHERE account_id = ?`;
        let params = [session.account_id];

        if (cursor) {
          sql += ` AND created_at < ?`;
          params.push(cursor);
        }

        sql += ` ORDER BY created_at DESC LIMIT ?`;
        params.push(limit + 1); // Get one extra to determine if there are more

        const rows = await env.DB.prepare(sql).bind(...params).all();
        const results = rows.results || [];

        let reports = results.slice(0, limit).map(row => ({
          report_id: row.report_id,
          created_at: row.created_at,
          status: row.status,
          report_url: row.report_url
        }));

        let nextCursor = null;
        if (results.length > limit) {
          nextCursor = results[limit - 1].created_at;
        }

        return json({
          ok: true,
          reports,
          cursor: nextCursor
        }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch reports' }, 500, request);
      }
    },
  },

  // Get report data payload
  {
    method: 'GET', pattern: '/v1/transcripts/report-data',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const url = new URL(request.url);
      const reportId = url.searchParams.get('report_id');
      if (!reportId) {
        return json({ ok: false, error: 'VALIDATION_FAILED', message: 'Missing report_id parameter' }, 400, request);
      }

      try {
        // Verify report belongs to authenticated account
        const row = await env.DB.prepare(
          `SELECT account_id, created_at FROM ttmp_reports WHERE report_id = ?`
        ).bind(reportId).first();

        if (!row) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Report not found' }, 404, request);
        }

        if (row.account_id !== session.account_id) {
          return json({ ok: false, error: 'UNAUTHORIZED', message: 'Report does not belong to authenticated account' }, 403, request);
        }

        // Fetch report payload from R2
        const reportObject = await env.R2_VIRTUAL_LAUNCH.get(`ttmp/reports/${session.account_id}/${reportId}.json`);
        if (!reportObject) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Report data not found in storage' }, 404, request);
        }

        const reportData = await reportObject.json();
        return json({
          ok: true,
          report_id: reportId,
          report_data: reportData.report_data,
          created_at: row.created_at
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch report data' }, 500, request);
      }
    },
  },

  // Generate or retrieve short link for report
  {
    method: 'POST', pattern: '/v1/transcripts/report-link',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const body = await parseBody(request);
      if (!body || typeof body !== 'object') {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'JSON body required' }, 400, request);
      }

      const reportId = body.report_id;
      if (!reportId) {
        return json({ ok: false, error: 'VALIDATION_FAILED', message: 'Missing report_id field' }, 400, request);
      }

      try {
        // Verify report belongs to authenticated account
        const row = await env.DB.prepare(
          `SELECT account_id FROM ttmp_reports WHERE report_id = ?`
        ).bind(reportId).first();

        if (!row) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Report not found' }, 404, request);
        }

        if (row.account_id !== session.account_id) {
          return json({ ok: false, error: 'UNAUTHORIZED', message: 'Report does not belong to authenticated account' }, 403, request);
        }

        // Check if short link already exists
        const linkObject = await env.R2_VIRTUAL_LAUNCH.get(`ttmp/report-links/${reportId}.json`);
        if (linkObject) {
          const linkData = await linkObject.json();
          return json({
            ok: true,
            report_id: reportId,
            short_url: linkData.short_url
          });
        }

        // Create new short link
        const shortUrl = `https://api.virtuallaunch.pro/v1/transcripts/report?r=${reportId}`;
        const reportUrl = `https://transcript.taxmonitor.pro/app/report?report_id=${reportId}`;

        await r2Put(env.R2_VIRTUAL_LAUNCH, `ttmp/report-links/${reportId}.json`, {
          report_id: reportId,
          account_id: session.account_id,
          short_url: shortUrl,
          report_url: reportUrl,
          created_at: new Date().toISOString()
        });

        return json({
          ok: true,
          report_id: reportId,
          short_url: shortUrl
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to generate report link' }, 500, request);
      }
    },
  },

  // Public short link resolution (no auth required)
  {
    method: 'GET', pattern: '/v1/transcripts/report',
    handler: async (_method, _pattern, _params, request, env) => {
      const url = new URL(request.url);
      const reportId = url.searchParams.get('r');
      if (!reportId) {
        return new Response('Missing report ID', { status: 400 });
      }

      try {
        // Check if short link exists
        const linkObject = await env.R2_VIRTUAL_LAUNCH.get(`ttmp/report-links/${reportId}.json`);
        if (!linkObject) {
          return new Response('Report not found', { status: 404 });
        }

        const linkData = await linkObject.json();
        // 302 redirect to report viewer URL
        return new Response('', {
          status: 302,
          headers: {
            'Location': linkData.report_url,
            ...getCorsHeaders(request)
          }
        });
      } catch (e) {
        return new Response('Internal server error', { status: 500 });
      }
    },
  },

  // Return actual report JSON for authenticated users
  {
    method: 'GET', pattern: '/v1/transcripts/report/data',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env)
      if (error) return error

      const url = new URL(request.url)
      const reportId = url.searchParams.get('r')
      if (!reportId) {
        return json({ ok: false, error: 'MISSING_PARAM', message: 'Missing report ID' }, 400, request)
      }

      try {
        const reportObj = await env.R2_VIRTUAL_LAUNCH.get(
          `ttmp/reports/${session.account_id}/${reportId}.json`
        )

        if (!reportObj) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Report not found' }, 404, request)
        }

        const reportData = await reportObj.json()
        return json({ ok: true, ...reportData }, 200, request)
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to load report' }, 500, request)
      }
    },
  },

  // -------------------------------------------------------------------------
  // TTMP EMAIL + PURCHASE HISTORY
  // -------------------------------------------------------------------------

  // Email report link to client
  {
    method: 'POST', pattern: '/v1/transcripts/report-email',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const body = await parseBody(request);
      if (!body || typeof body !== 'object') {
        return json({ ok: false, error: 'INVALID_PAYLOAD', message: 'JSON body required' }, 400, request);
      }

      const required = ['report_id', 'email', 'event_id'];
      for (const field of required) {
        if (!body[field]) {
          return json({ ok: false, error: 'VALIDATION_FAILED', message: `Missing required field: ${field}` }, 400, request);
        }
      }

      const reportId = body.report_id;
      const email = body.email;
      const eventId = body.event_id;

      try {
        // Verify report belongs to authenticated account
        const row = await env.DB.prepare(
          `SELECT account_id FROM ttmp_reports WHERE report_id = ?`
        ).bind(reportId).first();

        if (!row) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Report not found' }, 404, request);
        }

        if (row.account_id !== session.account_id) {
          return json({ ok: false, error: 'UNAUTHORIZED', message: 'Report does not belong to authenticated account' }, 403, request);
        }

        // Verify event_id matches a valid consume event by checking if report was generated with this event
        const reportRow = await env.DB.prepare(
          `SELECT event_id FROM ttmp_reports WHERE report_id = ? AND event_id = ?`
        ).bind(reportId, eventId).first();

        if (!reportRow) {
          return json({ ok: false, error: 'VALIDATION_FAILED', message: 'event_id does not match report generation event' }, 400, request);
        }

        // Get short URL for report
        const linkObject = await env.R2_VIRTUAL_LAUNCH.get(`ttmp/report-links/${reportId}.json`);
        if (!linkObject) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Report link not found' }, 404, request);
        }

        const linkData = await linkObject.json();
        const shortUrl = linkData.short_url;

        // Send email using Gmail API (following existing magic link email pattern)
        const emailSubject = 'Your Tax Transcript Analysis Report';
        const emailBody = `
Dear Client,

Your tax transcript analysis report is ready. Please click the link below to view your results:

${shortUrl}

This report was generated by your tax professional using Transcript Tax Monitor.

Best regards,
TTMP Support Team
        `.trim();

        try {
          // Use existing Gmail integration - check the magic link handler for pattern
          const gmailResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.GOOGLE_ACCESS_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              raw: btoa(
                `To: ${email}\r\n` +
                `Subject: ${emailSubject}\r\n` +
                `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
                emailBody
              ).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
            })
          });

          if (!gmailResponse.ok) {
            console.error('Gmail API error:', await gmailResponse.text());
            return json({ ok: false, error: 'EMAIL_SEND_FAILED', message: 'Failed to send report email' }, 500, request);
          }
        } catch (emailError) {
          console.error('Email send error:', emailError);
          return json({ ok: false, error: 'EMAIL_SEND_FAILED', message: 'Failed to send report email' }, 500, request);
        }

        // Write receipt to R2
        await r2Put(env.R2_VIRTUAL_LAUNCH, `ttmp/report-emails/${reportId}.json`, {
          report_id: reportId,
          account_id: session.account_id,
          email: email,
          event_id: eventId,
          short_url: shortUrl,
          sent_at: new Date().toISOString()
        });

        return json({
          ok: true,
          report_id: reportId,
          short_url: shortUrl
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to send report email' }, 500, request);
      }
    },
  },

  // List token purchase history for account
  {
    method: 'GET', pattern: '/v1/transcripts/purchases',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const url = new URL(request.url);
      const limitParam = parseInt(url.searchParams.get('limit') ?? '25', 10);
      const limit = Math.min(isNaN(limitParam) ? 25 : limitParam, 100);

      try {
        // Prefix scan for Stripe purchase receipts for this account
        const prefix = `receipts/stripe/${session.account_id}/`;
        const listResult = await env.R2_VIRTUAL_LAUNCH.list({ prefix, limit: 100 });

        const purchases = await Promise.all(
          listResult.objects.map(async (obj) => {
            try {
              const item = await env.R2_VIRTUAL_LAUNCH.get(obj.key);
              if (!item) return null;
              const data = await item.json();

              // Filter for completed purchases with token credits
              if (data.status !== 'completed' || !data.credits) return null;

              return {
                session_id: data.session_id || data.payment_intent_id,
                amount: data.amount,
                credits: data.credits,
                price_id: data.price_id,
                created_at: data.created_at,
                status: 'completed'
              };
            } catch (e) {
              console.error('Error processing purchase receipt:', e);
              return null;
            }
          })
        );

        // Filter out null values and sort by created_at descending
        const validPurchases = purchases
          .filter(Boolean)
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, limit);

        return json({
          ok: true,
          purchases: validPurchases
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch purchase history' }, 500, request);
      }
    },
  },

  // Public TTMP token package pricing (no auth required)
  {
    method: 'GET', pattern: '/v1/pricing/transcripts',
    handler: async (_method, _pattern, _params, request, env) => {
      try {
        // TTMP token package prices live in the VLP Stripe account.
        const vlpSecretKey = env.STRIPE_SECRET_KEY_VLP || env.STRIPE_SECRET_KEY;
        const stripeResponse = await fetch('https://api.stripe.com/v1/prices?active=true&type=one_time', {
          headers: {
            'Authorization': `Bearer ${vlpSecretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });

        if (!stripeResponse.ok) {
          return json({ ok: false, error: 'STRIPE_ERROR', message: 'Failed to fetch pricing from Stripe' }, 500, request);
        }

        const stripeData = await stripeResponse.json();

        // Map Stripe prices to TTMP token packages
        const tokenPackages = [
          { credits: 10, amount: 1900, recommended: false, label: 'Starter Package', perks: ['10 transcript analyses', 'Email delivery', 'Professional reports'] },
          { credits: 25, amount: 2900, recommended: true, label: 'Professional Package', perks: ['25 transcript analyses', 'Email delivery', 'Professional reports', 'Priority support'] },
          { credits: 100, amount: 12900, recommended: false, label: 'Enterprise Package', perks: ['100 transcript analyses', 'Email delivery', 'Professional reports', 'Priority support', 'Bulk processing'] }
        ];

        const prices = tokenPackages.map(pkg => {
          // Find matching Stripe price (simplified - in real implementation would match by metadata)
          const stripePrice = stripeData.data.find(p => p.unit_amount === pkg.amount);

          return {
            price_id: stripePrice?.id || `price_${pkg.credits}_tokens`,
            amount: pkg.amount,
            currency: 'usd',
            credits: pkg.credits,
            recommended: pkg.recommended,
            label: pkg.label,
            perks: pkg.perks
          };
        });

        return json({
          ok: true,
          prices
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch transcript pricing' }, 500, request);
      }
    },
  },

  // -------------------------------------------------------------------------
  // TTTMP (Tax Tools Arcade) Routes
  // -------------------------------------------------------------------------

  // TTTMP Auth Routes
  {
    method: 'POST', pattern: '/v1/tttmp/auth/magic-link/request',
    handler: async (_method, _pattern, _params, request, env) => {
      const body = await parseBody(request);
      if (!body?.email) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'email required' }, 400, request);
      }
      const { email, redirect } = body;
      try {
        const expMinutes = parseInt(env.MAGIC_LINK_EXPIRATION_MINUTES ?? '15', 10);
        const exp = Math.floor(Date.now() / 1000) + expMinutes * 60;
        const token = await signJwt({ email, redirect_uri: redirect || 'https://taxtools.taxmonitor.pro/', exp }, env.JWT_SECRET);

        // Store token in R2 with TTL
        const tokenData = { email, redirect_uri: redirect || 'https://taxtools.taxmonitor.pro/', created_at: new Date().toISOString() };
        await r2Put(env.R2_VIRTUAL_LAUNCH, `tttmp/auth/tokens/${token}.json`, tokenData);

        const link = `https://taxtools.taxmonitor.pro/v1/tttmp/auth/magic-link/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
        const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0f1e;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111827;border-radius:12px;border:1px solid #1f2937;overflow:hidden;">

        <!-- Header -->
        <tr><td style="background:#f59e0b;padding:24px 32px;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#000;">Tax Tools Arcade</p>
          <p style="margin:4px 0 0;font-size:13px;color:rgba(0,0,0,0.7);">Transcript automation for tax professionals</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f9fafb;">Your sign-in link</p>
          <p style="margin:0 0 24px;font-size:15px;color:#9ca3af;line-height:1.6;">Click the button below to sign in to your account. This link expires in 15 minutes and can only be used once.</p>

          <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr><td style="background:#f59e0b;border-radius:8px;">
              <a href="${link}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#000;text-decoration:none;">
                Sign In to Tax Tools Arcade →
              </a>
            </td></tr>
          </table>

          <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="margin:0;font-size:12px;color:#f59e0b;word-break:break-all;">${link}</p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 32px;border-top:1px solid #1f2937;">
          <p style="margin:0;font-size:12px;color:#4b5563;">If you didn't request this link, you can safely ignore this email. Your account is secure.</p>
          <p style="margin:8px 0 0;font-size:12px;color:#374151;">&copy; 2026 Lenore, Inc. &nbsp;·&nbsp; <a href="https://taxtools.taxmonitor.pro" style="color:#f59e0b;text-decoration:none;">taxtools.taxmonitor.pro</a></p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
        await sendEmail(email, 'Your Tax Tools Arcade sign-in link', emailHtml, env);

        const eventId = `EVT_${crypto.randomUUID()}`;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/tttmp/auth/${eventId}.json`, {
          email, requested_at: new Date().toISOString(), event: 'TTTMP_MAGIC_LINK_REQUESTED',
        });
        return json({ ok: true, status: 'requested', email }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Magic link request failed' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/tttmp/auth/magic-link/verify',
    handler: async (_method, _pattern, _params, request, env) => {
      const url = new URL(request.url);
      const token = url.searchParams.get('token');
      const email = url.searchParams.get('email');
      if (!token || !email) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'token and email required' }, 400, request);
      }
      try {
        const payload = await verifyJwt(token, env.JWT_SECRET);
        if (!payload) return json({ ok: false, error: 'INVALID_TOKEN' }, 401, request);
        if (payload.email !== email) return json({ ok: false, error: 'INVALID_TOKEN' }, 401, request);

        // Delete the token from R2 (one-time use)
        try {
          await env.R2_VIRTUAL_LAUNCH.delete(`tttmp/auth/tokens/${token}.json`);
        } catch {/* token may not exist */}

        const { accountId } = await upsertAccount(email, '', '', env);
        const { sessionId } = await createTttmpSession(accountId, email, env);

        return new Response(null, {
          status: 302,
          headers: {
            'Location': payload.redirect_uri || 'https://taxtools.taxmonitor.pro/',
            ...getCorsHeaders(request),
            'Set-Cookie': makeTttmpSessionCookie(sessionId, env),
          },
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Magic link verification failed' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/tttmp/auth/session',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireTttmpSession(request, env);
      if (error) return error;

      // Get token balance
      const balance = await getTokenBalance(session.account_id, env);

      return json({
        ok: true,
        user: {
          account_id: session.account_id,
          email: session.email,
          balance: balance.taxGameTokens,
        },
      });
    },
  },

  {
    method: 'POST', pattern: '/v1/tttmp/auth/logout',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireTttmpSession(request, env);
      if (error) return error;
      try {
        await d1Run(env.DB, 'DELETE FROM sessions WHERE session_id = ?', [session.session_id]);
        // Also delete from R2
        try {
          await env.R2_VIRTUAL_LAUNCH.delete(`tttmp/auth/sessions/${session.session_id}.json`);
        } catch {/* may not exist */}
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to delete session' }, 500, request);
      }
      return new Response(JSON.stringify({ ok: true, status: 'logged_out' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(request),
          'Set-Cookie': [
            'tttmp_session=',
            'Domain=' + (env.COOKIE_DOMAIN ?? '.taxmonitor.pro'),
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

  // TTTMP Checkout Routes
  {
    method: 'POST', pattern: '/v1/tttmp/checkout/sessions',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireTttmpSession(request, env);
      if (error) return error;

      const body = await parseBody(request);
      if (!body?.price_id) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'price_id required' }, 400, request);
      }

      const { price_id, success_url, cancel_url } = body;

      try {
        // Create Stripe checkout session
        const checkoutParams = {
          mode: 'payment',
          payment_method_types: ['card'],
          line_items: [{ price: price_id, quantity: 1 }],
          success_url: success_url || 'https://taxtools.taxmonitor.pro/checkout/success?session_id={CHECKOUT_SESSION_ID}',
          cancel_url: cancel_url || 'https://taxtools.taxmonitor.pro/checkout/cancel',
          metadata: {
            account_id: session.account_id,
            platform: 'tttmp'
          }
        };

        // TTTMP token package prices live in the VLP Stripe account.
        const checkoutSession = await stripePost('/checkout/sessions', checkoutParams, env, env.STRIPE_SECRET_KEY_VLP);

        // Store order in R2
        const orderData = {
          session_id: checkoutSession.id,
          account_id: session.account_id,
          price_id,
          created_at: new Date().toISOString(),
          status: 'pending'
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, `tttmp/orders/${checkoutSession.id}.json`, orderData);

        const eventId = `EVT_${crypto.randomUUID()}`;
        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/tttmp/checkout/${eventId}.json`, {
          account_id: session.account_id, price_id, session_id: checkoutSession.id,
          event: 'TTTMP_CHECKOUT_SESSION_CREATED', created_at: new Date().toISOString()
        });

        return json({
          ok: true,
          session_id: checkoutSession.id,
          checkout_url: checkoutSession.url
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to create checkout session' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/tttmp/checkout/status',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireTttmpSession(request, env);
      if (error) return error;

      const url = new URL(request.url);
      const sessionId = url.searchParams.get('session_id');
      if (!sessionId) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'session_id required' }, 400, request);
      }

      try {
        // Get Stripe session status (TTTMP sessions are on the VLP Stripe account)
        const stripeSession = await stripeGet(`/checkout/sessions/${sessionId}`, env, env.STRIPE_SECRET_KEY_VLP);
        if (stripeSession.metadata?.account_id !== session.account_id) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Session not found' }, 404, request);
        }

        let creditsAdded = 0;
        let newBalance = 0;

        if (stripeSession.payment_status === 'paid') {
          // Credit tokens based on price_id (this would need actual price mappings)
          // For now, using placeholder logic
          creditsAdded = 10; // Default, would map price_id to actual credits

          // Credit the tokens
          const tokenResult = await creditTokens(session.account_id, creditsAdded, 'tax_game', env);
          newBalance = tokenResult.newBalance;
        }

        return json({
          ok: true,
          status: stripeSession.payment_status,
          credits_added: creditsAdded,
          balance: newBalance
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to check checkout status' }, 500, request);
      }
    },
  },

  // TTTMP Game Access Routes — removed. Canonical routes are POST /v1/tokens/spend + GET /v1/games/access.

  // TTTMP Support Routes
  {
    method: 'POST', pattern: '/v1/tttmp/support/tickets',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireTttmpSession(request, env);
      if (error) return error;

      const body = await parseBody(request);
      if (!body?.subject || !body?.message) {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'subject and message required' }, 400, request);
      }

      const { subject, message, priority, category } = body;

      try {
        const ticketId = `TKT_${crypto.randomUUID()}`;
        const now = new Date().toISOString();

        // Create ticket with platform tag
        const ticketData = {
          ticket_id: ticketId,
          account_id: session.account_id,
          subject,
          message,
          priority: priority || 'medium',
          category: category || 'technical',
          platform: 'tttmp',
          status: 'open',
          created_at: now
        };

        // Store in R2
        await r2Put(env.R2_VIRTUAL_LAUNCH, `support_tickets/${ticketId}.json`, ticketData);

        // Store receipt
        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/tttmp/support/${ticketId}.json`, {
          account_id: session.account_id, subject, platform: 'tttmp',
          event: 'TTTMP_SUPPORT_TICKET_CREATED', created_at: now
        });

        // Store in D1
        await d1Run(env.DB,
          `INSERT INTO support_tickets (ticket_id, account_id, subject, message, priority, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)`,
          [ticketId, session.account_id, subject, message, priority || 'medium', now]
        );

        return json({ ok: true, ticket_id: ticketId, status: 'open' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to create support ticket' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/tttmp/support/tickets/:ticket_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireTttmpSession(request, env);
      if (error) return error;

      const { ticket_id } = params;

      try {
        // Get ticket from R2
        const ticketObj = await r2Get(env.R2_VIRTUAL_LAUNCH, `support_tickets/${ticket_id}.json`);

        if (!ticketObj) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Ticket not found' }, 404, request);
        }

        const ticket = JSON.parse(ticketObj);

        // Verify ownership
        if (ticket.account_id !== session.account_id) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Ticket not found' }, 404, request);
        }

        return json({
          ok: true,
          ticket_id: ticket.ticket_id,
          status: ticket.status,
          subject: ticket.subject,
          latest_update: ticket.message,
          updated_at: ticket.updated_at || ticket.created_at
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to retrieve support ticket' }, 500, request);
      }
    },
  },

  // TTTMP Token Balance Route
  {
    method: 'GET', pattern: '/v1/tttmp/tokens/balance',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireTttmpSession(request, env);
      if (error) return error;

      try {
        const balance = await getTokenBalance(session.account_id, env);
        return json({
          ok: true,
          balance: balance.taxGameTokens,
          account_id: session.account_id
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to get token balance' }, 500, request);
      }
    },
  },

  // TTTMP Health Check Route
  {
    method: 'GET', pattern: '/v1/tttmp/health',
    handler: async (_method, _pattern, _params, _request, _env) => {
      return json({
        ok: true,
        service: 'tttmp',
        timestamp: new Date().toISOString()
      });
    },
  },

  // -------------------------------------------------------------------------
  // TMP (Tax Monitor Pro) Routes
  // -------------------------------------------------------------------------

  {
    method: 'GET', pattern: '/v1/tmp/directory',
    handler: async (_method, _pattern, _params, request, env) => {
      // Parse query parameters
      const url = new URL(request.url);
      const specialty = url.searchParams.get('specialty') || null;
      const city = url.searchParams.get('city') || null;
      const state = url.searchParams.get('state') || null;
      const zip = url.searchParams.get('zip') || null;
      const page = Math.max(1, Math.min(100, parseInt(url.searchParams.get('page')) || 1));

      // Build query
      let query = `SELECT professional_id, display_name, bio, specialties, cal_booking_url, city, state, zip
                   FROM profiles
                   WHERE status = 'active'`;
      const params = [];

      // Filter by specialty if provided (case-insensitive)
      if (specialty) {
        query += ` AND LOWER(specialties) LIKE LOWER(?)`;
        params.push(`%${specialty}%`);
      }

      // Filter by city if provided (case-insensitive)
      if (city) {
        query += ` AND LOWER(city) LIKE LOWER(?)`;
        params.push(`%${city}%`);
      }

      // Filter by state if provided (case-insensitive)
      if (state) {
        query += ` AND LOWER(state) LIKE LOWER(?)`;
        params.push(`%${state}%`);
      }

      // Filter by zip if provided (case-insensitive)
      if (zip) {
        query += ` AND LOWER(zip) LIKE LOWER(?)`;
        params.push(`%${zip}%`);
      }

      // Pagination
      const limit = 20;
      const offset = (page - 1) * limit;
      query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      try {
        // Execute query
        const result = await env.DB.prepare(query).bind(...params).all();

        // Get total count for pagination
        let countQuery = `SELECT COUNT(*) as total FROM profiles WHERE status = 'active'`;
        const countParams = [];
        if (specialty) {
          countQuery += ` AND LOWER(specialties) LIKE LOWER(?)`;
          countParams.push(`%${specialty}%`);
        }
        if (city) {
          countQuery += ` AND LOWER(city) LIKE LOWER(?)`;
          countParams.push(`%${city}%`);
        }
        if (state) {
          countQuery += ` AND LOWER(state) LIKE LOWER(?)`;
          countParams.push(`%${state}%`);
        }
        if (zip) {
          countQuery += ` AND LOWER(zip) LIKE LOWER(?)`;
          countParams.push(`%${zip}%`);
        }
        const countResult = await env.DB.prepare(countQuery).bind(...countParams).first();
        const total = countResult?.total || 0;

        // Process results - truncate bio and remove account_id
        const professionals = result.results.map(prof => ({
          professional_id: prof.professional_id,
          display_name: prof.display_name,
          bio: prof.bio ? prof.bio.substring(0, 200) : null,
          specialties: prof.specialties,
          cal_booking_url: prof.cal_booking_url,
          city: prof.city,
          state: prof.state,
          zip: prof.zip
        }));

        return json({
          ok: true,
          professionals,
          page,
          total
        });
      } catch (error) {
        console.error('Directory listing error:', error);
        return json({
          ok: false,
          error: 'INTERNAL_ERROR',
          message: 'Internal server error'
        }, 500, request);
      }
    },
  },

  // GET /v1/tmp/pricing
  {
    method: 'GET', pattern: '/v1/tmp/pricing',
    handler: async (_method, _pattern, _params, request, env) => {
      try {
        return json({
          "ok": true,
          "plan_i": [
            { "key": "tmp_free",             "name": "Free",             "price": 0,   "interval": "month", "price_id": env.STRIPE_PRICE_TMP_FREE_MONTHLY,           "features": ["Basic monitoring", "Inquiry submission", "Directory access"] },
            { "key": "tmp_essential",        "name": "Essential",        "price": 9,   "interval": "month", "price_id": env.STRIPE_PRICE_TMP_ESSENTIAL_MONTHLY,      "features": ["5 tool tokens/mo", "2 transcript tokens/mo", "Email support"] },
            { "key": "tmp_essential_yearly", "name": "Essential Yearly", "price": 99,  "interval": "year",  "price_id": env.STRIPE_PRICE_TMP_ESSENTIAL_YEARLY,       "features": ["5 tool tokens/mo", "2 transcript tokens/mo", "Email support"] },
            { "key": "tmp_plus",             "name": "Plus",             "price": 19,  "interval": "month", "price_id": env.STRIPE_PRICE_TMP_PLUS_MONTHLY,           "features": ["15 tool tokens/mo", "5 transcript tokens/mo", "Priority support"] },
            { "key": "tmp_plus_yearly",      "name": "Plus Yearly",      "price": 199, "interval": "year",  "price_id": env.STRIPE_PRICE_TMP_PLUS_YEARLY,            "features": ["15 tool tokens/mo", "5 transcript tokens/mo", "Priority support"] },
            { "key": "tmp_premier",          "name": "Premier",          "price": 39,  "interval": "month", "price_id": env.STRIPE_PRICE_TMP_PREMIER_MONTHLY,        "features": ["40 tool tokens/mo", "10 transcript tokens/mo", "Dedicated support"] },
            { "key": "tmp_premier_yearly",   "name": "Premier Yearly",   "price": 399, "interval": "year",  "price_id": env.STRIPE_PRICE_TMP_PREMIER_YEARLY,         "features": ["40 tool tokens/mo", "10 transcript tokens/mo", "Dedicated support"] }
          ],
          "plan_ii": [
            { "key": "tmp_bronze",   "name": "Bronze",   "price": 275, "duration": "6 weeks",  "price_id": env.STRIPE_PRICE_TMP_BRONZE, "features": ["Active monitoring", "Tax pro assignment", "5+5 tokens"] },
            { "key": "tmp_silver",   "name": "Silver",   "price": 325, "duration": "8 weeks",  "price_id": env.STRIPE_PRICE_TMP_SILVER, "features": ["Active monitoring", "Tax pro assignment", "10+10 tokens"] },
            { "key": "tmp_gold",     "name": "Gold",     "price": 425, "duration": "12 weeks", "price_id": env.STRIPE_PRICE_TMP_GOLD, "features": ["Active monitoring", "Tax pro assignment", "20+20 tokens"] },
            { "key": "tmp_snapshot", "name": "Snapshot", "price": 425, "duration": "one-time", "price_id": env.STRIPE_PRICE_TMP_SNAPSHOT, "features": ["One-time transcript pull", "1 transcript token"] }
          ],
          "addons": [
            { "key": "tmp_mfj", "name": "MFJ Add-On", "price": 79, "price_id": env.STRIPE_PRICE_TMP_MFJ, "features": ["Married Filing Jointly spouse coverage"] }
          ]
        }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch pricing' }, 500, request);
      }
    },
  },

  // POST /v1/tmp/memberships/checkout
  // Allows anonymous checkout: if no session, Stripe collects email and webhook
  // creates/looks up the account on completion (reconciled by client_reference_id).
  {
    method: 'POST', pattern: '/v1/tmp/memberships/checkout',
    handler: async (_method, _pattern, _params, request, env) => {
      // Try to get session, but don't require it (anonymous checkout allowed)
      const session = await getSessionFromRequest(request, env);
      const accountId = session?.account_id || null;
      const sessionEmail = session?.email || null;

      try {
        const body = await request.json();
        const { plan_key, addon_mfj, email: bodyEmail } = body;

        // Validate plan_key
        const validPlans = [
          'tmp_free', 'tmp_essential', 'tmp_essential_yearly', 'tmp_plus', 'tmp_plus_yearly',
          'tmp_premier', 'tmp_premier_yearly', 'tmp_bronze', 'tmp_silver', 'tmp_gold', 'tmp_snapshot'
        ];

        if (!validPlans.includes(plan_key)) {
          return json({ ok: false, error: 'INVALID_PLAN', message: 'Invalid plan_key' }, 400, request);
        }

        // Map plan_key to Stripe price ID using wrangler.toml vars
        const TMP_PRICE_MAP = {
          'tmp_free':              env.STRIPE_PRICE_TMP_FREE_MONTHLY,
          'tmp_essential':         env.STRIPE_PRICE_TMP_ESSENTIAL_MONTHLY,
          'tmp_essential_yearly':  env.STRIPE_PRICE_TMP_ESSENTIAL_YEARLY,
          'tmp_plus':              env.STRIPE_PRICE_TMP_PLUS_MONTHLY,
          'tmp_plus_yearly':       env.STRIPE_PRICE_TMP_PLUS_YEARLY,
          'tmp_premier':           env.STRIPE_PRICE_TMP_PREMIER_MONTHLY,
          'tmp_premier_yearly':    env.STRIPE_PRICE_TMP_PREMIER_YEARLY,
          // Plan II — Monitoring Plans
          'tmp_bronze':   env.STRIPE_PRICE_TMP_BRONZE,
          'tmp_silver':   env.STRIPE_PRICE_TMP_SILVER,
          'tmp_gold':     env.STRIPE_PRICE_TMP_GOLD,
          'tmp_snapshot': env.STRIPE_PRICE_TMP_SNAPSHOT,
        };

        const stripe_price_id = TMP_PRICE_MAP[plan_key];
        if (!stripe_price_id) {
          return json({ ok: false, error: 'PLAN_NOT_AVAILABLE', message: 'This plan is not yet available for purchase.' }, 503, request);
        }

        // Create Stripe checkout session
        const customerEmail = sessionEmail || (typeof bodyEmail === 'string' ? bodyEmail.trim() : '') || null;
        const sessionData = {
          mode: plan_key === 'tmp_snapshot' ? 'payment' : 'subscription',
          line_items: [{ price: stripe_price_id, quantity: 1 }],
          success_url: 'https://virtuallaunch.pro/checkout/success?session_id={CHECKOUT_SESSION_ID}',
          cancel_url: 'https://virtuallaunch.pro/pricing',
          client_reference_id: accountId || 'anonymous',
          metadata: {
            platform: 'tmp',
            plan_key,
            account_id: accountId || 'anonymous',
            addon_mfj: addon_mfj ? 'true' : 'false'
          }
        };

        // Pass email if we have one; otherwise let Stripe Checkout collect it.
        if (customerEmail) {
          sessionData.customer_email = customerEmail;
        }

        // Add MFJ addon if requested
        if (addon_mfj && env.STRIPE_PRICE_TMP_MFJ) {
          sessionData.line_items.push({ price: env.STRIPE_PRICE_TMP_MFJ, quantity: 1 });
        }

        const checkout_session = await stripePost('/checkout/sessions', sessionData, env);

        return json({ ok: true, session_url: checkout_session.url }, 200, request);
      } catch (e) {
        console.error('TMP checkout error:', e?.message, e?.stack);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to create checkout session' }, 500, request);
      }
    },
  },

  // GET /v1/tmp/memberships/:account_id
  {
    method: 'GET', pattern: '/v1/tmp/memberships/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const accountId = params.account_id;

      try {
        const membership = await env.DB.prepare(
          "SELECT * FROM memberships WHERE account_id = ? AND plan_key LIKE 'tmp_%' ORDER BY created_at DESC LIMIT 1"
        ).bind(accountId).first();

        if (!membership) {
          return json({ ok: true, membership: null }, 200, request);
        }

        return json({
          ok: true,
          membership: {
            plan_key: membership.plan_key,
            status: membership.status,
            created_at: membership.created_at
          }
        }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch membership' }, 500, request);
      }
    },
  },

  // GET /v1/tmp/dashboard
  {
    method: 'GET', pattern: '/v1/tmp/dashboard',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      try {
        // Check for active TMP subscription
        const membership = await env.DB.prepare(
          "SELECT * FROM memberships WHERE account_id = ? AND plan_key LIKE 'tmp_%' AND status = 'active' ORDER BY created_at DESC LIMIT 1"
        ).bind(session.account_id).first();

        if (!membership) {
          return json({
            ok: false,
            error: 'SUBSCRIPTION_REQUIRED',
            upgrade_url: '/pricing'
          }, 402, request);
        }

        // Get account info
        const account = await env.DB.prepare(
          "SELECT * FROM accounts WHERE account_id = ?"
        ).bind(session.account_id).first();

        return json({
          ok: true,
          account: {
            account_id: account.account_id,
            email: account.email,
            first_name: account.first_name,
            last_name: account.last_name
          },
          membership: {
            plan_key: membership.plan_key,
            status: membership.status,
            created_at: membership.created_at
          }
        }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch dashboard' }, 500, request);
      }
    },
  },

  // GET /v1/tmp/monitoring/status
  {
    method: 'GET', pattern: '/v1/tmp/monitoring/status',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      try {
        // Check membership is Plan II (tmp_bronze, tmp_silver, tmp_gold, tmp_snapshot)
        const membership = await env.DB.prepare(
          "SELECT * FROM memberships WHERE account_id = ? AND plan_key IN ('tmp_bronze', 'tmp_silver', 'tmp_gold', 'tmp_snapshot') AND status = 'active' ORDER BY created_at DESC LIMIT 1"
        ).bind(session.account_id).first();

        if (!membership) {
          return json({
            ok: false,
            error: 'PLAN_II_REQUIRED',
            upgrade_url: '/pricing'
          }, 402, request);
        }

        // Get compliance status
        const status = await env.DB.prepare(
          "SELECT * FROM compliance_status WHERE account_id = ?"
        ).bind(session.account_id).first();

        return json({
          ok: true,
          monitoring_status: {
            phase: status?.phase || 'intake',
            intake_complete: status?.intake_complete || 0,
            processing_complete: status?.processing_complete || 0,
            assigned_professional_id: status?.assigned_professional_id || null,
            current_step: status?.current_step || null,
            step_status: status?.step_status || 'pending'
          },
          membership_plan: membership.plan_key
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch monitoring status' }, 500, request);
      }
    },
  },

  // -------------------------------------------------------------------------
  // VLP Account Preferences Routes
  // -------------------------------------------------------------------------

  {
    method: 'GET', pattern: '/v1/accounts/preferences/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const accountId = params.account_id;

      try {
        const row = await env.DB.prepare(
          "SELECT * FROM vlp_preferences WHERE account_id = ?"
        ).bind(accountId).first();

        if (!row) {
          // Return defaults if no row exists
          const defaults = {
            appearance: 'system',
            timezone: null,
            default_dashboard: null,
            accent_color: null,
            in_app_enabled: 1,
            sms_enabled: 0
          };
          return json({ ok: true, preferences: defaults }, 200, request);
        }

        return json({
          ok: true,
          preferences: {
            appearance: row.appearance,
            timezone: row.timezone,
            default_dashboard: row.default_dashboard,
            accent_color: row.accent_color,
            in_app_enabled: row.in_app_enabled,
            sms_enabled: row.sms_enabled
          }
        }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to get preferences' }, 500, request);
      }
    },
  },

  {
    method: 'PATCH', pattern: '/v1/accounts/preferences/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const accountId = params.account_id;

      try {
        const body = await request.json();
        const { appearance, timezone, default_dashboard, accent_color, in_app_enabled, sms_enabled } = body;

        const timestamp = new Date().toISOString();

        // Write receipt to R2
        const receiptKey = `receipts/preferences/${accountId}/${timestamp}.json`;
        await env.R2_VIRTUAL_LAUNCH.put(receiptKey, JSON.stringify({
          account_id: accountId,
          appearance,
          timezone,
          default_dashboard,
          accent_color,
          in_app_enabled,
          sms_enabled,
          timestamp
        }));

        // Write canonical to R2
        const canonicalKey = `accounts/${accountId}/preferences.json`;
        const canonicalData = {
          account_id: accountId,
          appearance,
          timezone,
          default_dashboard,
          accent_color,
          in_app_enabled,
          sms_enabled,
          updated_at: timestamp
        };
        await env.R2_VIRTUAL_LAUNCH.put(canonicalKey, JSON.stringify(canonicalData));

        // Update D1 (UPSERT)
        await d1Run(env.DB,
          `INSERT OR REPLACE INTO vlp_preferences
           (account_id, appearance, timezone, default_dashboard, accent_color, in_app_enabled, sms_enabled, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [accountId, appearance, timezone, default_dashboard, accent_color, in_app_enabled, sms_enabled, timestamp]
        );

        return json({ ok: true, preferences: canonicalData }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to update preferences' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/accounts/photo-upload-init',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      try {
        const body = await request.json();
        const { account_id, file_type } = body;

        if (!file_type || !['image/jpeg', 'image/png', 'image/webp'].includes(file_type)) {
          return json({ ok: false, error: 'BAD_REQUEST', message: 'file_type must be image/jpeg, image/png, or image/webp' }, 400, request);
        }

        const ext = file_type.split('/')[1];
        const key = `avatars/${account_id}/avatar.${ext}`;

        // Check if createPresignedUrl method exists
        if (typeof env.R2_VIRTUAL_LAUNCH.createPresignedUrl === 'function') {
          const upload_url = await env.R2_VIRTUAL_LAUNCH.createPresignedUrl('PUT', key);
          return json({ ok: true, upload_url, key }, 200, request);
        } else {
          // Fall back to direct upload endpoint
          return json({
            ok: true,
            upload_url: `/v1/accounts/photo-upload-direct?key=${encodeURIComponent(key)}`,
            key,
            note: 'createPresignedUrl not available, using direct upload endpoint'
          });
        }
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to initialize upload' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/accounts/photo-upload-complete',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      try {
        const body = await request.json();
        const { account_id, key } = body;

        // Verify the R2 object exists at key
        const object = await env.R2_VIRTUAL_LAUNCH.head(key);
        if (!object) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Uploaded file not found' }, 404, request);
        }

        // Construct public URL
        const avatar_url = `https://assets.virtuallaunch.pro/${key}`;

        // Write canonical to R2
        const canonicalKey = `accounts/${account_id}/avatar.json`;
        const timestamp = new Date().toISOString();
        await env.R2_VIRTUAL_LAUNCH.put(canonicalKey, JSON.stringify({
          url: avatar_url,
          updated_at: timestamp
        }));

        // Note: avatar_url column may not exist in accounts table - will report this
        // If it exists, update D1, otherwise skip D1 update
        try {
          await d1Run(env.DB,
            "UPDATE accounts SET avatar_url = ? WHERE account_id = ?",
            [avatar_url, account_id]
          );
        } catch (dbError) {
          // Column may not exist - continue without D1 update
          console.warn('avatar_url column may not exist in accounts table:', dbError.message);
        }

        return json({ ok: true, avatar_url }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to complete upload' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/accounts/:account_id/status',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const accountId = params.account_id;

      try {
        const row = await env.DB.prepare(
          "SELECT * FROM compliance_status WHERE account_id = ?"
        ).bind(accountId).first();

        if (!row) {
          // Return default intake state if no row exists
          const defaultStatus = {
            phase: 'intake',
            intake_complete: 0,
            esign_2848_complete: 0,
            processing_complete: 0,
            tax_record_complete: 0,
            current_step: null,
            step_status: 'pending'
          };
          return json({ ok: true, status: defaultStatus }, 200, request);
        }

        return json({
          ok: true,
          status: {
            phase: row.phase,
            intake_complete: row.intake_complete,
            esign_2848_complete: row.esign_2848_complete,
            processing_complete: row.processing_complete,
            tax_record_complete: row.tax_record_complete,
            current_step: row.current_step,
            step_status: row.step_status,
            notes: row.notes,
            assigned_professional_id: row.assigned_professional_id
          }
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to get status' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/support/messages',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      try {
        const body = await request.json();
        const { account_id, action, message_id, subject, body: messageBody, category } = body;

        const timestamp = new Date().toISOString();

        switch (action) {
          case 'create': {
            const newMessageId = `MSG_${crypto.randomUUID()}`;

            // Write receipt to R2
            const receiptKey = `receipts/support/${account_id}/${timestamp}.json`;
            await env.R2_VIRTUAL_LAUNCH.put(receiptKey, JSON.stringify({
              action: 'create',
              account_id,
              message_id: newMessageId,
              subject,
              body: messageBody,
              category,
              timestamp
            }));

            // Write canonical to R2
            const messageKey = `support/messages/${account_id}/${newMessageId}.json`;
            const messageData = {
              message_id: newMessageId,
              account_id,
              subject,
              body: messageBody,
              category,
              created_at: timestamp,
              updated_at: timestamp
            };
            await env.R2_VIRTUAL_LAUNCH.put(messageKey, JSON.stringify(messageData));

            // Index in support_tickets table
            await d1Run(env.DB,
              `INSERT INTO support_tickets
               (ticket_id, account_id, subject, message, priority, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'normal', 'open', ?, ?)`,
              [newMessageId, account_id, subject, messageBody, timestamp, timestamp]
            );

            return json({ ok: true, message_id: newMessageId, action: 'create' }, 200, request);
          }

          case 'update': {
            if (!message_id) {
              return json({ ok: false, error: 'BAD_REQUEST', message: 'message_id required for update' }, 400, request);
            }

            // Read existing from R2
            const messageKey = `support/messages/${account_id}/${message_id}.json`;
            const existingObj = await env.R2_VIRTUAL_LAUNCH.get(messageKey);
            if (!existingObj) {
              return json({ ok: false, error: 'NOT_FOUND', message: 'Message not found' }, 404, request);
            }

            const existingData = await existingObj.json();

            // Merge changes
            const updatedData = {
              ...existingData,
              subject: subject || existingData.subject,
              body: messageBody || existingData.body,
              category: category || existingData.category,
              updated_at: timestamp
            };

            // Write receipt to R2
            const receiptKey = `receipts/support/${account_id}/${timestamp}.json`;
            await env.R2_VIRTUAL_LAUNCH.put(receiptKey, JSON.stringify({
              action: 'update',
              account_id,
              message_id,
              changes: { subject, body: messageBody, category },
              timestamp
            }));

            // Rewrite canonical
            await env.R2_VIRTUAL_LAUNCH.put(messageKey, JSON.stringify(updatedData));

            return json({ ok: true, message_id, action: 'update' }, 200, request);
          }

          case 'delete_soft': {
            if (!message_id) {
              return json({ ok: false, error: 'BAD_REQUEST', message: 'message_id required for delete' }, 400, request);
            }

            // Read existing from R2
            const messageKey = `support/messages/${account_id}/${message_id}.json`;
            const existingObj = await env.R2_VIRTUAL_LAUNCH.get(messageKey);
            if (!existingObj) {
              return json({ ok: false, error: 'NOT_FOUND', message: 'Message not found' }, 404, request);
            }

            const existingData = await existingObj.json();

            // Set deleted_at timestamp
            const updatedData = {
              ...existingData,
              deleted_at: timestamp,
              updated_at: timestamp
            };

            // Write receipt to R2
            const receiptKey = `receipts/support/${account_id}/${timestamp}.json`;
            await env.R2_VIRTUAL_LAUNCH.put(receiptKey, JSON.stringify({
              action: 'delete_soft',
              account_id,
              message_id,
              timestamp
            }));

            // Rewrite canonical
            await env.R2_VIRTUAL_LAUNCH.put(messageKey, JSON.stringify(updatedData));

            return json({ ok: true, message_id, action: 'delete_soft' }, 200, request);
          }

          case 'restore': {
            if (!message_id) {
              return json({ ok: false, error: 'BAD_REQUEST', message: 'message_id required for restore' }, 400, request);
            }

            // Read existing from R2
            const messageKey = `support/messages/${account_id}/${message_id}.json`;
            const existingObj = await env.R2_VIRTUAL_LAUNCH.get(messageKey);
            if (!existingObj) {
              return json({ ok: false, error: 'NOT_FOUND', message: 'Message not found' }, 404, request);
            }

            const existingData = await existingObj.json();

            // Clear deleted_at
            const { deleted_at, ...restoredData } = existingData;
            restoredData.updated_at = timestamp;

            // Write receipt to R2
            const receiptKey = `receipts/support/${account_id}/${timestamp}.json`;
            await env.R2_VIRTUAL_LAUNCH.put(receiptKey, JSON.stringify({
              action: 'restore',
              account_id,
              message_id,
              timestamp
            }));

            // Rewrite canonical
            await env.R2_VIRTUAL_LAUNCH.put(messageKey, JSON.stringify(restoredData));

            return json({ ok: true, message_id, action: 'restore' }, 200, request);
          }

          case 'delete_permanent': {
            if (!message_id) {
              return json({ ok: false, error: 'BAD_REQUEST', message: 'message_id required for permanent delete' }, 400, request);
            }

            // Write receipt to R2
            const receiptKey = `receipts/support/${account_id}/${timestamp}.json`;
            await env.R2_VIRTUAL_LAUNCH.put(receiptKey, JSON.stringify({
              action: 'delete_permanent',
              account_id,
              message_id,
              timestamp
            }));

            // Delete R2 object
            const messageKey = `support/messages/${account_id}/${message_id}.json`;
            await env.R2_VIRTUAL_LAUNCH.delete(messageKey);

            return json({ ok: true, message_id, action: 'delete_permanent' }, 200, request);
          }

          default:
            return json({ ok: false, error: 'BAD_REQUEST', message: 'Invalid action' }, 400, request);
        }
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to process message' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/compliance/report-generate',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      try {
        const body = await request.json();
        const { account_id, tax_year, report_type } = body;

        const timestamp = new Date().toISOString();
        const reportId = `RES_${crypto.randomUUID()}`;

        // Write receipt to R2
        const receiptKey = `receipts/compliance/${account_id}/${timestamp}.json`;
        await env.R2_VIRTUAL_LAUNCH.put(receiptKey, JSON.stringify({
          account_id,
          tax_year,
          report_type,
          report_id: reportId,
          timestamp
        }));

        // Write placeholder report record to R2
        const reportKey = `compliance/${account_id}/${tax_year}/report.json`;
        const reportData = {
          account_id,
          tax_year,
          report_id: reportId,
          status: 'pending',
          requested_at: timestamp
        };
        await env.R2_VIRTUAL_LAUNCH.put(reportKey, JSON.stringify(reportData));

        // Insert into ttmp_reports table (if it exists)
        try {
          await d1Run(env.DB,
            `INSERT INTO ttmp_reports
             (id, account_id, report_id, status, created_at)
             VALUES (?, ?, ?, 'pending', ?)`,
            [reportId, account_id, reportId, timestamp]
          );
        } catch (dbError) {
          // Table may not exist - continue without D1 update
          console.warn('ttmp_reports table may not exist:', dbError.message);
        }

        return json({
          ok: true,
          report_id: reportId,
          status: 'pending',
          message: 'Report generation queued'
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to generate report' }, 500, request);
      }
    },
  },

  // -------------------------------------------------------------------------
  // DVLP (Developers VLP)
  // -------------------------------------------------------------------------

  // Public Routes (7)
  {
    method: 'GET', pattern: '/v1/dvlp/developers',
    handler: async (_method, _pattern, params, request, env) => {
      const url = new URL(request.url);
      const skills = url.searchParams.get('skills');
      const availability = url.searchParams.get('availability');

      try {
        let query = "SELECT developer_id, ref_number, full_name, skills, experience_years, hourly_rate, availability, created_at FROM dvlp_developers WHERE publish_profile = 1 AND status = 'active'";
        const queryParams = [];

        if (skills) {
          query += " AND skills LIKE ?";
          queryParams.push(`%${skills}%`);
        }
        if (availability) {
          query += " AND availability = ?";
          queryParams.push(availability);
        }

        const stmt = env.DB.prepare(query);
        const result = await stmt.bind(...queryParams).all();

        return json({ ok: true, developers: result.results || [] }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch developers' }, 500, request);
      }
    },
  },

  // GET /v1/dvlp/pricing
  {
    method: 'GET', pattern: '/v1/dvlp/pricing',
    handler: async (_method, _pattern, _params, request, env) => {
      try {
        return json({
          "ok": true,
          "plans": [
            {
              "key": "free",
              "name": "Free",
              "price": 0,
              "features": ["Profile in directory", "Receive inquiries", "Respond to inquiries"]
            },
            {
              "key": "paid",
              "name": "Intro Track",
              "price": 2.99,
              "interval": "month",
              "features": ["Everything in Free", "Curated job matches", "1-on-1 intro consultation", "Featured placement in directory"]
            }
          ]
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch pricing' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/dvlp/onboarding',
    handler: async (_method, _pattern, params, request, env) => {
      const url = new URL(request.url);
      const ref = url.searchParams.get('ref');

      if (!ref) {
        return json({ ok: false, error: 'INVALID_REQUEST', message: 'ref parameter required' }, 400, request);
      }

      try {
        const result = await env.DB.prepare(
          "SELECT * FROM dvlp_developers WHERE ref_number = ?"
        ).bind(ref).first();

        if (!result) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Developer not found' }, 404, request);
        }

        return json({ ok: true, developer: result }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch developer' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/dvlp/onboarding',
    handler: async (_method, _pattern, params, request, env) => {
      try {
        const body = await parseBody(request);
        const { full_name, email, skills, experience_years, hourly_rate, availability, skill_levels } = body;

        if (!full_name || !email) {
          return json({ ok: false, error: 'INVALID_REQUEST', message: 'full_name and email required' }, 400, request);
        }

        const developerId = `DVLP_ACCT_${crypto.randomUUID()}`;
        const refNumber = `VLP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        const timestamp = new Date().toISOString();

        // Write receipt to R2
        const receiptKey = `dvlp/receipts/onboarding/${developerId}/${Date.now()}.json`;
        const receipt = {
          developerId,
          refNumber,
          timestamp,
          payload: body
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, receiptKey, JSON.stringify(receipt));

        // Write canonical to R2
        const canonicalData = {
          developer_id: developerId,
          ref_number: refNumber,
          full_name,
          email,
          skills: skills || null,
          experience_years: experience_years || null,
          hourly_rate: hourly_rate || null,
          availability: availability || null,
          skill_levels: skill_levels && typeof skill_levels === 'object' ? skill_levels : null,
          publish_profile: 0,
          status: 'pending',
          plan: 'free',
          created_at: timestamp,
          updated_at: timestamp
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, `dvlp/onboarding/${developerId}.json`, JSON.stringify(canonicalData));

        // Insert into D1
        await d1Run(env.DB,
          `INSERT INTO dvlp_developers (developer_id, ref_number, full_name, email, skills, experience_years, hourly_rate, availability, publish_profile, status, plan, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', 'free', ?, ?)`,
          [developerId, refNumber, full_name, email, skills, experience_years, hourly_rate, availability, timestamp, timestamp]
        );

        return json({ ok: true, developer_id: developerId, ref_number: refNumber }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to create developer' }, 500, request);
      }
    },
  },

  {
    method: 'PATCH', pattern: '/v1/dvlp/onboarding',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      try {
        const body = await parseBody(request);
        const { ref_number, ...updates } = body;

        if (!ref_number) {
          return json({ ok: false, error: 'INVALID_REQUEST', message: 'ref_number required' }, 400, request);
        }

        // Look up developer and verify ownership
        const developer = await env.DB.prepare(
          "SELECT * FROM dvlp_developers WHERE ref_number = ?"
        ).bind(ref_number).first();

        if (!developer) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Developer not found' }, 404, request);
        }

        if (developer.account_id && developer.account_id !== session.account_id) {
          return json({ ok: false, error: 'FORBIDDEN', message: 'Cannot update another user\'s profile' }, 403, request);
        }

        const timestamp = new Date().toISOString();

        // Check developer's plan for featured placement logic
        const developerPlan = developer.plan || 'free';

        // Filter allowed updates (immutable: ref_number, email, developer_id, created_at)
        const allowedFields = ['full_name', 'skills', 'experience_years', 'hourly_rate', 'availability', 'publish_profile'];

        // Add 'featured' to allowed fields if developer has paid plan
        if (developerPlan === 'paid') {
          allowedFields.push('featured');
        }

        const filteredUpdates = Object.fromEntries(
          Object.entries(updates).filter(([key]) => allowedFields.includes(key))
        );

        // Handle featured placement logic based on plan
        if (updates.publish_profile === true) {
          if (developerPlan === 'free') {
            // Free plan: allow publish but set featured: false
            filteredUpdates.featured = false;
          } else if (developerPlan === 'paid') {
            // Paid plan: allow featured: true (but don't force it)
            if (updates.featured !== undefined) {
              filteredUpdates.featured = updates.featured;
            }
          }
        }

        if (Object.keys(filteredUpdates).length === 0) {
          return json({ ok: false, error: 'INVALID_REQUEST', message: 'No valid fields to update' }, 400, request);
        }

        // Update canonical R2
        const canonical = JSON.parse(await r2Get(env.R2_VIRTUAL_LAUNCH, `dvlp/onboarding/${developer.developer_id}.json`));
        Object.assign(canonical, filteredUpdates, { updated_at: timestamp });
        await r2Put(env.R2_VIRTUAL_LAUNCH, `dvlp/onboarding/${developer.developer_id}.json`, JSON.stringify(canonical));

        // Update D1
        const setClause = Object.keys(filteredUpdates).map(k => `${k} = ?`).join(', ');
        const values = [...Object.values(filteredUpdates), timestamp, developer.developer_id];

        await d1Run(env.DB,
          `UPDATE dvlp_developers SET ${setClause}, updated_at = ? WHERE developer_id = ?`,
          values
        );

        return json({ ok: true }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to update developer' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/dvlp/onboarding/status',
    handler: async (_method, _pattern, params, request, env) => {
      const url = new URL(request.url);
      const ref = url.searchParams.get('ref');

      if (!ref) {
        return json({ ok: false, error: 'INVALID_REQUEST', message: 'ref parameter required' }, 400, request);
      }

      try {
        const result = await env.DB.prepare(
          "SELECT status, updated_at FROM dvlp_developers WHERE ref_number = ?"
        ).bind(ref).first();

        if (!result) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Developer not found' }, 404, request);
        }

        return json({ ok: true, status: result.status, updated_at: result.updated_at }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch status' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/dvlp/jobs',
    handler: async (_method, _pattern, params, request, env) => {
      try {
        const result = await env.DB.prepare(
          "SELECT * FROM dvlp_jobs WHERE status != 'closed' ORDER BY created_at DESC"
        ).all();

        return json({ ok: true, jobs: result.results || [] }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch jobs' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/dvlp/reviews',
    handler: async (_method, _pattern, params, request, env) => {
      try {
        const result = await env.DB.prepare(
          "SELECT * FROM dvlp_reviews WHERE status = 'approved' ORDER BY created_at DESC"
        ).all();

        return json({ ok: true, reviews: result.results || [] }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch reviews' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/dvlp/reviews',
    handler: async (_method, _pattern, params, request, env) => {
      try {
        const body = await parseBody(request);
        const { reviewer_name, reviewer_email, rating, body: reviewBody } = body;

        if (!reviewer_name || !rating || !reviewBody || rating < 1 || rating > 5) {
          return json({ ok: false, error: 'INVALID_REQUEST', message: 'reviewer_name, rating (1-5), and body required' }, 400, request);
        }

        const reviewId = `RES_${crypto.randomUUID()}`;
        const timestamp = new Date().toISOString();

        // Write to R2
        const reviewData = {
          review_id: reviewId,
          reviewer_name,
          reviewer_email,
          rating,
          body: reviewBody,
          status: 'pending',
          created_at: timestamp
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, `dvlp/reviews/${reviewId}.json`, JSON.stringify(reviewData));

        // Insert into D1
        await d1Run(env.DB,
          `INSERT INTO dvlp_reviews (review_id, reviewer_name, reviewer_email, rating, body, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
          [reviewId, reviewer_name, reviewer_email, rating, reviewBody, timestamp]
        );

        return json({ ok: true, review_id: reviewId }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to create review' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/dvlp/developer-match-intake',
    handler: async (_method, _pattern, params, request, env) => {
      try {
        const body = await parseBody(request);
        const eventId = `EVT_${crypto.randomUUID()}`;
        const timestamp = new Date().toISOString();

        const intakeData = {
          eventId,
          timestamp,
          ...body
        };

        // Write to R2
        await r2Put(env.R2_VIRTUAL_LAUNCH, `dvlp/match-intake/${eventId}.json`, JSON.stringify(intakeData));

        return json({ ok: true, eventId }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to process intake' }, 500, request);
      }
    },
  },

  // Stripe Routes (3)
  {
    method: 'POST', pattern: '/v1/dvlp/stripe/checkout',
    handler: async (_method, _pattern, params, request, env) => {
      try {
        const body = await parseBody(request);
        const { plan, email, ref_number } = body;

        if (!plan || !email || !ref_number) {
          return json({ ok: false, error: 'INVALID_REQUEST', message: 'plan, email, and ref_number required' }, 400, request);
        }

        const priceId = plan === 'free' ? env.STRIPE_DVLP_PRICE_FREE : env.STRIPE_DVLP_PRICE_PAID;

        const sessionData = {
          mode: 'subscription',
          payment_method_types: ['card'],
          line_items: [{ price: priceId, quantity: 1 }],
          customer_email: email,
          metadata: { ref_number, plan },
          success_url: `https://developers.virtuallaunch.pro/dashboard?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `https://developers.virtuallaunch.pro/pricing`,
        };

        const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_DVLP_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams(sessionData),
        });

        const session = await response.json();
        if (!response.ok) {
          return json({ ok: false, error: 'STRIPE_ERROR', message: session.error?.message }, 400, request);
        }

        return json({ ok: true, session_url: session.url }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to create checkout session' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/dvlp/stripe/session-status',
    handler: async (_method, _pattern, params, request, env) => {
      const url = new URL(request.url);
      const sessionId = url.searchParams.get('session_id');

      if (!sessionId) {
        return json({ ok: false, error: 'INVALID_REQUEST', message: 'session_id parameter required' }, 400, request);
      }

      try {
        const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
          headers: { 'Authorization': `Bearer ${env.STRIPE_DVLP_SECRET_KEY}` },
        });

        const session = await response.json();
        if (!response.ok) {
          return json({ ok: false, error: 'STRIPE_ERROR', message: session.error?.message }, 400, request);
        }

        return json({
          ok: true,
          status: session.payment_status,
          customer_email: session.customer_details?.email
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to check session status' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/dvlp/stripe/webhook',
    handler: async (_method, _pattern, params, request, env) => {
      try {
        const body = await request.text();
        const signature = request.headers.get('stripe-signature');

        // Verify webhook signature
        const elements = signature.split(',');
        const signatureHash = elements.find(element => element.startsWith('v1=')).split('=')[1];

        const expectedSignature = await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(env.STRIPE_DVLP_WEBHOOK_SECRET),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        ).then(key => crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
          .then(signature => Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, '0')).join(''));

        if (signatureHash !== expectedSignature) {
          return json({ ok: false, error: 'INVALID_SIGNATURE' }, 400, request);
        }

        const event = JSON.parse(body);
        const eventId = event.id;

        // Write receipt
        await r2Put(env.R2_VIRTUAL_LAUNCH, `dvlp/receipts/stripe/${eventId}.json`, body);

        if (event.type === 'checkout.session.completed') {
          const session = event.data.object;
          const refNumber = session.metadata?.ref_number;
          const plan = session.metadata?.plan;

          if (refNumber) {
            const timestamp = new Date().toISOString();
            await d1Run(env.DB,
              `UPDATE dvlp_developers SET plan = ?, stripe_customer_id = ?, stripe_subscription_id = ?, updated_at = ? WHERE ref_number = ?`,
              [plan, session.customer, session.subscription, timestamp, refNumber]
            );
          }
        } else if (event.type === 'customer.subscription.deleted') {
          const subscription = event.data.object;
          const timestamp = new Date().toISOString();
          await d1Run(env.DB,
            `UPDATE dvlp_developers SET plan = 'free', stripe_subscription_id = NULL, updated_at = ? WHERE stripe_subscription_id = ?`,
            [timestamp, subscription.id]
          );
        }

        return json({ ok: true }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Webhook processing failed' }, 500, request);
      }
    },
  },

  // Operator Routes (18) - all require admin session
  {
    method: 'POST', pattern: '/v1/dvlp/operator/analytics',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      // Check admin role
      const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
      if (!account || account.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      try {
        const developerStats = await env.DB.prepare(`
          SELECT
            COUNT(*) as total,
            COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
            COUNT(CASE WHEN publish_profile = 1 THEN 1 END) as published
          FROM dvlp_developers
        `).first();

        const jobStats = await env.DB.prepare(`
          SELECT
            COUNT(*) as total,
            COUNT(CASE WHEN status = 'open' THEN 1 END) as open,
            COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed
          FROM dvlp_jobs
        `).first();

        return json({
          ok: true,
          analytics: {
            developers: developerStats,
            jobs: jobStats
          }
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch analytics' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/dvlp/operator/submissions',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
      if (!account || account.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      try {
        const url = new URL(request.url);
        const status = url.searchParams.get('status');
        const plan = url.searchParams.get('plan');
        const page = parseInt(url.searchParams.get('page')) || 1;
        const limit = 50;
        const offset = (page - 1) * limit;

        let query = "SELECT * FROM dvlp_developers";
        const queryParams = [];
        const conditions = [];

        if (status) {
          conditions.push("status = ?");
          queryParams.push(status);
        }
        if (plan) {
          conditions.push("plan = ?");
          queryParams.push(plan);
        }

        if (conditions.length > 0) {
          query += " WHERE " + conditions.join(" AND ");
        }

        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
        queryParams.push(limit, offset);

        const result = await env.DB.prepare(query).bind(...queryParams).all();

        return json({ ok: true, submissions: result.results || [], page, limit }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch submissions' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/dvlp/operator/developer',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
      if (!account || account.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      const url = new URL(request.url);
      const ref = url.searchParams.get('ref');

      if (!ref) {
        return json({ ok: false, error: 'INVALID_REQUEST', message: 'ref parameter required' }, 400, request);
      }

      try {
        const d1Record = await env.DB.prepare("SELECT * FROM dvlp_developers WHERE ref_number = ?").bind(ref).first();
        if (!d1Record) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Developer not found' }, 404, request);
        }

        // Merge with R2 canonical if available
        try {
          const r2Data = await r2Get(env.R2_VIRTUAL_LAUNCH, `dvlp/onboarding/${d1Record.developer_id}.json`);
          const canonical = JSON.parse(r2Data);
          const merged = { ...d1Record, ...canonical };
          return json({ ok: true, developer: merged }, 200, request);
        } catch {
          return json({ ok: true, developer: d1Record }, 200, request);
        }
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch developer' }, 500, request);
      }
    },
  },

  {
    method: 'PATCH', pattern: '/v1/dvlp/operator/developer',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
      if (!account || account.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      try {
        const body = await parseBody(request);
        const { ref_number, ...updates } = body;

        if (!ref_number) {
          return json({ ok: false, error: 'INVALID_REQUEST', message: 'ref_number required' }, 400, request);
        }

        const developer = await env.DB.prepare("SELECT * FROM dvlp_developers WHERE ref_number = ?").bind(ref_number).first();
        if (!developer) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Developer not found' }, 404, request);
        }

        const timestamp = new Date().toISOString();

        // Admin can update any non-immutable field
        const immutableFields = ['developer_id', 'ref_number', 'created_at'];
        const filteredUpdates = Object.fromEntries(
          Object.entries(updates).filter(([key]) => !immutableFields.includes(key))
        );

        if (Object.keys(filteredUpdates).length === 0) {
          return json({ ok: false, error: 'INVALID_REQUEST', message: 'No valid fields to update' }, 400, request);
        }

        // Update R2 canonical
        try {
          const r2Data = await r2Get(env.R2_VIRTUAL_LAUNCH, `dvlp/onboarding/${developer.developer_id}.json`);
          const canonical = JSON.parse(r2Data);
          Object.assign(canonical, filteredUpdates, { updated_at: timestamp });
          await r2Put(env.R2_VIRTUAL_LAUNCH, `dvlp/onboarding/${developer.developer_id}.json`, JSON.stringify(canonical));
        } catch {
          // Create canonical if missing
          const canonical = { ...developer, ...filteredUpdates, updated_at: timestamp };
          await r2Put(env.R2_VIRTUAL_LAUNCH, `dvlp/onboarding/${developer.developer_id}.json`, JSON.stringify(canonical));
        }

        // Update D1
        const setClause = Object.keys(filteredUpdates).map(k => `${k} = ?`).join(', ');
        const values = [...Object.values(filteredUpdates), timestamp, developer.developer_id];

        await d1Run(env.DB,
          `UPDATE dvlp_developers SET ${setClause}, updated_at = ? WHERE developer_id = ?`,
          values
        );

        return json({ ok: true }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to update developer' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/dvlp/operator/developers',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
      if (!account || account.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      try {
        const result = await env.DB.prepare(
          "SELECT ref_number, full_name, status, publish_profile FROM dvlp_developers ORDER BY created_at DESC"
        ).all();

        return json({ ok: true, developers: result.results || [] }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch developers' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/dvlp/operator/jobs',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
      if (!account || account.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      try {
        const url = new URL(request.url);
        const status = url.searchParams.get('status');

        let query = "SELECT * FROM dvlp_jobs";
        const queryParams = [];

        if (status) {
          query += " WHERE status = ?";
          queryParams.push(status);
        }

        query += " ORDER BY created_at DESC";

        const result = await env.DB.prepare(query).bind(...queryParams).all();

        return json({ ok: true, jobs: result.results || [] }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch jobs' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/dvlp/operator/jobs',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
      if (!account || account.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      try {
        const body = await parseBody(request);
        const { title, description, skills_required, budget_min, budget_max } = body;

        if (!title) {
          return json({ ok: false, error: 'INVALID_REQUEST', message: 'title required' }, 400, request);
        }

        const jobId = `JOB_${crypto.randomUUID()}`;
        const timestamp = new Date().toISOString();

        const jobData = {
          job_id: jobId,
          title,
          description,
          skills_required,
          budget_min,
          budget_max,
          status: 'open',
          posted_by: session.account_id,
          created_at: timestamp,
          updated_at: timestamp
        };

        // Write to R2
        await r2Put(env.R2_VIRTUAL_LAUNCH, `dvlp/jobs/${jobId}.json`, JSON.stringify(jobData));

        // Insert into D1
        await d1Run(env.DB,
          `INSERT INTO dvlp_jobs (job_id, title, description, skills_required, budget_min, budget_max, status, posted_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
          [jobId, title, description, skills_required, budget_min, budget_max, session.account_id, timestamp, timestamp]
        );

        return json({ ok: true, job_id: jobId }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to create job' }, 500, request);
      }
    },
  },

  {
    method: 'PATCH', pattern: '/v1/dvlp/operator/jobs/:job_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
      if (!account || account.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      const { job_id } = params;

      try {
        const body = await parseBody(request);
        const updates = body;

        const job = await env.DB.prepare("SELECT * FROM dvlp_jobs WHERE job_id = ?").bind(job_id).first();
        if (!job) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Job not found' }, 404, request);
        }

        const timestamp = new Date().toISOString();

        const immutableFields = ['job_id', 'created_at'];
        const filteredUpdates = Object.fromEntries(
          Object.entries(updates).filter(([key]) => !immutableFields.includes(key))
        );

        if (Object.keys(filteredUpdates).length === 0) {
          return json({ ok: false, error: 'INVALID_REQUEST', message: 'No valid fields to update' }, 400, request);
        }

        // Update R2
        const canonical = { ...job, ...filteredUpdates, updated_at: timestamp };
        await r2Put(env.R2_VIRTUAL_LAUNCH, `dvlp/jobs/${job_id}.json`, JSON.stringify(canonical));

        // Update D1
        const setClause = Object.keys(filteredUpdates).map(k => `${k} = ?`).join(', ');
        const values = [...Object.values(filteredUpdates), timestamp, job_id];

        await d1Run(env.DB,
          `UPDATE dvlp_jobs SET ${setClause}, updated_at = ? WHERE job_id = ?`,
          values
        );

        return json({ ok: true }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to update job' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/dvlp/operator/post',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
      if (!account || account.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      try {
        const body = await parseBody(request);
        const { ref_number, job_title, message } = body;

        if (!ref_number || !job_title || !message) {
          return json({ ok: false, error: 'INVALID_REQUEST', message: 'ref_number, job_title, and message required' }, 400, request);
        }

        const developer = await env.DB.prepare("SELECT email, full_name, plan FROM dvlp_developers WHERE ref_number = ?").bind(ref_number).first();
        if (!developer) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Developer not found' }, 404, request);
        }

        // Check developer plan eligibility for curated job matches
        const developerPlan = developer.plan || 'free';
        if (developerPlan === 'free') {
          return json({
            ok: false,
            error: 'DEVELOPER_NOT_ELIGIBLE',
            message: 'This developer has not upgraded to receive curated matches.'
          }, 402, request);
        }

        const eventId = `EVT_${crypto.randomUUID()}`;
        const timestamp = new Date().toISOString();

        // Write to R2
        const postData = {
          eventId,
          ref_number,
          job_title,
          message,
          sent_to: developer.email,
          timestamp
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, `dvlp/operator/posts/${ref_number}/${eventId}.json`, JSON.stringify(postData));

        // Send email (implementation would depend on available email service)
        await sendEmail(
          developer.email,
          `New Job Opportunity: ${job_title}`,
          `<p>Hi ${developer.full_name},</p><p>${message}</p>`,
          env
        );

        return json({ ok: true, eventId }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to send post' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/dvlp/operator/messages',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
      if (!account || account.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      try {
        const body = await parseBody(request);
        const { ref_number, subject, message } = body;

        if (!ref_number || !subject || !message) {
          return json({ ok: false, error: 'INVALID_REQUEST', message: 'ref_number, subject, and message required' }, 400, request);
        }

        const developer = await env.DB.prepare("SELECT email, full_name FROM dvlp_developers WHERE ref_number = ?").bind(ref_number).first();
        if (!developer) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Developer not found' }, 404, request);
        }

        const eventId = `EVT_${crypto.randomUUID()}`;
        const timestamp = new Date().toISOString();

        // Write to R2
        const messageData = {
          eventId,
          ref_number,
          subject,
          message,
          sent_to: developer.email,
          sent_by: session.account_id,
          timestamp
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, `dvlp/operator/messages/${ref_number}/${eventId}.json`, JSON.stringify(messageData));

        // Send email
        await sendEmail(developer.email, subject, `<p>Hi ${developer.full_name},</p><p>${message}</p>`, env);

        return json({ ok: true, eventId }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to send message' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/dvlp/operator/messages',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
      if (!account || account.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      const url = new URL(request.url);
      const ref = url.searchParams.get('ref');

      if (!ref) {
        return json({ ok: false, error: 'INVALID_REQUEST', message: 'ref parameter required' }, 400, request);
      }

      try {
        // List all message files from R2 for this ref_number
        const messages = [];
        const prefix = `dvlp/operator/messages/${ref}/`;

        // Note: This is a simplified implementation. In practice, you'd need to list R2 objects
        // For now, returning empty array as placeholder
        return json({ ok: true, messages: [] }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch messages' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/dvlp/operator/tickets',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
      if (!account || account.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      try {
        const url = new URL(request.url);
        const status = url.searchParams.get('status');

        let query = "SELECT * FROM support_tickets";
        const queryParams = [];

        if (status) {
          query += " WHERE status = ?";
          queryParams.push(status);
        }

        query += " ORDER BY created_at DESC";

        const result = await env.DB.prepare(query).bind(...queryParams).all();

        return json({ ok: true, tickets: result.results || [] }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch tickets' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/dvlp/operator/tickets/:ticket_id/reply',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
      if (!account || account.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      const { ticket_id } = params;

      try {
        const body = await parseBody(request);
        const { status, reply } = body;

        const ticket = await env.DB.prepare("SELECT * FROM support_tickets WHERE ticket_id = ?").bind(ticket_id).first();
        if (!ticket) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Ticket not found' }, 404, request);
        }

        const timestamp = new Date().toISOString();

        // Update ticket
        const updates = {};
        if (status) updates.status = status;
        if (reply) updates.admin_notes = reply;
        updates.updated_at = timestamp;

        const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        const values = [...Object.values(updates), ticket_id];

        await d1Run(env.DB,
          `UPDATE support_tickets SET ${setClause} WHERE ticket_id = ?`,
          values
        );

        return json({ ok: true }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to update ticket' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/dvlp/operator/canned-responses',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
      if (!account || account.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      try {
        const url = new URL(request.url);
        const userType = url.searchParams.get('user_type');

        let query = "SELECT * FROM dvlp_canned_responses";
        const queryParams = [];

        if (userType) {
          query += " WHERE user_type = ?";
          queryParams.push(userType);
        }

        query += " ORDER BY is_default DESC, title ASC";

        const result = await env.DB.prepare(query).bind(...queryParams).all();

        return json({ ok: true, responses: result.results || [] }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch canned responses' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/dvlp/operator/canned-responses',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
      if (!account || account.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      try {
        const body = await parseBody(request);
        const { title, body: responseBody, user_type, is_default } = body;

        if (!title || !responseBody) {
          return json({ ok: false, error: 'INVALID_REQUEST', message: 'title and body required' }, 400, request);
        }

        const templateId = `TPL_${crypto.randomUUID()}`;
        const timestamp = new Date().toISOString();

        await d1Run(env.DB,
          `INSERT INTO dvlp_canned_responses (template_id, title, body, user_type, is_default, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [templateId, title, responseBody, user_type || 'developer', is_default ? 1 : 0, timestamp, timestamp]
        );

        return json({ ok: true, template_id: templateId }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to create canned response' }, 500, request);
      }
    },
  },

  {
    method: 'PATCH', pattern: '/v1/dvlp/operator/canned-responses/:template_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
      if (!account || account.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      const { template_id } = params;

      try {
        const body = await parseBody(request);
        const updates = body;

        const template = await env.DB.prepare("SELECT * FROM dvlp_canned_responses WHERE template_id = ?").bind(template_id).first();
        if (!template) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Template not found' }, 404, request);
        }

        const timestamp = new Date().toISOString();

        const immutableFields = ['template_id', 'created_at'];
        const filteredUpdates = Object.fromEntries(
          Object.entries(updates).filter(([key]) => !immutableFields.includes(key))
        );

        if (Object.keys(filteredUpdates).length === 0) {
          return json({ ok: false, error: 'INVALID_REQUEST', message: 'No valid fields to update' }, 400, request);
        }

        const setClause = Object.keys(filteredUpdates).map(k => `${k} = ?`).join(', ');
        const values = [...Object.values(filteredUpdates), timestamp, template_id];

        await d1Run(env.DB,
          `UPDATE dvlp_canned_responses SET ${setClause}, updated_at = ? WHERE template_id = ?`,
          values
        );

        return json({ ok: true }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to update canned response' }, 500, request);
      }
    },
  },

  {
    method: 'DELETE', pattern: '/v1/dvlp/operator/canned-responses/:template_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
      if (!account || account.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      const { template_id } = params;

      try {
        const template = await env.DB.prepare("SELECT is_default FROM dvlp_canned_responses WHERE template_id = ?").bind(template_id).first();
        if (!template) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Template not found' }, 404, request);
        }

        if (template.is_default === 1) {
          return json({ ok: false, error: 'BAD_REQUEST', message: 'Cannot delete default template' }, 400, request);
        }

        await d1Run(env.DB, "DELETE FROM dvlp_canned_responses WHERE template_id = ?", [template_id]);

        return json({ ok: true }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to delete canned response' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/dvlp/operator/bulk-email',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
      if (!account || account.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      try {
        const body = await parseBody(request);
        const { filters, subject, message, dry_run } = body;

        if (!subject || !message) {
          return json({ ok: false, error: 'INVALID_REQUEST', message: 'subject and message required' }, 400, request);
        }

        // Build query based on filters
        let query = "SELECT email, full_name FROM dvlp_developers WHERE 1=1";
        const queryParams = [];

        if (filters?.status) {
          query += " AND status = ?";
          queryParams.push(filters.status);
        }
        if (filters?.plan) {
          query += " AND plan = ?";
          queryParams.push(filters.plan);
        }
        if (filters?.skills) {
          query += " AND skills LIKE ?";
          queryParams.push(`%${filters.skills}%`);
        }

        const result = await env.DB.prepare(query).bind(...queryParams).all();
        const developers = result.results || [];

        if (dry_run) {
          return json({ ok: true, count: developers.length, dry_run: true }, 200, request);
        }

        // Send emails in batches of 50 (Resend limit)
        const eventId = `EVT_${crypto.randomUUID()}`;
        let sentCount = 0;

        for (let i = 0; i < developers.length; i += 50) {
          const batch = developers.slice(i, i + 50);

          // Implementation would use Resend batch API
          // await sendBulkEmail(batch, subject, message, env);
          sentCount += batch.length;
        }

        // Write receipt
        const receiptData = {
          eventId,
          filters,
          subject,
          message,
          sent_count: sentCount,
          timestamp: new Date().toISOString()
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, `dvlp/receipts/bulk-email/${eventId}.json`, JSON.stringify(receiptData));

        return json({ ok: true, sent_count: sentCount }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to send bulk email' }, 500, request);
      }
    },
  },

  // -------------------------------------------------------------------------
  // GVLP (Games VLP)
  // -------------------------------------------------------------------------

  // GET /v1/gvlp/config?client_id=xxx
  {
    method: 'GET', pattern: '/v1/gvlp/config',
    handler: async (_method, _pattern, params, request, env) => {
      const url = new URL(request.url);
      const client_id = url.searchParams.get('client_id');

      if (!client_id) {
        return json({ ok: false, error: 'INVALID_REQUEST', message: 'client_id required' }, 400, request);
      }

      try {
        const operator = await env.DB.prepare(
          "SELECT tier, tokens_balance FROM gvlp_operators WHERE client_id = ? AND status = 'active'"
        ).bind(client_id).first();

        if (!operator) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Operator not found' }, 404, request);
        }

        const unlocked_games = GVLP_GAME_UNLOCK[operator.tier] || [];

        return json({
          ok: true,
          tier: operator.tier,
          unlocked_games,
          tokens_balance: operator.tokens_balance
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch config' }, 500, request);
      }
    },
  },

  // POST /v1/gvlp/tokens/use
  {
    method: 'POST', pattern: '/v1/gvlp/tokens/use',
    handler: async (_method, _pattern, params, request, env) => {
      try {
        const body = await parseBody(request);
        const { client_id, visitor_id, game_slug, tokens_cost = 1 } = body;

        if (!client_id || !visitor_id || !game_slug) {
          return json({ ok: false, error: 'INVALID_REQUEST', message: 'client_id, visitor_id, and game_slug required' }, 400, request);
        }

        // Get operator
        const operator = await env.DB.prepare(
          "SELECT * FROM gvlp_operators WHERE client_id = ? AND status = 'active'"
        ).bind(client_id).first();

        if (!operator) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Operator not found' }, 404, request);
        }

        // Validate game is unlocked for this tier
        const unlockedGames = GVLP_GAME_UNLOCK[operator.tier] || [];
        if (!unlockedGames.includes(game_slug)) {
          return json({ ok: false, error: 'GAME_LOCKED', message: 'Game not available for current tier' }, 403, request);
        }

        // Check token balance
        if (operator.tokens_balance < tokens_cost) {
          return json({ ok: false, error: 'INSUFFICIENT_TOKENS' }, 402, request);
        }

        const play_id = `PLAY_${crypto.randomUUID()}`;
        const timestamp = new Date().toISOString();

        // 1. Validate (done)
        // 2. Write receipt to R2
        const receiptKey = `gvlp/receipts/token-use/${client_id}/${play_id}.json`;
        const receipt = {
          play_id,
          client_id,
          visitor_id,
          game_slug,
          tokens_cost,
          operator_id: operator.operator_id,
          timestamp
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, receiptKey, JSON.stringify(receipt));

        // 3. Update canonical R2 (operator balance)
        const canonicalKey = `gvlp/operators/${operator.operator_id}.json`;
        const existing = await r2Get(env.R2_VIRTUAL_LAUNCH, canonicalKey);
        const canonical = existing ? JSON.parse(existing) : {};
        canonical.tokens_balance = operator.tokens_balance - tokens_cost;
        canonical.updated_at = timestamp;
        await r2Put(env.R2_VIRTUAL_LAUNCH, canonicalKey, JSON.stringify(canonical));

        // 4. Update D1 projection
        // Deduct tokens from operator
        await d1Run(env.DB,
          "UPDATE gvlp_operators SET tokens_balance = tokens_balance - ?, updated_at = ? WHERE operator_id = ?",
          [tokens_cost, timestamp, operator.operator_id]
        );

        // Upsert visitor session
        await d1Run(env.DB,
          `INSERT INTO gvlp_visitor_sessions (visitor_id, client_id, tokens_used, last_seen, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(visitor_id) DO UPDATE SET tokens_used = tokens_used + ?, last_seen = ?`,
          [visitor_id, client_id, tokens_cost, timestamp, timestamp, tokens_cost, timestamp]
        );

        // Insert game play record
        await d1Run(env.DB,
          "INSERT INTO gvlp_game_plays (play_id, client_id, visitor_id, game_slug, tokens_cost, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          [play_id, client_id, visitor_id, game_slug, tokens_cost, timestamp]
        );

        const tokens_remaining = operator.tokens_balance - tokens_cost;

        return json({
          ok: true,
          tokens_remaining,
          play_id
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to use tokens' }, 500, request);
      }
    },
  },

  // GET /v1/gvlp/tokens/balance?client_id=xxx
  {
    method: 'GET', pattern: '/v1/gvlp/tokens/balance',
    handler: async (_method, _pattern, params, request, env) => {
      const url = new URL(request.url);
      const client_id = url.searchParams.get('client_id');

      if (!client_id) {
        return json({ ok: false, error: 'INVALID_REQUEST', message: 'client_id required' }, 400, request);
      }

      try {
        const operator = await env.DB.prepare(
          "SELECT tokens_balance, tier FROM gvlp_operators WHERE client_id = ? AND status = 'active'"
        ).bind(client_id).first();

        if (!operator) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Operator not found' }, 404, request);
        }

        return json({
          ok: true,
          tokens_balance: operator.tokens_balance,
          tier: operator.tier
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch balance' }, 500, request);
      }
    },
  },

  // POST /v1/gvlp/stripe/checkout
  {
    method: 'POST', pattern: '/v1/gvlp/stripe/checkout',
    handler: async (_method, _pattern, params, request, env) => {
      try {
        const body = await parseBody(request);
        const { account_id, tier } = body;

        if (!account_id || !tier) {
          return json({ ok: false, error: 'INVALID_REQUEST', message: 'account_id and tier required' }, 400, request);
        }

        if (!GVLP_TIERS[tier]) {
          return json({ ok: false, error: 'INVALID_TIER', message: 'Invalid tier specified' }, 400, request);
        }

        const tierConfig = GVLP_TIERS[tier];

        const sessionData = {
          mode: 'subscription',
          line_items: [{
            price: tierConfig.price_id,
            quantity: 1,
          }],
          success_url: 'https://games.virtuallaunch.pro/checkout/success?session_id={CHECKOUT_SESSION_ID}',
          cancel_url: 'https://games.virtuallaunch.pro/pricing',
          client_reference_id: account_id,
          metadata: {
            platform: 'gvlp',
            tier: tier
          }
        };

        // GVLP subscription prices live in the VLP Stripe account.
        const vlpSecretKey = env.STRIPE_SECRET_KEY_VLP;
        if (!vlpSecretKey) {
          return json({ ok: false, error: 'STRIPE_NOT_CONFIGURED', message: 'STRIPE_SECRET_KEY_VLP is not set' }, 503, request);
        }
        const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${vlpSecretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams(sessionData),
        });

        if (!response.ok) {
          return json({ ok: false, error: 'STRIPE_ERROR', message: 'Failed to create checkout session' }, 500, request);
        }

        const session = await response.json();

        return json({
          ok: true,
          session_url: session.url
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to create checkout' }, 500, request);
      }
    },
  },

  // POST /v1/gvlp/stripe/webhook
  {
    method: 'POST', pattern: '/v1/gvlp/stripe/webhook',
    handler: async (_method, _pattern, params, request, env) => {
      try {
        const body = await request.text();
        const sig = request.headers.get('stripe-signature');

        // Verify webhook signature.
        // GVLP checkouts run on the VLP Stripe account, so accept either signing
        // secret to support both accounts during the migration window.
        const candidateSecrets = [
          env.STRIPE_WEBHOOK_SECRET_VLP,
          env.STRIPE_WEBHOOK_SECRET,
        ].filter(Boolean);

        let isValid = false;
        for (const secret of candidateSecrets) {
          const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
          );
          const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
          const expectedSig = Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0')).join('');
          if (sig && sig.includes(expectedSig)) {
            isValid = true;
            break;
          }
        }

        if (!isValid) {
          return json({ ok: false, error: 'INVALID_SIGNATURE' }, 400, request);
        }

        const event = JSON.parse(body);
        const event_id = event.id;
        const timestamp = new Date().toISOString();

        // Write receipt to R2
        await r2Put(env.R2_VIRTUAL_LAUNCH, `gvlp/receipts/stripe/${event_id}.json`, body);

        if (event.type === 'checkout.session.completed') {
          const session = event.data.object;
          const account_id = session.client_reference_id;
          const tier = session.metadata.tier;
          const customer_id = session.customer;
          const subscription_id = session.subscription;

          if (account_id && tier && GVLP_TIERS[tier]) {
            const operator_id = `GVLP_OP_${crypto.randomUUID()}`;
            const client_id = `GVLP_${crypto.randomUUID().substring(0, 8)}`;
            const tierConfig = GVLP_TIERS[tier];

            // Create or update operator record
            await d1Run(env.DB,
              `INSERT INTO gvlp_operators (operator_id, account_id, client_id, tier, tokens_balance, tokens_granted_at, stripe_customer_id, stripe_subscription_id, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
               ON CONFLICT(account_id) DO UPDATE SET
                 tier = ?, tokens_balance = ?, tokens_granted_at = ?, stripe_customer_id = ?, stripe_subscription_id = ?, updated_at = ?`,
              [operator_id, account_id, client_id, tier, tierConfig.tokens, timestamp, customer_id, subscription_id, timestamp, timestamp,
               tier, tierConfig.tokens, timestamp, customer_id, subscription_id, timestamp]
            );
          }
        } else if (event.type === 'invoice.payment_succeeded') {
          const invoice = event.data.object;
          const subscription_id = invoice.subscription;

          if (subscription_id) {
            // Handle WLVLP hosting renewals: extend hosting_expires_at by 1 month
            // each time the buyer's $14/$49 monthly subscription pays.
            const wlvlpPurchase = await env.DB.prepare(
              "SELECT * FROM wlvlp_purchases WHERE stripe_subscription_id = ? AND status = 'active'"
            ).bind(subscription_id).first();

            if (wlvlpPurchase) {
              const base = wlvlpPurchase.hosting_expires_at && new Date(wlvlpPurchase.hosting_expires_at) > new Date()
                ? new Date(wlvlpPurchase.hosting_expires_at)
                : new Date();
              const renewed = new Date(base);
              renewed.setMonth(renewed.getMonth() + 1);
              const renewedIso = renewed.toISOString();

              await env.DB.prepare(
                "UPDATE wlvlp_purchases SET hosting_expires_at = ?, updated_at = ? WHERE purchase_id = ?"
              ).bind(renewedIso, timestamp, wlvlpPurchase.purchase_id).run();

              await r2Put(env.R2_VIRTUAL_LAUNCH, `wlvlp/receipts/hosting-renewal/${wlvlpPurchase.slug}-${timestamp}.json`, {
                event_type: 'wlvlp_hosting_renewed',
                account_id: wlvlpPurchase.account_id,
                slug: wlvlpPurchase.slug,
                purchase_id: wlvlpPurchase.purchase_id,
                subscription_id,
                invoice_id: invoice.id,
                hosting_expires_at_before: wlvlpPurchase.hosting_expires_at,
                hosting_expires_at_after: renewedIso,
                timestamp,
              });
            }

            // Handle GVLP renewals
            const operator = await env.DB.prepare(
              "SELECT * FROM gvlp_operators WHERE stripe_subscription_id = ?"
            ).bind(subscription_id).first();

            if (operator && GVLP_TIERS[operator.tier]) {
              const tierConfig = GVLP_TIERS[operator.tier];
              const tokenDifference = tierConfig.tokens - operator.tokens_balance;

              if (tokenDifference > 0) {
                await d1Run(env.DB,
                  "UPDATE gvlp_operators SET tokens_balance = tokens_balance + ?, tokens_granted_at = ?, updated_at = ? WHERE operator_id = ?",
                  [tokenDifference, timestamp, timestamp, operator.operator_id]
                );
              }
            }

            // Handle VLP renewals
            const subscription = await stripeGet(`/subscriptions/${subscription_id}`, env);
            const plan_key = subscription?.metadata?.plan_key;
            const account_id = subscription?.metadata?.account_id;

            if (plan_key && plan_key.startsWith('vlp_') && account_id) {
              const monthlyAllocation = getTokenGrant(plan_key);

              // Read current token balance from R2
              let currentBalance = { transcriptTokens: 0, taxGameTokens: 0 };
              try {
                const existingTokens = await r2Get(env.R2_VIRTUAL_LAUNCH, `tokens/${account_id}.json`);
                if (existingTokens) {
                  currentBalance = existingTokens;
                }
              } catch (e) {
                // Token file doesn't exist yet, start with zero balance
              }

              // Add monthly allocation to existing balance (tokens accumulate)
              const newBalance = {
                account_id,
                transcript_tokens: (currentBalance.transcript_tokens || 0) + monthlyAllocation.transcriptTokens,
                tax_game_tokens: (currentBalance.tax_game_tokens || 0) + monthlyAllocation.taxGameTokens,
                updated_at: timestamp
              };

              // Write receipt to R2
              const receiptKey = `receipts/vlp/renewal/${account_id}-${timestamp}.json`;
              await r2Put(env.R2_VIRTUAL_LAUNCH, receiptKey, {
                event_type: 'vlp_renewal',
                account_id,
                plan_key,
                subscription_id,
                invoice_id: invoice.id,
                tokens_granted: monthlyAllocation,
                tokens_before: currentBalance,
                tokens_after: newBalance,
                timestamp
              });

              // Write updated balance to R2 (canonical)
              await r2Put(env.R2_VIRTUAL_LAUNCH, `tokens/${account_id}.json`, newBalance);

              // Update D1 projection to match
              await d1Run(env.DB,
                `INSERT INTO tokens (account_id, transcript_tokens, tax_game_tokens, updated_at)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(account_id) DO UPDATE SET
                 transcript_tokens = excluded.transcript_tokens,
                 tax_game_tokens = excluded.tax_game_tokens,
                 updated_at = excluded.updated_at`,
                [account_id, newBalance.transcript_tokens, newBalance.tax_game_tokens, timestamp]
              );
            }
          }
        } else if (event.type === 'customer.subscription.updated') {
          const subscription = event.data.object;
          const subscription_id = subscription.id;
          // Handle tier changes if needed in future
        } else if (event.type === 'customer.subscription.deleted') {
          const subscription = event.data.object;
          const subscription_id = subscription.id;

          await d1Run(env.DB,
            "UPDATE gvlp_operators SET status = 'cancelled', tier = 'starter', updated_at = ? WHERE stripe_subscription_id = ?",
            [timestamp, subscription_id]
          );
        }

        return json({ ok: true }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Webhook processing failed' }, 500, request);
      }
    },
  },

  // GET /v1/gvlp/operator/:account_id
  {
    method: 'GET', pattern: '/v1/gvlp/operator/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const { account_id } = params;

      // Verify account ownership
      if (session.account_id !== account_id) {
        const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
        if (!account || account.role !== 'admin') {
          return json({ ok: false, error: 'FORBIDDEN', message: 'Account access required' }, 403, request);
        }
      }

      try {
        const operator = await env.DB.prepare(
          "SELECT * FROM gvlp_operators WHERE account_id = ?"
        ).bind(account_id).first();

        if (!operator) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Operator not found' }, 404, request);
        }

        // Get last 30 days play count
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const playsResult = await env.DB.prepare(
          "SELECT COUNT(*) as play_count FROM gvlp_game_plays WHERE client_id = ? AND created_at >= ?"
        ).bind(operator.client_id, thirtyDaysAgo).first();

        const unlocked_games = GVLP_GAME_UNLOCK[operator.tier] || [];

        return json({
          ok: true,
          operator: {
            ...operator,
            unlocked_games,
            play_count_30d: playsResult?.play_count || 0
          }
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch operator' }, 500, request);
      }
    },
  },

  // PATCH /v1/gvlp/operator/:account_id
  {
    method: 'PATCH', pattern: '/v1/gvlp/operator/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const { account_id } = params;

      // Verify account ownership
      if (session.account_id !== account_id) {
        const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
        if (!account || account.role !== 'admin') {
          return json({ ok: false, error: 'FORBIDDEN', message: 'Account access required' }, 403, request);
        }
      }

      try {
        const body = await parseBody(request);
        const { client_id } = body;

        if (!client_id) {
          return json({ ok: false, error: 'INVALID_REQUEST', message: 'Only client_id updates allowed' }, 400, request);
        }

        const operator = await env.DB.prepare(
          "SELECT * FROM gvlp_operators WHERE account_id = ?"
        ).bind(account_id).first();

        if (!operator) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Operator not found' }, 404, request);
        }

        const timestamp = new Date().toISOString();

        // Write receipt to R2
        const receiptKey = `gvlp/receipts/operator-update/${operator.operator_id}/${Date.now()}.json`;
        const receipt = {
          operator_id: operator.operator_id,
          old_client_id: operator.client_id,
          new_client_id: client_id,
          updated_by: session.account_id,
          timestamp
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, receiptKey, JSON.stringify(receipt));

        // Update canonical R2
        const canonicalKey = `gvlp/operators/${operator.operator_id}.json`;
        const existing = await r2Get(env.R2_VIRTUAL_LAUNCH, canonicalKey);
        const canonical = existing ? JSON.parse(existing) : {};
        canonical.client_id = client_id;
        canonical.updated_at = timestamp;
        await r2Put(env.R2_VIRTUAL_LAUNCH, canonicalKey, JSON.stringify(canonical));

        // Update D1
        await d1Run(env.DB,
          "UPDATE gvlp_operators SET client_id = ?, updated_at = ? WHERE operator_id = ?",
          [client_id, timestamp, operator.operator_id]
        );

        return json({
          ok: true,
          client_id
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to update operator' }, 500, request);
      }
    },
  },

  // GET /v1/gvlp/operator/:account_id/plays
  {
    method: 'GET', pattern: '/v1/gvlp/operator/:account_id/plays',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const { account_id } = params;

      // Verify account ownership
      if (session.account_id !== account_id) {
        const account = await env.DB.prepare("SELECT role FROM accounts WHERE account_id = ?").bind(session.account_id).first();
        if (!account || account.role !== 'admin') {
          return json({ ok: false, error: 'FORBIDDEN', message: 'Account access required' }, 403, request);
        }
      }

      try {
        const operator = await env.DB.prepare(
          "SELECT client_id FROM gvlp_operators WHERE account_id = ?"
        ).bind(account_id).first();

        if (!operator) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Operator not found' }, 404, request);
        }

        const url = new URL(request.url);
        const game_slug = url.searchParams.get('game_slug');
        const days = parseInt(url.searchParams.get('days') || '30');

        const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        let query = "SELECT * FROM gvlp_game_plays WHERE client_id = ? AND created_at >= ?";
        let queryParams = [operator.client_id, cutoffDate];

        if (game_slug) {
          query += " AND game_slug = ?";
          queryParams.push(game_slug);
        }

        query += " ORDER BY created_at DESC";

        const result = await env.DB.prepare(query).bind(...queryParams).all();

        const totalCount = await env.DB.prepare(
          "SELECT COUNT(*) as count FROM gvlp_game_plays WHERE client_id = ? AND created_at >= ?"
        ).bind(operator.client_id, cutoffDate).first();

        return json({
          ok: true,
          plays: result.results || [],
          total_count: totalCount?.count || 0
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch plays' }, 500, request);
      }
    },
  },

  // -------------------------------------------------------------------------
  // TCVLP (Tax Claim VLP)
  // -------------------------------------------------------------------------

  // POST /v1/tcvlp/onboarding
  {
    method: 'POST', pattern: '/v1/tcvlp/onboarding',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const body = await parseBody(request);
      if (!body) {
        return json({ ok: false, error: 'INVALID_JSON' }, 400, request);
      }

      const { firm_name, display_name, logo_url, welcome_message, slug } = body;

      if (!firm_name) {
        return json({ ok: false, error: 'MISSING_REQUIRED_FIELDS', required: ['firm_name'] }, 400, request);
      }

      const timestamp = new Date().toISOString();
      const pro_id = `TCVLP_PRO_${crypto.randomUUID()}`;

      // Slug logic
      let finalSlug;
      if (slug) {
        // User provided slug - sanitize and check uniqueness
        finalSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      } else {
        // Auto-generate from firm_name
        finalSlug = firm_name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      }

      // Check slug uniqueness
      const existingPro = await env.DB.prepare("SELECT pro_id FROM tcvlp_pros WHERE slug = ?").bind(finalSlug).first();
      if (existingPro) {
        if (slug) {
          // User provided slug is taken
          return json({ ok: false, error: 'SLUG_TAKEN', message: 'The requested slug is already in use' }, 409, request);
        } else {
          // Auto-generated slug is taken, add random suffix
          finalSlug = `${finalSlug}-${crypto.randomUUID().substring(0, 4)}`;
        }
      }

      try {
        // Write receipt to R2
        const receiptKey = `tcvlp/receipts/onboarding/${pro_id}/${timestamp}.json`;
        const receiptData = {
          event_id: `EVT_${crypto.randomUUID()}`,
          account_id: session.account_id,
          pro_id,
          firm_name,
          display_name,
          logo_url,
          welcome_message,
          slug: finalSlug,
          timestamp
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, receiptKey, receiptData);

        // Write canonical to R2
        const canonicalKey = `tcvlp/pros/${pro_id}.json`;
        const canonicalData = {
          pro_id,
          account_id: session.account_id,
          slug: finalSlug,
          firm_name,
          display_name: display_name || null,
          logo_url: logo_url || null,
          welcome_message: welcome_message || null,
          stripe_customer_id: null,
          stripe_subscription_id: null,
          status: 'active',
          created_at: timestamp,
          updated_at: timestamp
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, canonicalKey, canonicalData);

        // Insert into D1
        await d1Run(env.DB,
          `INSERT INTO tcvlp_pros (pro_id, account_id, slug, firm_name, display_name, logo_url, welcome_message, stripe_customer_id, stripe_subscription_id, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [pro_id, session.account_id, finalSlug, firm_name, display_name, logo_url, welcome_message, null, null, 'active', timestamp, timestamp]
        );

        return json({
          ok: true,
          pro_id,
          slug: finalSlug,
          landing_url: `https://${finalSlug}.taxclaim.virtuallaunch.pro`
        });
      } catch (e) {
        console.error('TCVLP onboarding error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to create professional profile' }, 500, request);
      }
    },
  },

  // GET /v1/tcvlp/pro/:pro_id
  {
    method: 'GET', pattern: '/v1/tcvlp/pro/:pro_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { pro_id } = params;

      try {
        const pro = await env.DB.prepare("SELECT firm_name, display_name, logo_url, welcome_message, slug FROM tcvlp_pros WHERE pro_id = ? AND status = 'active'").bind(pro_id).first();

        if (!pro) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Professional not found' }, 404, request);
        }

        return json({
          ok: true,
          firm_name: pro.firm_name,
          display_name: pro.display_name,
          logo_url: pro.logo_url,
          welcome_message: pro.welcome_message,
          slug: pro.slug
        });
      } catch (e) {
        console.error('TCVLP get pro error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch professional profile' }, 500, request);
      }
    },
  },

  // GET /v1/tcvlp/pro/by-slug/:slug
  {
    method: 'GET', pattern: '/v1/tcvlp/pro/by-slug/:slug',
    handler: async (_method, _pattern, params, request, env) => {
      const { slug } = params;

      try {
        const pro = await env.DB.prepare("SELECT firm_name, display_name, logo_url, welcome_message, slug FROM tcvlp_pros WHERE slug = ? AND status = 'active'").bind(slug).first();

        if (!pro) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Professional not found' }, 404, request);
        }

        return json({
          ok: true,
          firm_name: pro.firm_name,
          display_name: pro.display_name,
          logo_url: pro.logo_url,
          welcome_message: pro.welcome_message,
          slug: pro.slug
        });
      } catch (e) {
        console.error('TCVLP get pro by slug error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch professional profile' }, 500, request);
      }
    },
  },

  // GET /v1/tcvlp/mailing-address?state=XX
  {
    method: 'GET', pattern: '/v1/tcvlp/mailing-address',
    handler: async (_method, _pattern, _params, request, env) => {
      const url = new URL(request.url);
      const state = url.searchParams.get('state');

      if (!state || !IRS_843_MAILING_ADDRESSES[state.toUpperCase()]) {
        return json({ ok: false, error: 'STATE_NOT_FOUND', message: 'Invalid state code provided' }, 404, request);
      }

      return json({
        ok: true,
        state: state.toUpperCase(),
        address: IRS_843_MAILING_ADDRESSES[state.toUpperCase()]
      });
    },
  },

  // POST /v1/tcvlp/transcript/upload
  {
    method: 'POST', pattern: '/v1/tcvlp/transcript/upload',
    handler: async (_method, _pattern, _params, request, env) => {
      try {
        const formData = await request.formData();
        const pdfFile = formData.get('file');
        const pro_id = formData.get('pro_id');

        if (!pdfFile || !pro_id) {
          return json({ ok: false, error: 'MISSING_REQUIRED_FIELDS', required: ['file', 'pro_id'] }, 400, request);
        }

        // Verify pro exists
        const pro = await env.DB.prepare("SELECT pro_id FROM tcvlp_pros WHERE pro_id = ? AND status = 'active'").bind(pro_id).first();
        if (!pro) {
          return json({ ok: false, error: 'INVALID_PRO_ID', message: 'Professional not found' }, 400, request);
        }

        // Extract text from PDF
        const pdfBytes = await pdfFile.arrayBuffer();
        const extractedText = extractTextFromPdf(new Uint8Array(pdfBytes));

        if (!extractedText) {
          return json({ ok: false, error: 'EXTRACTION_FAILED', message: 'Failed to extract text from PDF' }, 400, request);
        }

        // Parse transcript and filter for Kwong window
        const transactions = parseTranscriptText(extractedText);

        // Filter for Kwong window: Jan 20, 2020 – Jul 10, 2023
        const kwongStart = new Date('2020-01-20');
        const kwongEnd = new Date('2023-07-10');
        const penaltyCodes = ['160', '270', '276', '304', '306', '308'];

        const kwongTransactions = transactions.filter(tx => {
          const txDate = new Date(tx.date);
          return txDate >= kwongStart && txDate <= kwongEnd && penaltyCodes.includes(tx.code.replace('TC ', ''));
        });

        // Calculate totals
        let totalAmount = 0;
        const taxYears = new Set();

        kwongTransactions.forEach(tx => {
          totalAmount += parseFloat(tx.amount) || 0;
          // Extract tax year from date or description
          const year = new Date(tx.date).getFullYear();
          if (year >= 2020 && year <= 2023) {
            taxYears.add(year.toString());
          }
        });

        return json({
          ok: true,
          kwong_penalties: {
            total_amount: parseFloat(totalAmount.toFixed(2)),
            tax_years: Array.from(taxYears).sort(),
            transactions: kwongTransactions.map(tx => ({
              date: tx.date,
              code: tx.code,
              amount: parseFloat(tx.amount) || 0,
              description: tx.description || 'Penalty assessment'
            })),
            date_range: 'Jan 20, 2020 – Jul 10, 2023'
          }
        });
      } catch (e) {
        console.error('TCVLP transcript upload error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to process transcript' }, 500, request);
      }
    },
  },

  // POST /v1/tcvlp/forms/843/generate
  {
    method: 'POST', pattern: '/v1/tcvlp/forms/843/generate',
    handler: async (_method, _pattern, _params, request, env) => {
      const body = await parseBody(request);
      if (!body) {
        return json({ ok: false, error: 'INVALID_JSON' }, 400, request);
      }

      const {
        pro_id, taxpayer_name, taxpayer_email, tax_year, penalty_type, penalty_amount,
        state, transcript_used,
        ssn_ein, spouse_name, spouse_ssn, address, apt_suite, city, zip_code,
        ein, phone, irc_section
      } = body;

      if (!pro_id || !taxpayer_name || !tax_year || !penalty_type || !state) {
        return json({ ok: false, error: 'MISSING_REQUIRED_FIELDS', required: ['pro_id', 'taxpayer_name', 'tax_year', 'penalty_type', 'state'] }, 400, request);
      }

      // Validate state
      if (!IRS_843_MAILING_ADDRESSES[state.toUpperCase()]) {
        return json({ ok: false, error: 'INVALID_STATE', message: 'Invalid state code provided' }, 400, request);
      }

      // Validate tax year
      const yearNum = parseInt(tax_year);
      if (yearNum < 2020 || yearNum > 2023) {
        return json({ ok: false, error: 'INVALID_TAX_YEAR', message: 'Tax year must be between 2020-2023' }, 400, request);
      }

      // Verify pro exists
      const pro = await env.DB.prepare("SELECT pro_id FROM tcvlp_pros WHERE pro_id = ? AND status = 'active'").bind(pro_id).first();
      if (!pro) {
        return json({ ok: false, error: 'INVALID_PRO_ID', message: 'Professional not found' }, 400, request);
      }

      const timestamp = new Date().toISOString();
      const submission_id = `SUB_${crypto.randomUUID()}`;
      const mailing_address = IRS_843_MAILING_ADDRESSES[state.toUpperCase()];

      try {
        // Write receipt to R2
        const receiptKey = `tcvlp/receipts/form843/${pro_id}/${submission_id}.json`;
        const receiptData = {
          event_id: `EVT_${crypto.randomUUID()}`,
          submission_id,
          pro_id,
          taxpayer_name,
          taxpayer_email,
          tax_year,
          penalty_type,
          penalty_amount,
          state: state.toUpperCase(),
          mailing_address,
          transcript_used: transcript_used ? 1 : 0,
          timestamp
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, receiptKey, receiptData);

        // Write canonical to R2
        const canonicalKey = `tcvlp/form843/${pro_id}/${submission_id}.json`;
        const canonicalData = {
          submission_id,
          pro_id,
          taxpayer_name,
          taxpayer_email: taxpayer_email || null,
          tax_year,
          penalty_type,
          penalty_amount: penalty_amount || null,
          state: state.toUpperCase(),
          mailing_address,
          transcript_used: transcript_used ? 1 : 0,
          status: 'draft',
          created_at: timestamp,
          updated_at: timestamp
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, canonicalKey, canonicalData);

        // Insert into D1
        await d1Run(env.DB,
          `INSERT INTO tcvlp_form843_submissions (submission_id, pro_id, taxpayer_name, taxpayer_email, tax_year, penalty_type, penalty_amount, state, mailing_address, transcript_used, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [submission_id, pro_id, taxpayer_name, taxpayer_email, tax_year, penalty_type, penalty_amount, state.toUpperCase(), mailing_address, transcript_used ? 1 : 0, 'draft', timestamp, timestamp]
        );

        // --- PDF Generation via pdf-lib ---
        const pdfBytes = Uint8Array.from(atob(FORM_843_BASE64), c => c.charCodeAt(0));
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const form = pdfDoc.getForm();

        // Helper to safely set text fields
        const setField = (name, value) => {
          if (!value) return;
          try { form.getTextField(name).setText(String(value)); } catch { /* field not found */ }
        };
        const checkBox = (name) => {
          try { form.getCheckBox(name).check(); } catch { /* field not found */ }
        };

        // Top checkbox: "Abatement or refund of a penalty or addition to tax due to reasonable cause"
        checkBox('topmostSubform[0].Page1[0].c1_1[6]');

        // Taxpayer info
        setField('topmostSubform[0].Page1[0].f1_1[0]', taxpayer_name);
        setField('topmostSubform[0].Page1[0].f1_2[0]', ssn_ein);
        setField('topmostSubform[0].Page1[0].f1_3[0]', spouse_name);
        setField('topmostSubform[0].Page1[0].f1_4[0]', spouse_ssn);
        setField('topmostSubform[0].Page1[0].f1_5[0]', address);
        setField('topmostSubform[0].Page1[0].f1_6[0]', apt_suite);
        setField('topmostSubform[0].Page1[0].f1_7[0]', city);
        setField('topmostSubform[0].Page1[0].f1_8[0]', state.toUpperCase());
        setField('topmostSubform[0].Page1[0].f1_9[0]', zip_code);
        setField('topmostSubform[0].Page1[0].f1_10[0]', ein);
        setField('topmostSubform[0].Page1[0].f1_15[0]', phone);

        // Line 1: Tax period
        setField('topmostSubform[0].Page1[0].f1_16[0]', `01/01/${tax_year}`);
        setField('topmostSubform[0].Page1[0].f1_17[0]', `12/31/${tax_year}`);

        // Line 2: Amount
        if (penalty_amount) {
          setField('topmostSubform[0].Page1[0].f1_18[0]', String(penalty_amount));
        }

        // Line 4e: Income tax checkbox
        checkBox('topmostSubform[0].Page1[0].c1_5[0]');

        // Line 5i: 1040 checkbox
        checkBox('topmostSubform[0].Page2[0].c2_8[0]');

        // Line 6: IRC section
        const ircSectionValue = irc_section || '6651';
        setField('topmostSubform[0].Page2[0].f2_2[0]', ircSectionValue);

        // Line 7c: Reasonable cause
        checkBox('topmostSubform[0].Page2[0].c2_15[2]');

        // Line 8: Explanation
        const explanation = `Claim for refund of ${penalty_type} penalty assessed for tax year ${tax_year}. `
          + `Per Kwong v. United States, No. 22-1993T (Fed. Cl. 2023), the U.S. Court of Federal Claims held that the IRS exceeded its authority in assessing certain penalties between January 20, 2020 and July 10, 2023. `
          + `Taxpayer requests abatement and refund of $${penalty_amount || '[amount]'} in penalties assessed during this period. `
          + `This claim is timely filed before the July 10, 2026 deadline established by the court.`;
        setField('topmostSubform[0].Page2[0].ExplainWhy[0].f2_3[0]', explanation);

        // Flatten form fields so they can't be edited
        form.flatten();

        const filledPdf = await pdfDoc.save();

        // Store filled PDF in R2 for download
        await env.R2_VIRTUAL_LAUNCH.put(
          `tcvlp/forms/843/${submission_id}.pdf`,
          filledPdf,
          { httpMetadata: { contentType: 'application/pdf' } }
        );

        return json({
          ok: true,
          submission_id,
          mailing_address,
          pdf_url: `/v1/tcvlp/forms/843/${submission_id}/download`,
          pdf_generated: true,
          preparation_guide: {
            taxpayer_name,
            tax_year,
            penalty_type,
            penalty_amount: penalty_amount || 'To be determined',
            state: state.toUpperCase(),
            mailing_address,
            kwong_citation: 'Kwong v. United States, No. 22-1993T (Fed. Cl. 2023)',
            claim_basis: 'Claim for refund of penalties assessed between January 20, 2020 and July 10, 2023 under the Kwong decision. The U.S. Court of Federal Claims held that the IRS exceeded its authority in assessing certain penalties during this period.',
            deadline_notice: 'IMPORTANT: Claims must be filed by July 10, 2026.',
            official_form_url: 'https://www.irs.gov/pub/irs-pdf/f843.pdf',
            watermark: 'PREPARATION GUIDE — NOT AN OFFICIAL IRS FORM'
          }
        });
      } catch (e) {
        console.error('TCVLP Form 843 generation error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to generate Form 843 preparation guide' }, 500, request);
      }
    },
  },

  // POST /v1/tcvlp/forms/843/submit
  {
    method: 'POST', pattern: '/v1/tcvlp/forms/843/submit',
    handler: async (_method, _pattern, _params, request, env) => {
      const body = await parseBody(request);
      if (!body) {
        return json({ ok: false, error: 'INVALID_JSON' }, 400, request);
      }

      const { submission_id, confirmed } = body;

      if (!submission_id || !confirmed) {
        return json({ ok: false, error: 'MISSING_REQUIRED_FIELDS', required: ['submission_id', 'confirmed'] }, 400, request);
      }

      const timestamp = new Date().toISOString();

      try {
        // Update D1 status
        const result = await env.DB.prepare(
          "UPDATE tcvlp_form843_submissions SET status = 'submitted', updated_at = ? WHERE submission_id = ?"
        ).bind(timestamp, submission_id).run();

        if (result.changes === 0) {
          return json({ ok: false, error: 'SUBMISSION_NOT_FOUND', message: 'Submission not found' }, 404, request);
        }

        // Update R2 canonical
        const canonicalKey = `tcvlp/form843/${submission_id.split('_')[1]}/${submission_id}.json`;
        const canonicalData = await r2Get(env.R2_VIRTUAL_LAUNCH, canonicalKey);

        if (canonicalData) {
          const parsedData = JSON.parse(canonicalData);
          parsedData.status = 'submitted';
          parsedData.submitted_at = timestamp;
          parsedData.updated_at = timestamp;
          await r2Put(env.R2_VIRTUAL_LAUNCH, canonicalKey, parsedData);
        }

        return json({
          ok: true,
          submission_id,
          status: 'submitted'
        });
      } catch (e) {
        console.error('TCVLP Form 843 submission error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to submit Form 843' }, 500, request);
      }
    },
  },

  // GET /v1/tcvlp/forms/843/:submission_id/download
  {
    method: 'GET', pattern: '/v1/tcvlp/forms/843/:submission_id/download',
    handler: async (_method, _pattern, params, request, env) => {
      const { error, session } = await requireSession(request, env);
      if (error) return error;

      const { submission_id } = params;
      if (!submission_id) {
        return json({ ok: false, error: 'MISSING_SUBMISSION_ID' }, 400, request);
      }

      // Verify the session account owns this submission (no IDOR)
      const submission = await env.DB.prepare(
        'SELECT submission_id, taxpayer_name, pro_id FROM tcvlp_form843_submissions WHERE submission_id = ?'
      ).bind(submission_id).first();

      if (!submission) {
        return json({ ok: false, error: 'NOT_FOUND', message: 'Form 843 submission not found' }, 404, request);
      }

      // Check that the pro's account matches the session account
      const pro = await env.DB.prepare(
        'SELECT account_id FROM tcvlp_pros WHERE pro_id = ?'
      ).bind(submission.pro_id).first();

      if (!pro || pro.account_id !== session.account_id) {
        return json({ ok: false, error: 'FORBIDDEN', message: 'You do not have access to this form' }, 403, request);
      }

      // Read PDF from R2
      const pdfObject = await env.R2_VIRTUAL_LAUNCH.get(`tcvlp/forms/843/${submission_id}.pdf`);
      if (!pdfObject) {
        return json({ ok: false, error: 'PDF_NOT_FOUND', message: 'PDF has not been generated for this submission' }, 404, request);
      }

      const safeName = (submission.taxpayer_name || 'taxpayer').replace(/[^a-zA-Z0-9 -]/g, '').replace(/\s+/g, '-');
      return new Response(pdfObject.body, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="Form-843-${safeName}.pdf"`,
          'Cache-Control': 'private, no-cache',
        },
      });
    },
  },

  // -------------------------------------------------------------------------
  // WLVLP (Website Lotto VLP)
  // -------------------------------------------------------------------------

  // GET /v1/wlvlp/asset-pages/:slug
  // Public read-only route serving WLVLP SCALE campaign asset page JSON from R2.
  // No auth required — these back cold-email landing pages.
  {
    method: 'GET', pattern: '/v1/wlvlp/asset-pages/:slug',
    handler: async (_method, _pattern, params, request, env) => {
      const rawSlug = params.slug || '';
      // Sanitize: alphanumeric + hyphens only, max 200 chars
      if (!/^[a-zA-Z0-9-]{1,200}$/.test(rawSlug)) {
        return json({ ok: false, error: 'not_found' }, 404, request);
      }
      try {
        const obj = await env.R2_VIRTUAL_LAUNCH.get(`vlp-scale/wlvlp-asset-pages/${rawSlug}.json`);
        if (!obj) {
          return json({ ok: false, error: 'not_found' }, 404, request);
        }
        const data = await obj.json();
        return json(data, 200, request);
      } catch (e) {
        console.error('WLVLP asset page read error:', e);
        return json({ ok: false, error: 'not_found' }, 404, request);
      }
    },
  },

  // GET /v1/wlvlp/templates
  {
    method: 'GET', pattern: '/v1/wlvlp/templates',
    handler: async (_method, _pattern, _params, request, env) => {
      const url = new URL(request.url);
      const category = url.searchParams.get('category');
      const status = url.searchParams.get('status');
      const sort = url.searchParams.get('sort');

      let query = "SELECT * FROM wlvlp_templates";
      const conditions = [];
      const bindings = [];

      if (category) {
        conditions.push("category = ?");
        bindings.push(category);
      }
      if (status) {
        conditions.push("status = ?");
        bindings.push(status);
      }

      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }

      if (sort === 'votes') {
        query += " ORDER BY vote_count DESC";
      } else if (sort === 'newest') {
        query += " ORDER BY created_at DESC";
      } else {
        query += " ORDER BY title ASC";
      }

      try {
        const templatesResult = await env.DB.prepare(query).bind(...bindings).all();
        const templates = templatesResult.results || [];

        // Get active bid counts for each template
        for (const template of templates) {
          const bidCountResult = await env.DB.prepare(
            "SELECT COUNT(*) as bid_count FROM wlvlp_bids WHERE slug = ? AND status = 'active'"
          ).bind(template.slug).first();
          template.active_bid_count = bidCountResult?.bid_count || 0;
        }

        return json({
          ok: true,
          templates
        }, 200, request);
      } catch (e) {
        console.error('WLVLP templates list error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR' }, 500, request);
      }
    },
  },

  // GET /v1/wlvlp/templates/:slug
  {
    method: 'GET', pattern: '/v1/wlvlp/templates/:slug',
    handler: async (_method, _pattern, params, request, env) => {
      const { slug } = params;

      try {
        // Get template details
        const template = await env.DB.prepare(
          "SELECT * FROM wlvlp_templates WHERE slug = ?"
        ).bind(slug).first();

        if (!template) {
          return json({ ok: false, error: 'TEMPLATE_NOT_FOUND' }, 404, request);
        }

        // Get highest bid
        const highestBid = await env.DB.prepare(
          "SELECT MAX(amount) as highest_bid FROM wlvlp_bids WHERE slug = ? AND status = 'active'"
        ).bind(slug).first();

        // Get recent bid history (last 10)
        const bidHistoryResult = await env.DB.prepare(
          "SELECT amount, created_at FROM wlvlp_bids WHERE slug = ? AND status = 'active' ORDER BY amount DESC LIMIT 10"
        ).bind(slug).all();

        return json({
          ok: true,
          template,
          highest_bid: highestBid?.highest_bid || null,
          bid_history: bidHistoryResult.results || []
        }, 200, request);
      } catch (e) {
        console.error('WLVLP template get error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR' }, 500, request);
      }
    },
  },

  // POST /v1/wlvlp/templates/:slug/vote
  {
    method: 'POST', pattern: '/v1/wlvlp/templates/:slug/vote',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const { slug } = params;
      const timestamp = new Date().toISOString();
      const vote_id = `VOTE_${crypto.randomUUID()}`;

      try {
        // Write receipt to R2
        const receiptKey = `wlvlp/receipts/votes/${slug}/${session.account_id}/${timestamp}.json`;
        const receipt = {
          vote_id,
          slug,
          account_id: session.account_id,
          timestamp,
          type: 'template_vote'
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, receiptKey, receipt);

        // Update template vote count
        await env.DB.prepare(
          "UPDATE wlvlp_templates SET vote_count = vote_count + 1, updated_at = ? WHERE slug = ?"
        ).bind(timestamp, slug).run();

        // Get updated vote count
        const template = await env.DB.prepare(
          "SELECT vote_count FROM wlvlp_templates WHERE slug = ?"
        ).bind(slug).first();

        return json({
          ok: true,
          vote_count: template?.vote_count || 0
        }, 200, request);
      } catch (e) {
        console.error('WLVLP vote error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR' }, 500, request);
      }
    },
  },

  // POST /v1/wlvlp/templates/:slug/bid
  {
    method: 'POST', pattern: '/v1/wlvlp/templates/:slug/bid',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const { slug } = params;
      const body = await parseBody(request);
      if (!body || !body.amount) {
        return json({ ok: false, error: 'MISSING_AMOUNT' }, 400, request);
      }

      const { amount } = body;
      if (!Number.isInteger(amount) || amount < 1) {
        return json({ ok: false, error: 'INVALID_AMOUNT' }, 400, request);
      }

      const timestamp = new Date().toISOString();
      const bid_id = `BID_${crypto.randomUUID()}`;

      try {
        // Get template details
        const template = await env.DB.prepare(
          "SELECT * FROM wlvlp_templates WHERE slug = ?"
        ).bind(slug).first();

        if (!template) {
          return json({ ok: false, error: 'TEMPLATE_NOT_FOUND' }, 404, request);
        }

        if (!['available', 'auction'].includes(template.status)) {
          return json({ ok: false, error: 'TEMPLATE_NOT_AVAILABLE' }, 400, request);
        }

        if (amount < template.bid_start_price) {
          return json({ ok: false, error: 'BID_TOO_LOW', min_bid: template.bid_start_price }, 400, request);
        }

        // Check if auction has ended
        if (template.auction_ends_at && new Date(template.auction_ends_at) < new Date()) {
          return json({ ok: false, error: 'AUCTION_ENDED' }, 400, request);
        }

        // Get current highest bid
        const highestBidResult = await env.DB.prepare(
          "SELECT MAX(amount) as highest_bid FROM wlvlp_bids WHERE slug = ? AND status = 'active'"
        ).bind(slug).first();
        const currentHighBid = highestBidResult?.highest_bid || 0;

        if (amount <= currentHighBid) {
          return json({ ok: false, error: 'BID_TOO_LOW', current_high_bid: currentHighBid }, 400, request);
        }

        // Set auction end time if this is the first bid
        let auctionEndsAt = template.auction_ends_at;
        if (template.status === 'available') {
          auctionEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
          await env.DB.prepare(
            "UPDATE wlvlp_templates SET status = 'auction', auction_ends_at = ?, updated_at = ? WHERE slug = ?"
          ).bind(auctionEndsAt, timestamp, slug).run();
        }

        // Write receipt to R2
        const receiptKey = `wlvlp/receipts/bids/${slug}/${bid_id}.json`;
        const receipt = {
          bid_id,
          slug,
          account_id: session.account_id,
          amount,
          timestamp,
          type: 'template_bid'
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, receiptKey, receipt);

        // Insert bid record
        await env.DB.prepare(
          "INSERT INTO wlvlp_bids (bid_id, slug, account_id, amount, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)"
        ).bind(bid_id, slug, session.account_id, amount, timestamp).run();

        return json({
          ok: true,
          bid_id,
          auction_ends_at: auctionEndsAt,
          current_high_bid: amount
        }, 200, request);
      } catch (e) {
        console.error('WLVLP bid error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR' }, 500, request);
      }
    },
  },

  // GET /v1/wlvlp/templates/:slug/bids
  {
    method: 'GET', pattern: '/v1/wlvlp/templates/:slug/bids',
    handler: async (_method, _pattern, params, request, env) => {
      const { slug } = params;

      try {
        const bidsResult = await env.DB.prepare(
          "SELECT bid_id, account_id, amount, created_at FROM wlvlp_bids WHERE slug = ? ORDER BY amount DESC"
        ).bind(slug).all();

        const bids = (bidsResult.results || []).map(bid => ({
          ...bid,
          // Mask account_id for privacy
          account_id: bid.account_id.substring(0, 4) + '****'
        }));

        return json({
          ok: true,
          bids
        }, 200, request);
      } catch (e) {
        console.error('WLVLP bids list error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR' }, 500, request);
      }
    },
  },

  // POST /v1/wlvlp/checkout
  // Allows anonymous checkout: { slug, tier, email? }
  // tier: "standard" | "premium"
  {
    method: 'POST', pattern: '/v1/wlvlp/checkout',
    handler: async (_method, _pattern, _params, request, env) => {
      // Optional session — anonymous buyers allowed
      const session = await getSessionFromRequest(request, env);
      const accountId = session?.account_id || null;
      const sessionEmail = session?.email || null;

      try {
        const body = await request.json();
        const { slug, tier, email: bodyEmail } = body || {};

        if (!slug || typeof slug !== 'string') {
          return json({ ok: false, error: 'MISSING_SLUG' }, 400, request);
        }
        if (!tier || !['standard', 'premium'].includes(tier)) {
          return json({ ok: false, error: 'INVALID_TIER', message: 'tier must be "standard" or "premium"' }, 400, request);
        }

        const WLVLP_PRICE_MAP = {
          standard: env.STRIPE_PRICE_WLVLP_STANDARD,
          premium:  env.STRIPE_PRICE_WLVLP_PREMIUM,
        };
        const stripe_price_id = WLVLP_PRICE_MAP[tier];
        if (!stripe_price_id) {
          return json({ ok: false, error: 'PRICE_NOT_CONFIGURED' }, 503, request);
        }

        // WLVLP price IDs live in the Virtual Launch Pro Stripe account.
        // STRIPE_SECRET_KEY belongs to the TaxMonitor Pro account, so we
        // must use STRIPE_SECRET_KEY_VLP for any WLVLP/VLP-account prices.
        const vlpSecretKey = env.STRIPE_SECRET_KEY_VLP;
        if (!vlpSecretKey) {
          console.error('WLVLP checkout: STRIPE_SECRET_KEY_VLP secret is not set');
          return json({ ok: false, error: 'STRIPE_NOT_CONFIGURED' }, 503, request);
        }

        const customerEmail = sessionEmail || (typeof bodyEmail === 'string' ? bodyEmail.trim() : '') || null;

        const sessionPayload = {
          mode: 'payment',
          line_items: [{ price: stripe_price_id, quantity: 1 }],
          success_url: 'https://websitelotto.virtuallaunch.pro/purchase-success?session_id={CHECKOUT_SESSION_ID}',
          cancel_url: `https://websitelotto.virtuallaunch.pro/sites/${slug}`,
          client_reference_id: accountId || 'anonymous',
          metadata: {
            platform: 'wlvlp',
            slug,
            tier,
            account_id: accountId || 'anonymous'
          }
        };

        if (customerEmail) {
          sessionPayload.customer_email = customerEmail;
        }

        const checkout_session = await stripePost('/checkout/sessions', sessionPayload, env, vlpSecretKey);

        return json({ ok: true, session_url: checkout_session.url }, 200, request);
      } catch (e) {
        console.error('WLVLP checkout error:', e?.message, e?.stack);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to create checkout session' }, 500, request);
      }
    },
  },

  // POST /v1/wlvlp/scratch
  {
    method: 'POST', pattern: '/v1/wlvlp/scratch',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const timestamp = new Date().toISOString();
      const ticket_id = `TKT_${crypto.randomUUID()}`;

      try {
        // Check if account already has an unscratched ticket
        const existingTicket = await env.DB.prepare(
          "SELECT ticket_id FROM wlvlp_scratch_tickets WHERE account_id = ? AND status = 'unscratched'"
        ).bind(session.account_id).first();

        if (existingTicket) {
          return json({ ok: false, error: 'ALREADY_HAS_UNSCRATCHED_TICKET' }, 409, request);
        }

        // Write ticket to R2
        const ticketKey = `wlvlp/scratch/${session.account_id}/${ticket_id}.json`;
        const ticketData = {
          ticket_id,
          account_id: session.account_id,
          status: 'unscratched',
          created_at: timestamp
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, ticketKey, ticketData);

        // Insert into D1
        await env.DB.prepare(
          "INSERT INTO wlvlp_scratch_tickets (ticket_id, account_id, status, created_at) VALUES (?, ?, 'unscratched', ?)"
        ).bind(ticket_id, session.account_id, timestamp).run();

        return json({
          ok: true,
          ticket_id
        }, 200, request);
      } catch (e) {
        console.error('WLVLP scratch create error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR' }, 500, request);
      }
    },
  },

  // POST /v1/wlvlp/scratch/:ticket_id/reveal
  {
    method: 'POST', pattern: '/v1/wlvlp/scratch/:ticket_id/reveal',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const { ticket_id } = params;
      const timestamp = new Date().toISOString();

      try {
        // Verify ticket ownership and status
        const ticket = await env.DB.prepare(
          "SELECT * FROM wlvlp_scratch_tickets WHERE ticket_id = ? AND account_id = ?"
        ).bind(ticket_id, session.account_id).first();

        if (!ticket) {
          return json({ ok: false, error: 'TICKET_NOT_FOUND' }, 404, request);
        }

        if (ticket.status !== 'unscratched') {
          return json({ ok: false, error: 'TICKET_ALREADY_SCRATCHED' }, 400, request);
        }

        // Draw prize using weighted random
        const prize = drawScratchPrize();

        // Write receipt to R2
        const receiptKey = `wlvlp/receipts/scratch/${session.account_id}/${ticket_id}.json`;
        const receipt = {
          ticket_id,
          account_id: session.account_id,
          prize_type: prize.prize_type,
          prize_value: prize.prize_value,
          timestamp,
          type: 'scratch_reveal'
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, receiptKey, receipt);

        // Update ticket in R2 canonical
        const ticketKey = `wlvlp/scratch/${session.account_id}/${ticket_id}.json`;
        const updatedTicketData = {
          ticket_id,
          account_id: session.account_id,
          status: 'scratched',
          prize_type: prize.prize_type,
          prize_value: prize.prize_value,
          revealed_at: timestamp,
          created_at: ticket.created_at
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, ticketKey, updatedTicketData);

        // Update D1 projection
        await env.DB.prepare(
          "UPDATE wlvlp_scratch_tickets SET status = 'scratched', prize_type = ?, prize_value = ?, revealed_at = ? WHERE ticket_id = ?"
        ).bind(prize.prize_type, prize.prize_value, timestamp, ticket_id).run();

        return json({
          ok: true,
          prize_type: prize.prize_type,
          prize_value: prize.prize_value
        }, 200, request);
      } catch (e) {
        console.error('WLVLP scratch reveal error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR' }, 500, request);
      }
    },
  },

  // GET /v1/wlvlp/buyer/:account_id
  {
    method: 'GET', pattern: '/v1/wlvlp/buyer/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const { account_id } = params;

      // Verify account matches session
      if (account_id !== session.account_id) {
        return json({ ok: false, error: 'UNAUTHORIZED' }, 403, request);
      }

      try {
        // Get purchase record
        const purchase = await env.DB.prepare(
          "SELECT * FROM wlvlp_purchases WHERE account_id = ? AND status = 'active'"
        ).bind(account_id).first();

        if (!purchase) {
          return json({ ok: false, error: 'NO_ACTIVE_PURCHASE' }, 404, request);
        }

        // Get template details
        const template = await env.DB.prepare(
          "SELECT * FROM wlvlp_templates WHERE slug = ?"
        ).bind(purchase.slug).first();

        // Get site config
        const config = await env.DB.prepare(
          "SELECT * FROM wlvlp_site_configs WHERE slug = ?"
        ).bind(purchase.slug).first();

        // Get active scratch tickets
        const scratchTicketsResult = await env.DB.prepare(
          "SELECT * FROM wlvlp_scratch_tickets WHERE account_id = ? AND status = 'unscratched'"
        ).bind(account_id).all();

        return json({
          ok: true,
          purchase,
          template,
          config,
          scratch_tickets: scratchTicketsResult.results || []
        }, 200, request);
      } catch (e) {
        console.error('WLVLP buyer get error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR' }, 500, request);
      }
    },
  },

  // GET /v1/wlvlp/sites/by-account/:account_id
  {
    method: 'GET', pattern: '/v1/wlvlp/sites/by-account/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const { account_id } = params;
      if (account_id !== session.account_id) {
        return json({ ok: false, error: 'UNAUTHORIZED' }, 403, request);
      }

      try {
        const result = await env.DB.prepare(
          "SELECT * FROM wlvlp_purchases WHERE account_id = ? ORDER BY purchased_at DESC"
        ).bind(account_id).all();
        return json({ ok: true, sites: result.results || [] }, 200, request);
      } catch (e) {
        // Table missing or column missing — return empty list gracefully
        console.error('WLVLP sites by-account error:', e?.message);
        return json({ ok: true, sites: [] }, 200, request);
      }
    },
  },

  // PATCH /v1/wlvlp/config/:slug
  {
    method: 'PATCH', pattern: '/v1/wlvlp/config/:slug',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const { slug } = params;
      const body = await parseBody(request);
      if (!body) {
        return json({ ok: false, error: 'INVALID_JSON' }, 400, request);
      }

      const timestamp = new Date().toISOString();

      try {
        // Verify ownership
        const purchase = await env.DB.prepare(
          "SELECT * FROM wlvlp_purchases WHERE account_id = ? AND slug = ? AND status = 'active'"
        ).bind(session.account_id, slug).first();

        if (!purchase) {
          return json({ ok: false, error: 'UNAUTHORIZED' }, 403, request);
        }

        // Update R2 canonical config
        const configKey = `wlvlp/configs/${slug}.json`;
        const configData = {
          slug,
          account_id: session.account_id,
          config_json: JSON.stringify(body),
          updated_at: timestamp
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, configKey, configData);

        // Update D1 projection
        await env.DB.prepare(
          "UPDATE wlvlp_site_configs SET config_json = ?, updated_at = ? WHERE slug = ?"
        ).bind(JSON.stringify(body), timestamp, slug).run();

        return json({ ok: true }, 200, request);
      } catch (e) {
        console.error('WLVLP config update error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR' }, 500, request);
      }
    },
  },

  // PATCH /v1/wlvlp/sites/:slug/data
  {
    method: 'PATCH', pattern: '/v1/wlvlp/sites/:slug/data',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const { slug } = params;
      const body = await parseBody(request);
      if (!body || typeof body.fields !== 'object' || body.fields === null) {
        return json({ ok: false, error: 'INVALID_PAYLOAD' }, 400, request);
      }

      try {
        // Verify ownership: session account must own this slug
        const purchase = await env.DB.prepare(
          "SELECT purchase_id FROM wlvlp_purchases WHERE account_id = ? AND slug = ? AND status = 'active'"
        ).bind(session.account_id, slug).first();

        if (!purchase) {
          return json({ ok: false, error: 'UNAUTHORIZED' }, 403, request);
        }

        const customizationsKey = `wlvlp/sites/${slug}/customizations.json`;

        // Merge with existing customizations so partial updates don't wipe other fields
        let existingFields = {};
        const existing = await r2Get(env.R2_VIRTUAL_LAUNCH, customizationsKey);
        if (existing) {
          try {
            const parsed = JSON.parse(existing);
            if (parsed && typeof parsed.fields === 'object' && parsed.fields !== null) {
              existingFields = parsed.fields;
            }
          } catch {}
        }

        const mergedFields = { ...existingFields, ...body.fields };
        const timestamp = new Date().toISOString();

        await r2Put(env.R2_VIRTUAL_LAUNCH, customizationsKey, {
          slug,
          account_id: session.account_id,
          fields: mergedFields,
          updated_at: timestamp,
        });

        return json({ ok: true }, 200, request);
      } catch (e) {
        console.error('WLVLP site data patch error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR' }, 500, request);
      }
    },
  },

  // GET /v1/wlvlp/sites/:slug/data
  {
    method: 'GET', pattern: '/v1/wlvlp/sites/:slug/data',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const { slug } = params;

      try {
        // Verify ownership: session account must own this slug
        const purchase = await env.DB.prepare(
          "SELECT purchase_id FROM wlvlp_purchases WHERE account_id = ? AND slug = ? AND status = 'active'"
        ).bind(session.account_id, slug).first();

        if (!purchase) {
          return json({ ok: false, error: 'UNAUTHORIZED' }, 403, request);
        }

        const customizationsKey = `wlvlp/sites/${slug}/customizations.json`;
        const existing = await r2Get(env.R2_VIRTUAL_LAUNCH, customizationsKey);

        if (!existing) {
          return json({ ok: true, fields: {} }, 200, request);
        }

        let fields = {};
        try {
          const parsed = JSON.parse(existing);
          if (parsed && typeof parsed.fields === 'object' && parsed.fields !== null) {
            fields = parsed.fields;
          }
        } catch {}

        return json({ ok: true, fields }, 200, request);
      } catch (e) {
        console.error('WLVLP site data get error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR' }, 500, request);
      }
    },
  },

  // POST /v1/wlvlp/sites/:slug/domain
  // Records a custom-domain connection request for a WLVLP site.
  // DNS verification + Cloudflare for SaaS hostname provisioning is manual for now.
  {
    method: 'POST', pattern: '/v1/wlvlp/sites/:slug/domain',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const { slug } = params;
      const body = await parseBody(request);
      const rawDomain = (body?.domain || '').toString().trim().toLowerCase();

      // Basic format check: no protocol, no path, valid hostname with TLD.
      const domainRegex = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/;
      if (!rawDomain || rawDomain.length > 253 || !domainRegex.test(rawDomain) ||
          rawDomain.includes('/') || rawDomain.includes(':') || rawDomain.includes(' ')) {
        return json({ ok: false, error: 'INVALID_DOMAIN' }, 400, request);
      }

      try {
        // Verify ownership: session account must own this slug.
        const purchase = await env.DB.prepare(
          "SELECT purchase_id FROM wlvlp_purchases WHERE account_id = ? AND slug = ? AND status = 'active'"
        ).bind(session.account_id, slug).first();

        if (!purchase) {
          return json({ ok: false, error: 'UNAUTHORIZED' }, 403, request);
        }

        const timestamp = new Date().toISOString();

        // Update R2 canonical site record (merge with existing).
        const siteKey = `wlvlp/sites/${slug}.json`;
        let siteRecord = {};
        const existingSite = await r2Get(env.R2_VIRTUAL_LAUNCH, siteKey);
        if (existingSite) {
          try {
            siteRecord = typeof existingSite === 'string' ? JSON.parse(existingSite) : existingSite;
          } catch {}
        }
        siteRecord.slug = slug;
        siteRecord.custom_domain = rawDomain;
        siteRecord.custom_domain_status = 'pending_dns';
        siteRecord.custom_domain_requested_at = timestamp;
        siteRecord.updated_at = timestamp;
        await r2Put(env.R2_VIRTUAL_LAUNCH, siteKey, siteRecord);

        // Write receipt for audit trail.
        await r2Put(env.R2_VIRTUAL_LAUNCH, `wlvlp/receipts/domain/${slug}-${timestamp}.json`, {
          event_type: 'wlvlp_custom_domain_requested',
          account_id: session.account_id,
          slug,
          domain: rawDomain,
          timestamp,
        });

        // Update D1 projection.
        await env.DB.prepare(
          "UPDATE wlvlp_purchases SET custom_domain = ?, updated_at = ? WHERE account_id = ? AND slug = ? AND status = 'active'"
        ).bind(rawDomain, timestamp, session.account_id, slug).run();

        return json({
          ok: true,
          domain: rawDomain,
          instructions: `Add a CNAME record pointing ${rawDomain} to sites.virtuallaunch.pro. We'll verify and activate within 24 hours.`,
        }, 200, request);
      } catch (e) {
        console.error('WLVLP custom domain error:', e?.message);
        return json({ ok: false, error: 'INTERNAL_ERROR' }, 500, request);
      }
    },
  },

  // GET /v1/wlvlp/sites/expiring
  // Admin-only. Returns active WLVLP sites whose hosting expires within 30 days.
  // Powers operator dashboard + reminder emails.
  {
    method: 'GET', pattern: '/v1/wlvlp/sites/expiring',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const account = await env.DB.prepare(
        "SELECT role FROM accounts WHERE account_id = ?"
      ).bind(session.account_id).first();
      if (!account || account.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      try {
        const result = await env.DB.prepare(
          `SELECT * FROM wlvlp_purchases
           WHERE status = 'active'
             AND hosting_expires_at IS NOT NULL
             AND hosting_expires_at < datetime('now', '+30 days')
           ORDER BY hosting_expires_at ASC`
        ).all();
        return json({ ok: true, sites: result.results || [] }, 200, request);
      } catch (e) {
        console.error('WLVLP expiring sites error:', e?.message);
        return json({ ok: false, error: 'INTERNAL_ERROR' }, 500, request);
      }
    },
  },

  // POST /v1/wlvlp/upload-logo
  {
    method: 'POST', pattern: '/v1/wlvlp/upload-logo',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      try {
        const formData = await request.formData();
        const file = formData.get('file');
        const slug = formData.get('slug');

        if (!file || !slug) {
          return json({ ok: false, error: 'MISSING_FILE_OR_SLUG' }, 400, request);
        }

        // Verify ownership
        const purchase = await env.DB.prepare(
          "SELECT * FROM wlvlp_purchases WHERE account_id = ? AND slug = ? AND status = 'active'"
        ).bind(session.account_id, slug).first();

        if (!purchase) {
          return json({ ok: false, error: 'UNAUTHORIZED' }, 403, request);
        }

        const timestamp = new Date().toISOString();
        const fileExtension = file.name.split('.').pop();
        const logoKey = `wlvlp/logos/${slug}/${timestamp}.${fileExtension}`;

        // Upload to R2
        await env.R2_VIRTUAL_LAUNCH.put(logoKey, file.stream());
        const logoUrl = `https://r2.virtuallaunch.pro/${logoKey}`;

        // Update D1 projection
        await env.DB.prepare(
          "UPDATE wlvlp_site_configs SET logo_url = ?, updated_at = ? WHERE slug = ?"
        ).bind(logoUrl, timestamp, slug).run();

        return json({
          ok: true,
          logo_url: logoUrl
        }, 200, request);
      } catch (e) {
        console.error('WLVLP logo upload error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR' }, 500, request);
      }
    },
  },

  // POST /v1/wlvlp/stripe/webhook
  {
    method: 'POST', pattern: '/v1/wlvlp/stripe/webhook',
    handler: async (_method, _pattern, _params, request, env) => {
      const signature = request.headers.get('stripe-signature');
      const body = await request.text();

      try {
        // Verify Stripe webhook signature
        const event = JSON.parse(body);
        const eventId = event.id;
        const timestamp = new Date().toISOString();

        if (event.type === 'checkout.session.completed') {
          const session = event.data.object;
          const { platform, slug, account_id, acquisition_type } = session.metadata || {};

          if (platform === 'wlvlp' && slug && account_id) {
            const purchase_id = `PUR_${crypto.randomUUID()}`;
            const monthly_price = Math.round(session.amount_total / 100);

            // Write receipt
            const receiptKey = `wlvlp/receipts/stripe/${eventId}.json`;
            const receipt = {
              event_id: eventId,
              type: 'purchase_completed',
              purchase_id,
              account_id,
              slug,
              acquisition_type,
              monthly_price,
              stripe_customer_id: session.customer,
              stripe_subscription_id: session.subscription,
              timestamp
            };
            await r2Put(env.R2_VIRTUAL_LAUNCH, receiptKey, receipt);

            // Update template status
            await env.DB.prepare(
              "UPDATE wlvlp_templates SET status = 'sold', current_owner_id = ?, updated_at = ? WHERE slug = ?"
            ).bind(account_id, timestamp, slug).run();

            // Create purchase record
            await env.DB.prepare(
              "INSERT INTO wlvlp_purchases (purchase_id, account_id, slug, acquisition_type, monthly_price, stripe_customer_id, stripe_subscription_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)"
            ).bind(purchase_id, account_id, slug, acquisition_type, monthly_price, session.customer, session.subscription, timestamp, timestamp).run();

            // Seed site config
            await env.DB.prepare(
              "INSERT INTO wlvlp_site_configs (slug, account_id, config_json, updated_at) VALUES (?, ?, '{}', ?)"
            ).bind(slug, account_id, timestamp).run();

            // Mark losing bids as lost if this was an auction win
            if (acquisition_type === 'auction_win') {
              await env.DB.prepare(
                "UPDATE wlvlp_bids SET status = 'lost' WHERE slug = ? AND account_id != ?"
              ).bind(slug, account_id).run();
            }
          }
        } else if (event.type === 'customer.subscription.deleted') {
          const subscription = event.data.object;

          // Find matching purchase
          const purchase = await env.DB.prepare(
            "SELECT * FROM wlvlp_purchases WHERE stripe_subscription_id = ? AND status = 'active'"
          ).bind(subscription.id).first();

          if (purchase) {
            const receiptKey = `wlvlp/receipts/recycle/${purchase.slug}/${timestamp}.json`;
            const receipt = {
              event_id: eventId,
              type: 'subscription_cancelled',
              account_id: purchase.account_id,
              slug: purchase.slug,
              timestamp
            };
            await r2Put(env.R2_VIRTUAL_LAUNCH, receiptKey, receipt);

            // Mark purchase as cancelled
            await env.DB.prepare(
              "UPDATE wlvlp_purchases SET status = 'cancelled', updated_at = ? WHERE purchase_id = ?"
            ).bind(timestamp, purchase.purchase_id).run();

            // Reset template to available
            await env.DB.prepare(
              "UPDATE wlvlp_templates SET status = 'available', current_owner_id = NULL, auction_ends_at = NULL, updated_at = ? WHERE slug = ?"
            ).bind(timestamp, purchase.slug).run();

            // Delete site config
            await env.DB.prepare(
              "DELETE FROM wlvlp_site_configs WHERE slug = ?"
            ).bind(purchase.slug).run();
          }
        }

        return json({ ok: true }, 200, request);
      } catch (e) {
        console.error('WLVLP Stripe webhook error:', e);
        return json({ ok: false, error: 'WEBHOOK_ERROR' }, 500, request);
      }
    },
  },

  // -------------------------------------------------------------------------
  // AFFILIATES
  // -------------------------------------------------------------------------

  {
    method: 'POST', pattern: '/v1/affiliates/connect/onboard',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      try {
        const onboardUrl = `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=${env.STRIPE_CONNECT_CLIENT_ID}&scope=read_write&redirect_uri=https://api.virtuallaunch.pro/v1/affiliates/connect/callback&state=${session.account_id}`;
        return json({ ok: true, onboard_url: onboardUrl }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Affiliate onboarding failed' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/affiliates/connect/callback',
    handler: async (_method, _pattern, _params, request, env) => {
      const url = new URL(request.url);
      const code = url.searchParams.get('code');
      const accountId = url.searchParams.get('state');

      if (!code || !accountId) {
        return new Response('', {
          status: 302,
          headers: {
            'Location': 'https://virtuallaunch.pro/dashboard/affiliate?error=invalid_request',
          },
        });
      }

      try {
        // The VLP affiliate program (Stripe Connect Express) is configured on the
        // Virtual Launch Pro Stripe account, not the TaxMonitor Pro account.
        const tokenResponse = await fetch('https://connect.stripe.com/oauth/token', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY_VLP || env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `grant_type=authorization_code&code=${code}`,
        });

        if (!tokenResponse.ok) {
          throw new Error('Stripe Connect token exchange failed');
        }

        const tokenData = await tokenResponse.json();
        const connectAccountId = tokenData.stripe_user_id;
        const now = new Date().toISOString();

        // Update affiliates table
        await d1Run(env.DB,
          'UPDATE affiliates SET stripe_connect_account_id = ?, connect_status = ?, updated_at = ? WHERE account_id = ?',
          [connectAccountId, 'active', now, accountId]
        );

        // Update R2 canonical
        const existingAffiliate = await env.R2_VIRTUAL_LAUNCH.get(`affiliates/${accountId}.json`);
        if (existingAffiliate) {
          const affiliateRecord = await existingAffiliate.json();
          affiliateRecord.stripe_connect_account_id = connectAccountId;
          affiliateRecord.connect_status = 'active';
          affiliateRecord.updated_at = now;
          await r2Put(env.R2_VIRTUAL_LAUNCH, `affiliates/${accountId}.json`, affiliateRecord);
        }

        return new Response('', {
          status: 302,
          headers: {
            'Location': 'https://virtuallaunch.pro/dashboard/affiliate?connected=true',
          },
        });
      } catch (e) {
        return new Response('', {
          status: 302,
          headers: {
            'Location': 'https://virtuallaunch.pro/dashboard/affiliate?error=connect_failed',
          },
        });
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/affiliates/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      if (session.account_id !== params.account_id) {
        return json({ ok: false, error: 'FORBIDDEN' }, 403, request);
      }

      try {
        let affiliateRow = await env.DB.prepare('SELECT * FROM affiliates WHERE account_id = ?').bind(params.account_id).first();
        if (!affiliateRow) {
          // Auto-create affiliate row for legacy accounts that pre-date the affiliate program
          const referralCode = Array.from(crypto.getRandomValues(new Uint8Array(6)))
            .map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32])
            .join('');
          const now = new Date().toISOString();
          await d1Run(env.DB,
            'INSERT OR IGNORE INTO affiliates (account_id, referral_code, created_at) VALUES (?, ?, ?)',
            [params.account_id, referralCode, now]
          );
          await r2Put(env.R2_VIRTUAL_LAUNCH, `affiliates/${params.account_id}.json`, {
            account_id: params.account_id,
            referral_code: referralCode,
            connect_status: 'pending',
            balance_pending: 0,
            balance_paid: 0,
            created_at: now
          });
          affiliateRow = await env.DB.prepare('SELECT * FROM affiliates WHERE account_id = ?').bind(params.account_id).first();
          if (!affiliateRow) {
            return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to create affiliate row' }, 500, request);
          }
        }

        // Count referred accounts
        const referralCount = await env.DB.prepare('SELECT COUNT(*) as count FROM affiliate_events WHERE referrer_account_id = ?').bind(params.account_id).first();

        return json({
          ok: true,
          affiliate: {
            referral_code: affiliateRow.referral_code,
            connect_status: affiliateRow.connect_status,
            balance_pending: affiliateRow.balance_pending,
            balance_paid: affiliateRow.balance_paid,
            referral_url: `https://virtuallaunch.pro/ref/${affiliateRow.referral_code}`,
            referred_count: referralCount?.count || 0,
          },
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Affiliate lookup failed' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/affiliates/:account_id/events',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      if (session.account_id !== params.account_id) {
        return json({ ok: false, error: 'FORBIDDEN' }, 403, request);
      }

      const url = new URL(request.url);
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
      const offset = parseInt(url.searchParams.get('offset') || '0');

      try {
        const events = await env.DB.prepare(
          'SELECT * FROM affiliate_events WHERE referrer_account_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).bind(params.account_id, limit, offset).all();

        return json({
          ok: true,
          events: events.results || [],
          pagination: { limit, offset },
        });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Events lookup failed' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/affiliates/payout/request',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      try {
        const affiliateRow = await env.DB.prepare('SELECT * FROM affiliates WHERE account_id = ?').bind(session.account_id).first();
        if (!affiliateRow) {
          return json({ ok: false, error: 'NOT_FOUND', message: 'Affiliate record not found' }, 404, request);
        }

        if (affiliateRow.connect_status !== 'active') {
          return json({ ok: false, error: 'CONNECT_REQUIRED', message: 'Stripe Connect account required' }, 400, request);
        }

        if (affiliateRow.balance_pending < 1000) { // Minimum $10.00 payout
          return json({ ok: false, error: 'INSUFFICIENT_BALANCE', message: 'Minimum $10.00 required for payout' }, 400, request);
        }

        const payoutId = `PAY_${crypto.randomUUID()}`;
        const amount = affiliateRow.balance_pending;
        const now = new Date().toISOString();

        // Create Stripe Transfer on the VLP Stripe account (where the affiliate
        // Connect Express accounts live).
        const transferResponse = await fetch('https://api.stripe.com/v1/transfers', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY_VLP || env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `amount=${amount}&currency=usd&destination=${affiliateRow.stripe_connect_account_id}`,
        });

        if (!transferResponse.ok) {
          return json({ ok: false, error: 'TRANSFER_FAILED', message: 'Stripe transfer failed' }, 500, request);
        }

        const transferData = await transferResponse.json();

        // Write receipt
        await r2Put(env.R2_VIRTUAL_LAUNCH, `affiliates/receipts/payouts/${payoutId}.json`, {
          payout_id: payoutId,
          account_id: session.account_id,
          stripe_transfer_id: transferData.id,
          amount,
          status: 'pending',
          requested_at: now
        });

        // Insert into affiliate_payouts
        await d1Run(env.DB,
          'INSERT INTO affiliate_payouts (payout_id, account_id, stripe_transfer_id, amount, status, requested_at) VALUES (?, ?, ?, ?, ?, ?)',
          [payoutId, session.account_id, transferData.id, amount, 'pending', now]
        );

        // Update affiliates balance
        await d1Run(env.DB,
          'UPDATE affiliates SET balance_pending = balance_pending - ?, balance_paid = balance_paid + ?, updated_at = ? WHERE account_id = ?',
          [amount, amount, now, session.account_id]
        );

        // Update R2 canonical
        const existingAffiliate = await env.R2_VIRTUAL_LAUNCH.get(`affiliates/${session.account_id}.json`);
        if (existingAffiliate) {
          const affiliateRecord = await existingAffiliate.json();
          affiliateRecord.balance_pending = (affiliateRecord.balance_pending || 0) - amount;
          affiliateRecord.balance_paid = (affiliateRecord.balance_paid || 0) + amount;
          affiliateRecord.updated_at = now;
          await r2Put(env.R2_VIRTUAL_LAUNCH, `affiliates/${session.account_id}.json`, affiliateRecord);
        }

        return json({ ok: true, payout_id: payoutId, amount, status: 'pending' });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Payout request failed' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/affiliates/payout/:payout_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      try {
        const payoutRow = await env.DB.prepare('SELECT * FROM affiliate_payouts WHERE payout_id = ?').bind(params.payout_id).first();
        if (!payoutRow) {
          return json({ ok: false, error: 'NOT_FOUND' }, 404, request);
        }

        if (payoutRow.account_id !== session.account_id) {
          return json({ ok: false, error: 'FORBIDDEN' }, 403, request);
        }

        return json({ ok: true, payout: payoutRow });
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Payout lookup failed' }, 500, request);
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/ref/:code',
    handler: async (_method, _pattern, params, request, env) => {
      const referralCode = params.code;

      try {
        const affiliateRow = await env.DB.prepare('SELECT account_id FROM affiliates WHERE referral_code = ?').bind(referralCode).first();
        if (affiliateRow) {
          return new Response('', {
            status: 302,
            headers: {
              'Location': `https://virtuallaunch.pro?ref=${referralCode}`,
            },
          });
        }
      } catch (e) {
        // Ignore errors, fall through to default redirect
      }

      return new Response('', {
        status: 302,
        headers: {
          'Location': 'https://virtuallaunch.pro',
        },
      });
    },
  },

  // -------------------------------------------------------------------------
  // SCALE OUTREACH
  // -------------------------------------------------------------------------

  {
    method: 'GET', pattern: '/scale/asset-page/:slug',
    handler: async (_method, _pattern, params, request, env) => {
      try {
        const obj = await env.R2_VIRTUAL_LAUNCH.get(`vlp-scale/asset-pages/${params.slug}.json`);
        if (!obj) {
          return json({ error: 'not found' }, 404, request);
        }
        const data = await obj.json();
        return json(data, 200, request);
      } catch (e) {
        return json({ error: 'not found' }, 404, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/scale/init-send-state',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      // Admin-only route - check role via accounts table
      const adminAccount = await env.DB.prepare(
        'SELECT role FROM accounts WHERE account_id = ?'
      ).bind(session.account_id).first();
      if (!adminAccount || adminAccount.role !== 'admin') {
        return json({ ok: false, error: 'FORBIDDEN', message: 'Admin access required' }, 403, request);
      }

      const body = await parseBody(request);
      if (!body?.send_start_date) {
        return json({ ok: false, error: 'MISSING_FIELDS', message: 'send_start_date required' }, 400, request);
      }

      // Validate date format (YYYY-MM-DD)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.send_start_date)) {
        return json({ ok: false, error: 'VALIDATION', message: 'send_start_date must be YYYY-MM-DD format' }, 400, request);
      }

      try {
        const eventId = `EVT_${crypto.randomUUID()}`;
        const now = new Date().toISOString();

        // Create send state object
        const sendState = {
          send_start_date: body.send_start_date,
          total_sent: 0
        };

        // Write receipt
        const receipt = {
          eventId,
          timestamp: now,
          type: 'scale-init-send-state',
          accountId: session.account_id,
          payload: body,
          result: sendState
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, `vlp-scale/receipts/init/${eventId}.json`, JSON.stringify(receipt));

        // Write canonical send state
        await r2Put(env.R2_VIRTUAL_LAUNCH, `vlp-scale/send-state.json`, JSON.stringify(sendState));

        return json({ ok: true, eventId, status: 'initialized' }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to initialize send state' }, 500, request);
      }
    },
  },

  // -------------------------------------------------------------------------
  // R2 Read Route
  // -------------------------------------------------------------------------

  {
    method: 'GET', pattern: '/v1/r2/*',
    handler: async (_method, _pattern, _params, request, env) => {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'unauthorized' }, 401, request);
      }
      const token = authHeader.substring('Bearer '.length);
      if (token !== env.R2_CANONICAL_WRITE_TOKEN) {
        return json({ error: 'unauthorized' }, 401, request);
      }

      const url = new URL(request.url);
      const key = decodeURIComponent(url.pathname.substring('/v1/r2/'.length));

      if (!key) {
        return json({ error: 'missing R2 key' }, 400, request);
      }

      const object = await env.R2_VIRTUAL_LAUNCH.get(key);
      if (!object) {
        return json({ error: 'not found', key }, 404, request);
      }

      const text = await object.text();
      return new Response(text, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(request),
        },
      });
    },
  },

  // -------------------------------------------------------------------------
  // R2 Write Route
  // -------------------------------------------------------------------------

  {
    method: 'PUT', pattern: '/v1/r2/*',
    handler: async (_method, _pattern, params, request, env) => {
      try {
        // Extract R2 key from URL path after /v1/r2/
        const url = new URL(request.url);
        const key = decodeURIComponent(url.pathname.substring('/v1/r2/'.length));

        if (!key) {
          return json({ error: 'missing R2 key' }, 400, request);
        }

        // Validate Bearer token
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return json({ error: 'unauthorized' }, 401, request);
        }

        const token = authHeader.substring('Bearer '.length);
        if (token !== env.R2_CANONICAL_WRITE_TOKEN) {
          return json({ error: 'unauthorized' }, 401, request);
        }

        // Get request body
        const body = await request.text();

        // Write directly to R2 — body is already a JSON string, do not re-stringify
        await env.R2_VIRTUAL_LAUNCH.put(key, body, {
          httpMetadata: { contentType: 'application/json' },
        });

        return json({ ok: true, key }, 200, request);
      } catch (error) {
        console.error('R2 write error:', error);
        return json({ error: 'r2 write failed' }, 500, request);
      }
    },
  },

  // -------------------------------------------------------------------------
  // Scale Assets (Public Route)
  // -------------------------------------------------------------------------

  {
    method: 'GET', pattern: '/v1/scale/asset/:slug',
    handler: async (_method, _pattern, params, request, env) => {
      const { slug } = params;

      // Validate slug: lowercase alphanumeric and hyphens only, max 100 chars
      if (!slug || typeof slug !== 'string' || slug.length > 100) {
        return json({ error: 'invalid_slug' }, 400, request);
      }

      const slugRegex = /^[a-z0-9-]+$/;
      if (!slugRegex.test(slug)) {
        return json({ error: 'invalid_slug' }, 400, request);
      }

      try {
        // Read from R2 key: vlp-scale/asset-pages/${slug}.json
        const r2Key = `vlp-scale/asset-pages/${slug}.json`;
        const object = await env.R2_VIRTUAL_LAUNCH.get(r2Key);

        if (!object) {
          return json({ error: 'not_found' }, 404, request);
        }

        // Return the object contents as JSON
        const content = await object.json();
        return json(content, 200, request);
      } catch (error) {
        console.error('Scale asset read error:', error);
        return json({ error: 'not_found' }, 404, request);
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
// WLVLP Subdomain Site Handler
// ---------------------------------------------------------------------------

async function handleWlvlpSite(slug, request, env) {
  // 1. Fetch template HTML from R2
  const templateKey = `wlvlp/sites/${slug}/index.html`;
  const templateObj = await env.R2_VIRTUAL_LAUNCH.get(templateKey);

  if (!templateObj) {
    return new Response('Site not found', { status: 404 });
  }

  let html = await templateObj.text();

  // 2. Fetch buyer config from R2
  const configKey = `wlvlp/configs/${slug}.json`;
  const configObj = await env.R2_VIRTUAL_LAUNCH.get(configKey);

  if (configObj) {
    const config = JSON.parse(await configObj.text());
    // 3. Inject config — replace defaultConfig in the HTML
    html = html.replace(
      /const defaultConfig\s*=\s*\{[^}]*\}/s,
      `const defaultConfig = ${JSON.stringify(config)}`
    );
  }

  // 4. Check auth cookie for edit panel injection
  const cookie = request.headers.get('cookie') || '';
  const sessionMatch = cookie.match(/vlp_session=([^;]+)/);

  if (sessionMatch) {
    // Verify session owns this slug
    const session = await getSessionFromRequest(request, env);
    if (session) {
      const purchase = await env.DB.prepare(
        "SELECT slug FROM wlvlp_purchases WHERE account_id = ? AND slug = ? AND status = 'active'"
      ).bind(session.account_id, slug).first();

      if (purchase) {
        // Inject edit panel script before </body>
        const editPanelScript = `<script src="https://websitelotto.virtuallaunch.pro/_sdk/edit-panel.js"></script>`;
        html = html.replace('</body>', `${editPanelScript}</body>`);
      }
    }
  }

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'no-store',
    }
  });
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
      return new Response(null, { status: 204, headers: getCorsHeaders(request) });
    }

    // WLVLP subdomain site serving
    // Check if request is for {slug}.websitelotto.virtuallaunch.pro
    const host = request.headers.get('host') || '';
    const wlvlpMatch = host.match(/^([a-z0-9-]+)\.websitelotto\.virtuallaunch\.pro$/);

    if (wlvlpMatch) {
      const slug = wlvlpMatch[1];
      return handleWlvlpSite(slug, request, env);
    }

    // Handle /audit/{slug} → /asset/{slug} redirects
    if (pathname.startsWith('/audit/')) {
      const remainder = pathname.slice('/audit/'.length);
      const redirectTarget = `/asset/${remainder}`;
      return new Response(null, {
        status: 301,
        headers: {
          'Location': redirectTarget,
          ...getCorsHeaders(request)
        }
      });
    }

    const result = route(method, pathname);

    if (!result.matched) {
      if (result.reason === 'METHOD_NOT_ALLOWED') {
        return methodNotAllowed(method, pathname, request);
      }
      return notFound(pathname, request);
    }

    return result.handler(method, result.pattern, result.params, request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    // DVLP Job Matching Cron
    try {
      const eventId = `EVT_${crypto.randomUUID()}`;
      const timestamp = new Date().toISOString();

      // 1. Query active developers
      const developersResult = await env.DB.prepare(
        "SELECT developer_id, email, full_name, skills FROM dvlp_developers WHERE status='active' AND publish_profile=1"
      ).all();
      const developers = developersResult.results || [];

      // 2. Query open jobs
      const jobsResult = await env.DB.prepare(
        "SELECT job_id, title, description, skills_required FROM dvlp_jobs WHERE status='open'"
      ).all();
      const jobs = jobsResult.results || [];

      let matchesSent = 0;

      // 3. For each job, find skill-matching developers
      for (const job of jobs) {
        if (!job.skills_required) continue;

        const jobSkills = job.skills_required.toLowerCase().split(',').map(s => s.trim());

        for (const developer of developers) {
          if (!developer.skills) continue;

          const devSkills = developer.skills.toLowerCase().split(',').map(s => s.trim());

          // Simple skill matching - check if any job skill matches any dev skill
          const hasMatch = jobSkills.some(jobSkill =>
            devSkills.some(devSkill =>
              devSkill.includes(jobSkill) || jobSkill.includes(devSkill)
            )
          );

          if (hasMatch) {
            // 4. Send match notification email
            const subject = `New Job Match: ${job.title}`;
            const htmlBody = `
              <p>Hi ${developer.full_name},</p>
              <p>We found a job that matches your skills:</p>
              <h3>${job.title}</h3>
              <p>${job.description}</p>
              <p>Required skills: ${job.skills_required}</p>
              <p><a href="https://developers.virtuallaunch.pro/jobs/${job.job_id}">View Job Details</a></p>
            `;

            try {
              await sendEmail(developer.email, subject, htmlBody, env);
              matchesSent++;
            } catch (e) {
              console.error('Failed to send job match email:', e);
            }
          }
        }
      }

      // 5. Update developer nextNotificationDue in D1 (add column if needed in future migration)
      // For now, we'll track this in the receipt

      // 6. Write cron run receipt to R2
      const cronReceipt = {
        eventId,
        timestamp,
        type: 'dvlp-job-match-cron',
        stats: {
          developers_checked: developers.length,
          jobs_checked: jobs.length,
          matches_sent: matchesSent
        }
      };
      await r2Put(env.R2_VIRTUAL_LAUNCH, `dvlp/receipts/cron/${eventId}.json`, JSON.stringify(cronReceipt));

      console.log(`DVLP cron completed: ${matchesSent} matches sent`);
    } catch (e) {
      console.error('DVLP cron job failed:', e);

      // Write error receipt
      const errorEventId = `EVT_${crypto.randomUUID()}`;
      const errorReceipt = {
        eventId: errorEventId,
        timestamp: new Date().toISOString(),
        type: 'dvlp-job-match-cron-error',
        error: e.message
      };
      try {
        await r2Put(env.R2_VIRTUAL_LAUNCH, `dvlp/receipts/cron/${errorEventId}.json`, JSON.stringify(errorReceipt));
      } catch (receiptError) {
        console.error('Failed to write error receipt:', receiptError);
      }
    }

    // WLVLP Auction Settlement Cron
    try {
      const eventId = `EVT_${crypto.randomUUID()}`;
      const timestamp = new Date().toISOString();
      const now = new Date();

      // 1. Query ended auctions
      const endedAuctionsResult = await env.DB.prepare(
        "SELECT * FROM wlvlp_templates WHERE status = 'auction' AND auction_ends_at < ?"
      ).bind(now.toISOString()).all();
      const endedAuctions = endedAuctionsResult.results || [];

      let auctionsProcessed = 0;
      let winnersNotified = 0;

      // 2. For each ended auction
      for (const template of endedAuctions) {
        try {
          // Find highest bid
          const highestBid = await env.DB.prepare(
            "SELECT * FROM wlvlp_bids WHERE slug = ? AND status = 'active' ORDER BY amount DESC LIMIT 1"
          ).bind(template.slug).first();

          if (highestBid) {
            // Winner found - create Stripe Checkout Session for auction winner.
            // WLVLP products are sold via the VLP Stripe account.
            const stripeSession = await fetch('https://api.stripe.com/v1/checkout/sessions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${env.STRIPE_SECRET_KEY_VLP || env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                mode: 'subscription',
                'line_items[0][price_data][currency]': 'usd',
                'line_items[0][price_data][unit_amount]': (highestBid.amount * 100).toString(),
                'line_items[0][price_data][product_data][name]': `${template.title} - Website Template (Auction Winner)`,
                'line_items[0][price_data][recurring][interval]': 'month',
                'line_items[0][quantity]': '1',
                success_url: `https://websitelotto.virtuallaunch.pro/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `https://websitelotto.virtuallaunch.pro/templates/${template.slug}`,
                'metadata[platform]': 'wlvlp',
                'metadata[slug]': template.slug,
                'metadata[account_id]': highestBid.account_id,
                'metadata[acquisition_type]': 'auction_win'
              }),
            });

            if (stripeSession.ok) {
              const sessionData = await stripeSession.json();

              // Send winner notification email
              const winner = await env.DB.prepare(
                "SELECT email FROM accounts WHERE account_id = ?"
              ).bind(highestBid.account_id).first();

              if (winner?.email) {
                const subject = `🎉 You won the auction for ${template.title}!`;
                const htmlBody = `
                  <p>Congratulations! You won the auction for <strong>${template.title}</strong>.</p>
                  <p>Your winning bid: <strong>$${highestBid.amount}/month</strong></p>
                  <p>To claim your template, complete your payment:</p>
                  <p><a href="${sessionData.url}" style="background: #007cba; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">Complete Payment</a></p>
                  <p>This link expires in 24 hours.</p>
                `;

                try {
                  await sendEmail(winner.email, subject, htmlBody, env);
                  winnersNotified++;
                } catch (emailError) {
                  console.error('Failed to send auction winner email:', emailError);
                }
              }

              // Mark losing bids as lost
              await env.DB.prepare(
                "UPDATE wlvlp_bids SET status = 'lost' WHERE slug = ? AND account_id != ?"
              ).bind(template.slug, highestBid.account_id).run();

              // Set template status to pending_payment
              await env.DB.prepare(
                "UPDATE wlvlp_templates SET status = 'pending_payment', updated_at = ? WHERE slug = ?"
              ).bind(timestamp, template.slug).run();

              // Write auction settlement receipt
              const settlementReceipt = {
                eventId: `${eventId}_${template.slug}`,
                timestamp,
                type: 'auction_settlement',
                slug: template.slug,
                winner_account_id: highestBid.account_id,
                winning_bid: highestBid.amount,
                stripe_session_url: sessionData.url,
                action: 'winner_notified'
              };
              await r2Put(env.R2_VIRTUAL_LAUNCH, `wlvlp/receipts/cron/auction-settlement/${template.slug}/${timestamp}.json`, settlementReceipt);
            } else {
              console.error('Failed to create Stripe session for auction winner:', await stripeSession.text());
            }
          } else {
            // No bids - reset template to available
            await env.DB.prepare(
              "UPDATE wlvlp_templates SET status = 'available', auction_ends_at = NULL, updated_at = ? WHERE slug = ?"
            ).bind(timestamp, template.slug).run();

            // Write no-bids receipt
            const noBidsReceipt = {
              eventId: `${eventId}_${template.slug}`,
              timestamp,
              type: 'auction_settlement',
              slug: template.slug,
              action: 'reset_to_available'
            };
            await r2Put(env.R2_VIRTUAL_LAUNCH, `wlvlp/receipts/cron/auction-settlement/${template.slug}/${timestamp}.json`, noBidsReceipt);
          }

          auctionsProcessed++;
        } catch (templateError) {
          console.error(`Failed to process auction for ${template.slug}:`, templateError);
        }
      }

      // 3. Write master cron receipt
      const auctionCronReceipt = {
        eventId,
        timestamp,
        type: 'wlvlp-auction-settlement-cron',
        stats: {
          auctions_processed: auctionsProcessed,
          winners_notified: winnersNotified,
          ended_auctions_found: endedAuctions.length
        }
      };
      await r2Put(env.R2_VIRTUAL_LAUNCH, `wlvlp/receipts/cron/auction-settlement/${timestamp}.json`, auctionCronReceipt);

      console.log(`WLVLP auction settlement completed: ${auctionsProcessed} auctions processed, ${winnersNotified} winners notified`);
    } catch (e) {
      console.error('WLVLP auction settlement cron job failed:', e);

      // Write error receipt
      const errorEventId = `EVT_${crypto.randomUUID()}`;
      const errorReceipt = {
        eventId: errorEventId,
        timestamp: new Date().toISOString(),
        type: 'wlvlp-auction-settlement-cron-error',
        error: e.message
      };
      try {
        await r2Put(env.R2_VIRTUAL_LAUNCH, `wlvlp/receipts/cron/auction-settlement/${errorEventId}.json`, errorReceipt);
      } catch (receiptError) {
        console.error('Failed to write WLVLP auction settlement error receipt:', receiptError);
      }
    }

    // WLVLP Hosting Renewal Check Cron
    // Runs daily. Writes a 30-day reminder notification once per site, and
    // marks sites as expired when hosting_expires_at has passed without a
    // renewal extending the date (active subscriptions auto-extend via the
    // invoice.payment_succeeded webhook handler).
    try {
      const eventId = `EVT_${crypto.randomUUID()}`;
      const timestamp = new Date().toISOString();
      const nowIso = new Date().toISOString();

      let remindersWritten = 0;
      let sitesExpired = 0;

      // 1. 30-day reminders: active sites whose hosting expires within 30 days.
      const expiringResult = await env.DB.prepare(
        `SELECT * FROM wlvlp_purchases
         WHERE status = 'active'
           AND hosting_expires_at IS NOT NULL
           AND hosting_expires_at < datetime('now', '+30 days')
           AND hosting_expires_at > datetime('now')`
      ).all();
      const expiringSites = expiringResult.results || [];

      for (const site of expiringSites) {
        const reminderKey = `wlvlp/notifications/hosting-reminder-${site.slug}.json`;
        const existing = await env.R2_VIRTUAL_LAUNCH.get(reminderKey);
        if (existing) continue; // already reminded
        await r2Put(env.R2_VIRTUAL_LAUNCH, reminderKey, {
          type: 'wlvlp_hosting_expiring_soon',
          purchase_id: site.purchase_id,
          account_id: site.account_id,
          slug: site.slug,
          tier: site.tier,
          hosting_expires_at: site.hosting_expires_at,
          created_at: timestamp,
        });
        remindersWritten++;
      }

      // 2. Expire sites whose hosting has lapsed.
      const expiredResult = await env.DB.prepare(
        `SELECT * FROM wlvlp_purchases
         WHERE status = 'active'
           AND hosting_expires_at IS NOT NULL
           AND hosting_expires_at < ?`
      ).bind(nowIso).all();
      const expiredSites = expiredResult.results || [];

      for (const site of expiredSites) {
        await env.DB.prepare(
          "UPDATE wlvlp_purchases SET status = 'expired', updated_at = ? WHERE purchase_id = ?"
        ).bind(timestamp, site.purchase_id).run();

        await r2Put(env.R2_VIRTUAL_LAUNCH, `wlvlp/receipts/hosting-expired/${site.slug}-${timestamp}.json`, {
          event_type: 'wlvlp_hosting_expired',
          purchase_id: site.purchase_id,
          account_id: site.account_id,
          slug: site.slug,
          hosting_expires_at: site.hosting_expires_at,
          timestamp,
        });
        sitesExpired++;
      }

      await r2Put(env.R2_VIRTUAL_LAUNCH, `wlvlp/receipts/cron/hosting-check/${timestamp}.json`, {
        eventId,
        timestamp,
        type: 'wlvlp-hosting-check-cron',
        stats: {
          reminders_written: remindersWritten,
          sites_expired: sitesExpired,
          expiring_found: expiringSites.length,
        },
      });

      console.log(`WLVLP hosting check completed: ${remindersWritten} reminders, ${sitesExpired} expired`);
    } catch (e) {
      console.error('WLVLP hosting check cron failed:', e);
      const errorEventId = `EVT_${crypto.randomUUID()}`;
      try {
        await r2Put(env.R2_VIRTUAL_LAUNCH, `wlvlp/receipts/cron/hosting-check/${errorEventId}-error.json`, {
          eventId: errorEventId,
          timestamp: new Date().toISOString(),
          type: 'wlvlp-hosting-check-cron-error',
          error: e.message,
        });
      } catch (receiptError) {
        console.error('Failed to write WLVLP hosting check error receipt:', receiptError);
      }
    }

    // SCALE Email Sending Cron
    try {
      const eventId = `EVT_${crypto.randomUUID()}`;
      const timestamp = new Date().toISOString();
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

      // Helper function for delays
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

      // Read send state
      let sendState;
      try {
        const sendStateObj = await env.R2_VIRTUAL_LAUNCH.get(`vlp-scale/send-state.json`);
        if (!sendStateObj) {
          console.log('SCALE cron: No send-state.json found, skipping');
          return;
        }
        sendState = await sendStateObj.json();
      } catch (e) {
        console.error('SCALE cron: Failed to read send-state.json:', e);
        return;
      }

      // Calculate daily cap
      const startDate = new Date(sendState.send_start_date);
      const todayDate = new Date(today);
      const daysSinceStart = Math.ceil((todayDate - startDate) / (1000 * 60 * 60 * 24)) + 1; // inclusive

      let dailyCap;
      if (daysSinceStart <= 3) {
        dailyCap = 10;
      } else if (daysSinceStart <= 7) {
        dailyCap = 20;
      } else if (daysSinceStart <= 14) {
        dailyCap = 30;
      } else {
        dailyCap = 50;
      }

      let email1Sent = 0;
      let email2Sent = 0;

      // Email 1 Job
      try {
        const email1Obj = await env.R2_VIRTUAL_LAUNCH.get(`vlp-scale/send-queue/email1-pending.json`);
        if (email1Obj) {
          const email1Queue = await email1Obj.json();
          const eligibleForEmail1 = email1Queue.filter(record => !record.email_1_sent_at);
          const toSendEmail1 = eligibleForEmail1.slice(0, dailyCap);

          for (const record of toSendEmail1) {
            try {
              // Randomized delay: 45-90 seconds
              const delayMs = 45000 + Math.random() * 45000;
              await delay(delayMs);

              // Send email via Gmail
              await sendGmailMessage(env, record.email, record.subject, record.body);

              // Update record
              record.email_1_sent_at = new Date().toISOString();
              const twoDaysLater = new Date();
              twoDaysLater.setDate(twoDaysLater.getDate() + 2);
              record.email_2_scheduled_for = twoDaysLater.toISOString().split('T')[0];

              email1Sent++;
            } catch (e) {
              console.error(`SCALE cron: Failed to send email 1 to ${record.slug}/${record.email}:`, e.message);
            }
          }

          // Write back updated queue
          await r2Put(env.R2_VIRTUAL_LAUNCH, `vlp-scale/send-queue/email1-pending.json`, JSON.stringify(email1Queue));
        }
      } catch (e) {
        console.error('SCALE cron: Email 1 job failed:', e);
      }

      // Email 2 Job
      try {
        const email2Obj = await env.R2_VIRTUAL_LAUNCH.get(`vlp-scale/send-queue/email2-pending.json`);
        if (email2Obj) {
          const email2Queue = await email2Obj.json();
          const eligibleForEmail2 = email2Queue.filter(record =>
            !record.email_2_sent_at &&
            record.email_2_scheduled_for &&
            record.email_2_scheduled_for <= today
          );

          for (const record of eligibleForEmail2) {
            try {
              // Randomized delay: 30-60 seconds
              const delayMs = 30000 + Math.random() * 30000;
              await delay(delayMs);

              // Send email via Gmail
              await sendGmailMessage(env, record.email, record.subject, record.body);

              // Update record
              record.email_2_sent_at = new Date().toISOString();

              email2Sent++;
            } catch (e) {
              console.error(`SCALE cron: Failed to send email 2 to ${record.slug}/${record.email}:`, e.message);
            }
          }

          // Write back updated queue
          await r2Put(env.R2_VIRTUAL_LAUNCH, `vlp-scale/send-queue/email2-pending.json`, JSON.stringify(email2Queue));
        }
      } catch (e) {
        console.error('SCALE cron: Email 2 job failed:', e);
      }

      // Update send state with total sent count
      sendState.total_sent += email1Sent;
      await r2Put(env.R2_VIRTUAL_LAUNCH, `vlp-scale/send-state.json`, JSON.stringify(sendState));

      // Write cron receipt
      const cronReceipt = {
        eventId,
        timestamp,
        type: 'scale-email-cron',
        stats: {
          days_since_start: daysSinceStart,
          daily_cap: dailyCap,
          email_1_sent: email1Sent,
          email_2_sent: email2Sent,
          total_sent_overall: sendState.total_sent
        }
      };
      await r2Put(env.R2_VIRTUAL_LAUNCH, `vlp-scale/receipts/cron/${eventId}.json`, JSON.stringify(cronReceipt));

      console.log(`SCALE cron completed: ${email1Sent} email 1 sent, ${email2Sent} email 2 sent, ${sendState.total_sent} total overall`);
    } catch (e) {
      console.error('SCALE email cron failed:', e);

      // Write error receipt
      const errorEventId = `EVT_${crypto.randomUUID()}`;
      const errorReceipt = {
        eventId: errorEventId,
        timestamp: new Date().toISOString(),
        type: 'scale-email-cron-error',
        error: e.message
      };
      try {
        await r2Put(env.R2_VIRTUAL_LAUNCH, `vlp-scale/receipts/cron/${errorEventId}.json`, JSON.stringify(errorReceipt));
      } catch (receiptError) {
        console.error('Failed to write SCALE email cron error receipt:', receiptError);
      }
    }
  },
};




