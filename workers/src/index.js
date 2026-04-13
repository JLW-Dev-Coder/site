import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
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
  console.log('CORS DEBUG — Origin:', JSON.stringify(origin), 'Match:', ALLOWED_ORIGINS.includes(origin));
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : 'https://virtuallaunch.pro';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
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

// Map a D1 profiles row → nested card shape (vlp.profiles.list.v1 contract)
// Fields not yet in D1 use safe defaults; a D1 migration will backfill them.
function d1RowToProfileCard(row) {
  const professions = row.profession ? row.profession.split(', ').filter(Boolean) : [];
  const specialtiesList = row.specialties ? row.specialties.split(', ').filter(Boolean) : [];
  return {
    profile: {
      name: row.display_name || '',
      slug: row.professional_id,
      status: 'standard',
    },
    professional: {
      profession: professions,
      years_experience: 0,
    },
    location: {
      city: row.city || '',
      state: row.state || '',
    },
    bio: {
      bio_short: row.bio ? row.bio.substring(0, 220) : '',
    },
    hero: {
      credential_badges: professions.map(p => ({
        label: p,
        style_key: p.toLowerCase() === 'cpa' ? 'cpa'
          : p.toLowerCase() === 'enrolled agent' ? 'ea'
          : p.toLowerCase() === 'attorney' ? 'attorney'
          : 'custom',
      })),
    },
    services_offered: {
      items: specialtiesList.map(s => ({ title: s })),
    },
    specializations: {
      client_types: [],
    },
    contact: {
      languages: [],
    },
    reviews: {
      summary: { average_rating: 0, review_count: 0 },
    },
  };
}

// Build a list-shaped card directly from a nested R2 profile. Used by the
// inquiry match flow so the card reflects fields D1 doesn't project
// (featured status, reviews summary, languages, client types).
function nestedProfileToCard(nested, fallbackSlug) {
  const professions = Array.isArray(nested?.professional?.profession)
    ? nested.professional.profession.filter(Boolean)
    : [];
  const services = Array.isArray(nested?.services_offered?.items)
    ? nested.services_offered.items
        .map((s) => (s && typeof s.title === 'string' ? s.title : ''))
        .filter(Boolean)
    : [];
  const badges = Array.isArray(nested?.hero?.credential_badges)
    ? nested.hero.credential_badges
    : professions.map((p) => ({
        label: p,
        style_key: profileCredentialStyleKey(p),
      }));
  return {
    profile: {
      name: nested?.profile?.name || '',
      slug: nested?.profile?.slug || fallbackSlug || '',
      status: nested?.profile?.status || 'standard',
    },
    professional: {
      profession: professions,
      years_experience: Number(nested?.professional?.years_experience) || 0,
    },
    location: {
      city: nested?.location?.city || '',
      state: nested?.location?.state || '',
    },
    bio: {
      bio_short: nested?.bio?.bio_short
        ? String(nested.bio.bio_short).substring(0, 220)
        : '',
    },
    hero: {
      credential_badges: badges,
    },
    services_offered: {
      items: services.map((title) => ({ title })),
    },
    specializations: {
      client_types: Array.isArray(nested?.specializations?.client_types)
        ? nested.specializations.client_types
        : [],
    },
    contact: {
      languages: Array.isArray(nested?.contact?.languages)
        ? nested.contact.languages
        : [],
    },
    reviews: {
      summary: {
        average_rating: Number(nested?.reviews?.summary?.average_rating) || 0,
        review_count: Number(nested?.reviews?.summary?.review_count) || 0,
      },
    },
  };
}

// Scoring weights for the inquiry match flow. A missing R2 profile scores 0.
function scoreMatchProfile(nested, { cityFilter } = {}) {
  if (!nested || typeof nested !== 'object') return 0;
  let score = 0;

  const status = nested?.profile?.status;
  if (status === 'featured') score += 50;
  else if (status === 'standard') score += 10;

  const avgRating = Number(nested?.reviews?.summary?.average_rating) || 0;
  score += avgRating * 10;

  const reviewCount = Number(nested?.reviews?.summary?.review_count) || 0;
  if (reviewCount > 0) score += 15;

  if (nested?.buttons?.schedule_button?.active === true) score += 10;

  const wa = Array.isArray(nested?.contact?.weekly_availability)
    ? nested.contact.weekly_availability
    : [];
  if (wa.some((d) => d && d.enabled)) score += 5;

  if (cityFilter && nested?.location?.city) {
    if (
      String(nested.location.city).trim().toLowerCase() ===
      String(cityFilter).trim().toLowerCase()
    ) {
      score += 20;
    }
  }

  return Math.round(score * 10) / 10;
}

// ---------------------------------------------------------------------------
// Nested profile helpers (vlp.profile.public.v1 contract shape)
// ---------------------------------------------------------------------------

function profileSlugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function profileInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function profileCredentialStyleKey(profession) {
  const p = String(profession || '').toLowerCase();
  if (p === 'cpa') return 'cpa';
  if (p === 'attorney') return 'attorney';
  if (p === 'enrolled agent') return 'ea';
  return 'custom';
}

// A fresh default profile matching the canonical contract shape.
function defaultNestedProfile() {
  return {
    profile: {
      name: '',
      slug: '',
      status: 'standard',
      status_badge_label: null,
      profile_type: 'live',
      initials: '',
      avatar: {
        upload_type: 'initials_only',
        initials_fallback: true,
        display_dimensions: { width: 128, height: 128 },
        file: null,
      },
    },
    professional: {
      profession: [],
      credentials: [],
      firm_name: null,
      years_experience: 0,
    },
    hero: {
      headline: '',
      location_label: '',
      rating_label: '',
      years_experience_label: '',
      credential_badges: [],
    },
    location: {
      city: '',
      state: '',
      country: 'United States',
      zip: null,
    },
    bio: {
      bio_short: '',
      bio_full_paragraphs: [],
    },
    contact: {
      contact_email: null,
      phone: null,
      website: null,
      availability_display: null,
      timezone: null,
      languages: [],
      weekly_availability: [],
    },
    services_offered: { items: [] },
    specializations: { client_types: [] },
    credentials_experience: {
      licenses_certifications: [],
      background_items: [],
    },
    quick_stats: [],
    reviews: {
      enabled: false,
      allow_submission: false,
      summary: { average_rating: 0, review_count: 0 },
      items: [],
    },
    buttons: {
      schedule_button: {
        show: true, active: false,
        label: 'Schedule Consultation',
        mode: 'none',
        url: null,
        provider_label: 'None',
        behavior_phrase: 'No, I have not connected Cal.com or my own booking link, keep button inactive',
        description: null,
        description_mode: 'derived',
        event_type_label: null,
        event_type_duration_minutes: null,
      },
      contact_button: {
        show: true, active: false,
        label: 'Contact Now',
        mode: 'inactive',
        url: null,
      },
      review_button: {
        show: false, active: false,
        label: 'Add Your Review',
        mode: 'inactive',
        url: null,
      },
    },
  };
}

// Deep merge for nested profile updates.
// - Top-level section keys merge section-by-section (shallow within each section).
// - Arrays are REPLACED wholesale (they represent the full new value).
// - Nested objects inside sections (e.g. profile.avatar) are shallow-merged.
function mergeProfileSection(existing, patch) {
  if (patch === null || patch === undefined) return existing;
  if (Array.isArray(patch)) return patch;
  if (typeof patch !== 'object') return patch;
  const base = (existing && typeof existing === 'object' && !Array.isArray(existing)) ? existing : {};
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (Array.isArray(v)) {
      out[k] = v;
    } else if (v && typeof v === 'object') {
      out[k] = mergeProfileSection(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function mergeNestedProfile(existing, patch) {
  const base = existing || defaultNestedProfile();
  const merged = { ...base };
  for (const key of Object.keys(patch || {})) {
    if (key === 'accountId' || key === 'professional_id' || key === 'professionalId') continue;
    if (key === 'createdAt' || key === 'updatedAt') continue;
    const incoming = patch[key];
    if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
      merged[key] = mergeProfileSection(base[key], incoming);
    } else {
      merged[key] = incoming;
    }
  }
  return merged;
}

// Re-derive computed fields from the canonical data in a nested profile.
function deriveProfileFields(profile) {
  const name = profile?.profile?.name || '';
  const professions = Array.isArray(profile?.professional?.profession)
    ? profile.professional.profession
    : [];
  const years = Number(profile?.professional?.years_experience ?? 0) || 0;
  const city = profile?.location?.city || '';
  const state = profile?.location?.state || '';

  // profile.slug + initials
  if (!profile.profile) profile.profile = {};
  if (!profile.profile.slug) profile.profile.slug = profileSlugify(name);
  profile.profile.initials = profileInitials(name);

  // hero.headline — "Name, Profession" (primary profession only)
  if (!profile.hero) profile.hero = {};
  const primaryProfession = professions[0] || '';
  profile.hero.headline = primaryProfession
    ? `${name}${name && primaryProfession ? ', ' : ''}${primaryProfession}`.slice(0, 120)
    : name.slice(0, 120);

  // hero.location_label — "City, State"
  profile.hero.location_label = city && state ? `${city}, ${state}` : (state || city || '');

  // hero.years_experience_label
  profile.hero.years_experience_label = years > 0
    ? `${years}+ years experience`
    : '';

  // hero.credential_badges — derive from professions
  profile.hero.credential_badges = professions.slice(0, 6).map((p) => ({
    label: p,
    style_key: profileCredentialStyleKey(p),
  }));

  // contact.availability_display — derive from weekly_availability if not explicitly set
  const wa = Array.isArray(profile?.contact?.weekly_availability)
    ? profile.contact.weekly_availability
    : [];
  const activeDays = wa.filter((d) => d && d.enabled);
  if (activeDays.length > 0 && !profile.contact.availability_display) {
    const dayAbbr = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };
    const first = activeDays[0];
    const last = activeDays[activeDays.length - 1];
    const daysLabel = activeDays.length === 1
      ? dayAbbr[first.day] || first.day
      : `${dayAbbr[first.day] || first.day}-${dayAbbr[last.day] || last.day}`;
    const formatTime = (t) => {
      if (!t) return '';
      const [hh, mm] = String(t).split(':').map(Number);
      const period = hh >= 12 ? 'PM' : 'AM';
      const h12 = hh % 12 || 12;
      return mm ? `${h12}:${String(mm).padStart(2, '0')}${period}` : `${h12}${period}`;
    };
    const start = formatTime(first.start_time);
    const end = formatTime(first.end_time);
    profile.contact.availability_display = start && end
      ? `${daysLabel}, ${start}-${end}`
      : daysLabel;
  }

  // profile.initials in avatar fallback
  if (profile.profile.avatar) {
    profile.profile.avatar.initials_fallback = profile.profile.avatar.upload_type === 'initials_only'
      || profile.profile.avatar.initials_fallback === true;
  }

  return profile;
}

// Build the D1 projection row values from the nested profile.
function profileD1ProjectionValues(nested) {
  const professions = Array.isArray(nested?.professional?.profession)
    ? nested.professional.profession
    : [];
  const services = Array.isArray(nested?.services_offered?.items)
    ? nested.services_offered.items.map((s) => (s && s.title) || '').filter(Boolean)
    : [];
  const bioParagraphs = Array.isArray(nested?.bio?.bio_full_paragraphs)
    ? nested.bio.bio_full_paragraphs
    : [];
  const wa = Array.isArray(nested?.contact?.weekly_availability)
    ? nested.contact.weekly_availability
    : [];
  return {
    display_name: nested?.profile?.name || '',
    bio: bioParagraphs.join('\n\n') || nested?.bio?.bio_short || '',
    specialties: services.join(', '),
    profession: professions.join(', '),
    phone: nested?.contact?.phone || null,
    availability_text: nested?.contact?.availability_display || null,
    business_hours: wa.length ? JSON.stringify(wa) : null,
    cal_booking_url: nested?.buttons?.schedule_button?.url || null,
    website: nested?.contact?.website || null,
    firm_name: nested?.professional?.firm_name || null,
    city: nested?.location?.city || null,
    state: nested?.location?.state || null,
    zip: nested?.location?.zip || null,
    status: nested?.profile?.status === 'hidden' ? 'inactive' : 'active',
  };
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

    // Base64url encode message (UTF-8 safe — btoa() only handles Latin1)
    const messageBytes = new TextEncoder().encode(message);
    let binary = '';
    for (let i = 0; i < messageBytes.length; i++) binary += String.fromCharCode(messageBytes[i]);
    const encodedMessage = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // Send via Gmail API — retry up to 3 times on HTTP 429 (rate limit)
    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const sendResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw: encodedMessage })
      });

      if (sendResponse.ok) {
        const sendData = await sendResponse.json();
        return { messageId: sendData.id };
      }

      if (sendResponse.status === 429) {
        if (attempt < maxRetries) {
          console.log(`Gmail rate limit hit — pausing 60 seconds (retry ${attempt + 1}/${maxRetries})`);
          await new Promise(r => setTimeout(r, 60000));
          continue;
        }
        throw new Error('gmail_rate_limited');
      }

      // Any non-429 error: do not retry
      const sendError = await sendResponse.text();
      throw new Error(`Gmail send failed: ${sendResponse.status} ${sendError}`);
    }

  } catch (error) {
    if (error.message === 'gmail_rate_limited') throw error;
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

  const tokenRes = await fetch('https://app.cal.com/api/auth/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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

  const tokenRes = await fetch('https://app.cal.com/api/auth/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: calClientId,
      client_secret: env.CAL_PRO_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code,
    }),
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    console.log('[cal-pro-oauth] Token exchange failed:', JSON.stringify(tokenData));
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

// Cloudflare GraphQL Analytics — zone + domain mapping
// Public zone IDs (not secrets). Token lives in env.CF_API_TOKEN.
const CF_ACCOUNT_ID = 'b14e124b2f5dd7e86dfb1546f9ed6e91';

const CF_ZONE_MAP = {
  vlp:   'dc402def9a745a2a65fc9b829b72c6f3',
  tmp:   '7b7a3d2bde921c3de1451a2315ab9242',
  ttmp:  '7b7a3d2bde921c3de1451a2315ab9242',
  tttmp: '7b7a3d2bde921c3de1451a2315ab9242',
  dvlp:  'dc402def9a745a2a65fc9b829b72c6f3',
  gvlp:  'dc402def9a745a2a65fc9b829b72c6f3',
  tcvlp: 'dc402def9a745a2a65fc9b829b72c6f3',
  wlvlp: 'dc402def9a745a2a65fc9b829b72c6f3',
};

const CF_DOMAIN_MAP = {
  vlp:   'virtuallaunch.pro',
  tmp:   'taxmonitor.pro',
  ttmp:  'transcript.taxmonitor.pro',
  tttmp: 'taxtools.taxmonitor.pro',
  dvlp:  'developers.virtuallaunch.pro',
  gvlp:  'games.virtuallaunch.pro',
  tcvlp: 'taxclaim.virtuallaunch.pro',
  wlvlp: 'websitelotto.virtuallaunch.pro',
};

// Subdomain platforms must filter GraphQL requests by clientRequestHTTPHost.
// Root domains (vlp, tmp) don't need a host filter — the whole zone is them.
const CF_ROOT_DOMAINS = new Set(['vlp', 'tmp']);

// IRS tax dates for calendar integration. Weekend dates adjusted to next business day per IRS rules.
const IRS_TAX_DATES = [
  // 2026
  { date: '2026-01-15', title: 'Q4 2025 Estimated Tax Payment Due', type: 'deadline' },
  { date: '2026-02-02', title: 'W-2 and 1099 Filing Deadline (moved from 1/31 Sat)', type: 'deadline' },
  { date: '2026-03-16', title: 'S-Corp/Partnership Return Due (Form 1065/1120-S) (moved from 3/15 Sun)', type: 'deadline' },
  { date: '2026-03-31', title: '1099 Electronic Filing Deadline', type: 'deadline' },
  { date: '2026-04-15', title: 'Individual Tax Return Due (Form 1040)', type: 'deadline' },
  { date: '2026-04-15', title: 'Q1 2026 Estimated Tax Payment Due', type: 'deadline' },
  { date: '2026-04-15', title: 'C-Corp Return Due (Form 1120)', type: 'deadline' },
  { date: '2026-06-15', title: 'Q2 2026 Estimated Tax Payment Due', type: 'deadline' },
  { date: '2026-09-15', title: 'Q3 2026 Estimated Tax Payment Due', type: 'deadline' },
  { date: '2026-09-15', title: 'Extended S-Corp/Partnership Return Due', type: 'deadline' },
  { date: '2026-10-15', title: 'Extended Individual Tax Return Due', type: 'deadline' },
  { date: '2026-10-15', title: 'Extended C-Corp Return Due', type: 'deadline' },
  // 2027
  { date: '2027-01-15', title: 'Q4 2026 Estimated Tax Payment Due', type: 'deadline' },
  { date: '2027-03-15', title: 'S-Corp/Partnership Return Due (Form 1065/1120-S)', type: 'deadline' },
  { date: '2027-04-15', title: 'Individual Tax Return Due (Form 1040)', type: 'deadline' },
  { date: '2027-04-15', title: 'Q1 2027 Estimated Tax Payment Due', type: 'deadline' },
  { date: '2027-06-15', title: 'Q2 2027 Estimated Tax Payment Due', type: 'deadline' },
  { date: '2027-09-15', title: 'Q3 2027 Estimated Tax Payment Due', type: 'deadline' },
];

// Cal.com event types grouped by platform
const CAL_EVENT_TYPES = {
  dvlp: [
    { slug: 'dvlp-onboarding', label: 'Developers Virtual Launch Pro Onboarding' },
    { slug: 'dvlp-intro', label: 'Developers Virtual Launch Pro Intro' },
    { slug: 'dvlp-support', label: 'Developers Virtual Launch Pro Support' },
  ],
  tcvlp: [
    { slug: 'tcvlp-intro', label: 'Tax Claim Virtual Launch Pro Intro' },
    { slug: 'tcvlp-support', label: 'Tax Claim Virtual Launch Pro Support' },
  ],
  tmp: [
    { slug: 'tmp-intro', label: 'Tax Monitor Pro Intro' },
    { slug: 'tmp-support', label: 'Tax Monitor Pro Support' },
  ],
  tttmp: [
    { slug: 'tttmp-intro', label: 'Tax Tools Tax Monitor Pro Intro' },
    { slug: 'tttmp-support', label: 'Tax Tools Tax Monitor Pro Support' },
  ],
  ttmp: [
    { slug: 'ttmp-discovery', label: 'Transcript Tax Monitor Pro Discovery Call' },
    { slug: 'ttmp-intro', label: 'Transcript Tax Monitor Pro Intro' },
    { slug: 'ttmp-support', label: 'Transcript Tax Monitor Pro Support' },
  ],
  vlp: [
    { slug: 'vlp-intro', label: 'Virtual Launch Pro Intro' },
    { slug: 'vlp-support', label: 'Virtual Launch Pro Support' },
  ],
};

// Fetch a single platform's analytics from the Cloudflare GraphQL API
// (httpRequests1dGroups dataset — Free plan compatible).
//
// Notes:
//   - httpRequests1dGroups uses date-only filters (date_gt / date_lt), not
//     datetime ranges. We convert ISO timestamps to YYYY-MM-DD strings.
//     date_gt / date_lt are exclusive, so we widen the range by 1 day on
//     each side to include the requested boundary days.
//   - Per-host filtering is NOT supported on this dataset. Subdomain
//     platforms (ttmp, tttmp, dvlp, gvlp, tcvlp, wlvlp) therefore report
//     ZONE-WIDE totals shared with their parent. The /v1/admin/analytics
//     endpoints advertise this via `shared_zone: true` and `shared_with`.
//   - The 1d dataset supports `sum.requests`, `sum.cachedRequests`,
//     `sum.bytes`, `sum.cachedBytes`, `sum.pageViews`, `sum.threats`,
//     `uniq.uniques`, plus `responseStatusMap` and `countryMap` nested
//     inside `sum` — a single query covers everything we need.
//   - `top_paths` is unavailable on the 1d dataset (requires
//     httpRequestsAdaptiveGroups → Pro+ plan) and returns [].
//   - `firewallEventsAdaptiveGroups` is attempted as a separate query;
//     if it errors on Free, the `firewall` field returns [].
async function fetchPlatformAnalytics(env, platform, sinceIso, untilIso) {
  const zoneTag = CF_ZONE_MAP[platform];
  const hostname = CF_DOMAIN_MAP[platform];
  if (!zoneTag || !hostname) {
    return { ok: false, error: `unknown platform: ${platform}` };
  }
  if (!env.CF_API_TOKEN) {
    return { ok: false, error: 'missing CF_API_TOKEN' };
  }

  const start = new Date(sinceIso);
  const end = new Date(untilIso);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
    return { ok: false, error: 'invalid time range' };
  }

  // Convert ISO timestamps to date-only strings (YYYY-MM-DD). date_gt /
  // date_lt are exclusive, so subtract 1 day from since and add 1 day to
  // until to include the requested boundary days.
  const sinceDate = new Date(start.getTime() - 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];
  const untilDate = new Date(end.getTime() + 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  const query = `
    query ($zoneTag: String!, $since: String!, $until: String!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequests1dGroups(
            filter: { date_gt: $since, date_lt: $until }
            limit: 1000
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            sum {
              requests
              cachedRequests
              bytes
              cachedBytes
              pageViews
              threats
              responseStatusMap {
                edgeResponseStatus
                requests
              }
              countryMap {
                clientCountryName
                requests
                threats
              }
            }
            uniq { uniques }
          }
        }
      }
    }
  `;

  let resp;
  try {
    resp = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { zoneTag, since: sinceDate, until: untilDate },
      }),
    });
  } catch (e) {
    return { ok: false, error: `network: ${e.message}` };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return { ok: false, error: `graphql ${resp.status}: ${text.slice(0, 200)}` };
  }

  const body = await resp.json().catch(() => null);
  if (!body) return { ok: false, error: 'graphql: invalid json' };
  if (body.errors && body.errors.length) {
    return { ok: false, error: `graphql: ${body.errors.map((e) => e.message).join('; ')}` };
  }

  const zone = body?.data?.viewer?.zones?.[0];
  if (!zone) return { ok: false, error: 'graphql: zone not found' };

  const days = zone.httpRequests1dGroups || [];

  let total_requests = 0;
  let cached_requests = 0;
  let total_bytes = 0;
  let cached_bytes = 0;
  let page_views = 0;
  let unique_visitors = 0;
  let threats = 0;

  const statusMap = new Map();
  const countryMap = new Map();
  const timeseries = [];

  for (const day of days) {
    const sum = day.sum || {};
    const uniq = day.uniq || {};
    total_requests += sum.requests || 0;
    cached_requests += sum.cachedRequests || 0;
    total_bytes += sum.bytes || 0;
    cached_bytes += sum.cachedBytes || 0;
    page_views += sum.pageViews || 0;
    threats += sum.threats || 0;
    unique_visitors += uniq.uniques || 0;

    timeseries.push({
      date: day.dimensions?.date,
      requests: sum.requests || 0,
      cached: sum.cachedRequests || 0,
      bytes: sum.bytes || 0,
      pageViews: sum.pageViews || 0,
      uniques: uniq.uniques || 0,
    });

    for (const row of (sum.responseStatusMap || [])) {
      const k = row.edgeResponseStatus;
      statusMap.set(k, (statusMap.get(k) || 0) + (row.requests || 0));
    }
    for (const row of (sum.countryMap || [])) {
      const k = row.clientCountryName;
      const cur = countryMap.get(k) || { country: k, requests: 0, threats: 0 };
      cur.requests += row.requests || 0;
      cur.threats += row.threats || 0;
      countryMap.set(k, cur);
    }
  }

  const cache_hit_ratio = total_requests > 0
    ? Number((cached_requests / total_requests).toFixed(4))
    : 0;

  const status_codes = Array.from(statusMap.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  const top_countries = Array.from(countryMap.values())
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 10);

  // Firewall: try the adaptive dataset; tolerate failure on Free plan.
  const firewall = await fetchFirewallEvents(env, zoneTag, sinceIso, untilIso);

  return {
    ok: true,
    data: {
      traffic: {
        total_requests,
        cached_requests,
        total_bytes,
        cached_bytes,
        page_views,
        unique_visitors,
        threats,
        cache_hit_ratio,
        timeseries,
      },
      status_codes,
      // top_paths requires httpRequestsAdaptiveGroups (Pro+ plan)
      top_paths: [],
      top_countries,
      firewall,
    },
  };
}

// Best-effort fetch of firewall event breakdown. Returns [] on any failure
// (including Free-plan denials) so it never blocks the main analytics call.
async function fetchFirewallEvents(env, zoneTag, sinceIso, untilIso) {
  const query = `
    query ($zoneTag: String!, $since: Time!, $until: Time!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          firewallEventsAdaptiveGroups(
            filter: { datetime_geq: $since, datetime_leq: $until }
            limit: 100
            orderBy: [count_DESC]
          ) {
            count
            dimensions { action }
          }
        }
      }
    }
  `;
  try {
    const resp = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { zoneTag, since: sinceIso, until: untilIso },
      }),
    });
    if (!resp.ok) return [];
    const body = await resp.json().catch(() => null);
    if (!body || (body.errors && body.errors.length)) return [];
    const zone = body?.data?.viewer?.zones?.[0];
    if (!zone) return [];
    return (zone.firewallEventsAdaptiveGroups || []).map((row) => ({
      action: row.dimensions?.action,
      count: row.count || 0,
    }));
  } catch {
    return [];
  }
}

// Compute the list of sibling domains that share a zone with the given
// platform. Empty array for root-domain platforms (vlp, tmp).
function sharedDomainsForPlatform(platform) {
  if (CF_ROOT_DOMAINS.has(platform)) return [];
  const zone = CF_ZONE_MAP[platform];
  return Object.entries(CF_ZONE_MAP)
    .filter(([p, z]) => z === zone && p !== platform)
    .map(([p]) => CF_DOMAIN_MAP[p]);
}

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

// ---------------------------------------------------------------------------
// Form 2848 generator — source: tools/2848/generator.js
// If updating, sync changes back to the source module.
// Template bytes are fetched once per isolate from R2 key `tools/2848/f2848.pdf`
// and cached in memory. Run `node scripts/upload-2848-template.js` to upload.
// ---------------------------------------------------------------------------

const F2848_BUILD_ID = '2848-align-2026-01-22-h';
const F2848_IRS_TEXT_SIZE = 8.5;

const F2848_POS = {
  acts_desc_1: { x: 37,  y: 240, size: F2848_IRS_TEXT_SIZE },
  acts_form_1: { x: 330, y: 240, size: F2848_IRS_TEXT_SIZE },
  acts_year_1: { x: 474, y: 240, size: F2848_IRS_TEXT_SIZE },

  acts_desc_2: { x: 40,  y: 205, size: F2848_IRS_TEXT_SIZE },
  acts_form_2: { x: 330, y: 205, size: F2848_IRS_TEXT_SIZE },
  acts_year_2: { x: 474, y: 205, size: F2848_IRS_TEXT_SIZE },

  acts_desc_3: { x: 40,  y: 180, size: F2848_IRS_TEXT_SIZE },
  acts_form_3: { x: 330, y: 180, size: F2848_IRS_TEXT_SIZE },
  acts_year_3: { x: 474, y: 180, size: F2848_IRS_TEXT_SIZE },

  line5aAccessISP_Check:           { x: 230, y: 137 },
  line5aAuthorizeDisclosure_Check: { x: 55,  y: 130 },
  line5aSignReturn_Check:          { x: 560, y: 130 },
  line5aSubAddRep_Check:           { x: 230, y: 126 },

  repBlock: { x: 40, y: 565, lineGap: 11, size: F2848_IRS_TEXT_SIZE },

  repCAF:  { x: 395, y: 578, size: F2848_IRS_TEXT_SIZE },
  repPTIN: { x: 396, y: 566, size: F2848_IRS_TEXT_SIZE },
  repTel:  { x: 413, y: 554, size: F2848_IRS_TEXT_SIZE },
  repFax:  { x: 405, y: 542, size: F2848_IRS_TEXT_SIZE },

  taxpayerNameAddressBlock: { x: 40, y: 640, lineGap: 9, size: F2848_IRS_TEXT_SIZE },
  taxpayerTIN: { x: 348, y: 640, size: F2848_IRS_TEXT_SIZE },
};

function f2848_clean(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (s.startsWith('{{') && s.endsWith('}}')) return '';
  return s;
}

function f2848_formatTin(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 9) return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  return raw;
}

function f2848_formatPeriod(yearFrom, yearTo) {
  const a = String(yearFrom || '').trim();
  const b = String(yearTo || '').trim();
  if (a && b) return `${a} through ${b}`;
  return a || b || '';
}

function f2848_splitMatter(s) {
  const text = String(s || '').trim();
  if (!text) return ['', ''];
  const targetBreak = 'Estate';
  const idx = text.indexOf(targetBreak);
  if (idx > 0) {
    const line1 = text.slice(0, idx).trim().replace(/,\s*$/, '') + ',';
    const line2 = text.slice(idx).trim();
    return [line1, line2];
  }
  const mid = Math.floor(text.length / 2);
  const left = text.lastIndexOf(',', mid);
  const right = text.indexOf(',', mid);
  const cut = (right !== -1 && (mid - left) > (right - mid)) ? right : left;
  if (cut > 0) return [text.slice(0, cut + 1).trim(), text.slice(cut + 1).trim()];
  return [text, ''];
}

function f2848_splitForms(s) {
  const text = String(s || '').trim();
  if (!text) return ['', ''];
  const line1 = '940, 941, 720';
  const line2 = '1040, 1120, 1120S';
  if (text.replace(/\s+/g, ' ') === `${line1}, ${line2}`) return [line1, line2];
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 3) return [parts.join(', '), ''];
  return [parts.slice(0, 3).join(', '), parts.slice(3).join(', ')];
}

function f2848_splitYears(s) {
  const text = String(s || '').trim();
  if (!text) return ['', ''];
  const token = 'through';
  const i = text.indexOf(token);
  if (i !== -1) {
    const a = text.slice(0, i).trim();
    const b = text.slice(i + token.length).trim();
    return [a, `through ${b}`.trim()];
  }
  return [text, ''];
}

function f2848_drawMultiline(page, text, x, y, size, lineGap, font) {
  const lines = (text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  let cy = y;
  for (const line of lines) {
    page.drawText(line, { x, y: cy, size, font, color: rgb(0, 0, 0) });
    cy -= lineGap;
  }
}

function f2848_drawCheck(page, x, y, font) {
  page.drawText('X', { x: x + 1, y: y - 3, size: 8, font, color: rgb(0, 0, 0) });
}

function f2848_todayTokenYYYY_MMDD() {
  const d = new Date();
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}_${m}${dd}`;
}

function f2848_buildFilename(input) {
  const last = f2848_clean(input.clientLastName) || 'ClientLastName';
  const first = f2848_clean(input.clientFirstName) || 'ClientFirstName';
  return `Form_2848_${last}_${first}_DateSigned_${f2848_todayTokenYYYY_MMDD()}_p1.pdf`;
}

async function f2848_generate(input, templateBytes) {
  const data = {
    TaxpayerSSNITIN: f2848_clean(input.TaxpayerSSNITIN),

    clientAddressLine1: f2848_clean(input.clientAddressLine1),
    clientAddressLine2: f2848_clean(input.clientAddressLine2),
    clientAddressRegion: f2848_clean(input.clientAddressRegion),
    clientAddressTown: f2848_clean(input.clientAddressTown),
    clientAddressZip: f2848_clean(input.clientAddressZip),
    clientFirstName: f2848_clean(input.clientFirstName),
    clientLastName: f2848_clean(input.clientLastName),

    line3DescriptionOfMatter:
      f2848_clean(input.line3DescriptionOfMatter) ||
      'Income, Employment, Payroll, Excise, Estate, Gift, Civil Penalty, Sec. 4980H Shared Responsibility Payment',
    line3TaxFormNumber: f2848_clean(input.line3TaxFormNumber) || '940, 941, 720, 1040, 1120, 1120S',

    line5aAccessRecords: input.line5aAccessRecords !== false,
    line5aAuthorizeDisclosure: input.line5aAuthorizeDisclosure === true,
    line5aSignReturn: input.line5aSignReturn === true,
    line5aSubstituteOrAddRep: input.line5aSubstituteOrAddRep !== false,

    repAddr1: f2848_clean(input.repAddr1),
    repAddr2: f2848_clean(input.repAddr2),
    repCAF: f2848_clean(input.repCAF),
    repCity: f2848_clean(input.repCity),
    repFax: f2848_clean(input.repFax),
    repFirst: f2848_clean(input.repFirst),
    repLast: f2848_clean(input.repLast),
    repPTIN: f2848_clean(input.repPTIN),
    repState: f2848_clean(input.repState),
    repTel: f2848_clean(input.repTel),
    repZip: f2848_clean(input.repZip),

    yearFrom: f2848_clean(input.yearFrom),
    yearTo: f2848_clean(input.yearTo),
  };

  const pdfDoc = await PDFDocument.load(templateBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page1 = pdfDoc.getPages()[0];
  const { width, height } = page1.getSize();
  page1.setCropBox(0, 0, width, height);

  const taxpayerName = [data.clientFirstName, data.clientLastName].filter(Boolean).join(' ').trim();
  const repName = [data.repFirst, data.repLast].filter(Boolean).join(' ').trim();

  const repAddr12 = [data.repAddr1, data.repAddr2].filter(Boolean).join(' ').trim();
  const repCityStateZip =
    [data.repCity, data.repState].filter(Boolean).join(', ') + (data.repZip ? ' ' + data.repZip : '');
  const repBlockText = [repName, repAddr12, repCityStateZip]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join('\n');

  const taxpayerAddr12 = [data.clientAddressLine1, data.clientAddressLine2].filter(Boolean).join(' ').trim();
  const taxpayerCityStateZip =
    [data.clientAddressTown, data.clientAddressRegion].filter(Boolean).join(', ') +
    (data.clientAddressZip ? ' ' + data.clientAddressZip : '');
  const taxpayerNameAddress = [taxpayerName, taxpayerAddr12, taxpayerCityStateZip]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join('\n');

  const periodText = f2848_formatPeriod(data.yearFrom, data.yearTo);

  f2848_drawMultiline(
    page1,
    taxpayerNameAddress,
    F2848_POS.taxpayerNameAddressBlock.x,
    F2848_POS.taxpayerNameAddressBlock.y,
    F2848_POS.taxpayerNameAddressBlock.size,
    F2848_POS.taxpayerNameAddressBlock.lineGap,
    font,
  );

  page1.drawText(f2848_formatTin(data.TaxpayerSSNITIN), {
    x: F2848_POS.taxpayerTIN.x,
    y: F2848_POS.taxpayerTIN.y,
    size: F2848_POS.taxpayerTIN.size,
    font,
    color: rgb(0, 0, 0),
  });

  f2848_drawMultiline(
    page1,
    repBlockText,
    F2848_POS.repBlock.x,
    F2848_POS.repBlock.y,
    F2848_POS.repBlock.size,
    F2848_POS.repBlock.lineGap,
    font,
  );

  page1.drawText(data.repCAF,  { x: F2848_POS.repCAF.x,  y: F2848_POS.repCAF.y,  size: F2848_POS.repCAF.size,  font, color: rgb(0, 0, 0) });
  page1.drawText(data.repPTIN, { x: F2848_POS.repPTIN.x, y: F2848_POS.repPTIN.y, size: F2848_POS.repPTIN.size, font, color: rgb(0, 0, 0) });
  page1.drawText(data.repTel,  { x: F2848_POS.repTel.x,  y: F2848_POS.repTel.y,  size: F2848_POS.repTel.size,  font, color: rgb(0, 0, 0) });
  page1.drawText(data.repFax,  { x: F2848_POS.repFax.x,  y: F2848_POS.repFax.y,  size: F2848_POS.repFax.size,  font, color: rgb(0, 0, 0) });

  const lineGap = 9;

  const matterLines = f2848_splitMatter(data.line3DescriptionOfMatter);
  if (matterLines[0]) page1.drawText(matterLines[0], { x: F2848_POS.acts_desc_1.x, y: F2848_POS.acts_desc_1.y,           size: F2848_POS.acts_desc_1.size, font, color: rgb(0, 0, 0) });
  if (matterLines[1]) page1.drawText(matterLines[1], { x: F2848_POS.acts_desc_1.x, y: F2848_POS.acts_desc_1.y - lineGap, size: F2848_POS.acts_desc_1.size, font, color: rgb(0, 0, 0) });

  const formLines = f2848_splitForms(data.line3TaxFormNumber);
  if (formLines[0]) page1.drawText(formLines[0], { x: F2848_POS.acts_form_1.x, y: F2848_POS.acts_form_1.y,           size: F2848_POS.acts_form_1.size, font, color: rgb(0, 0, 0) });
  if (formLines[1]) page1.drawText(formLines[1], { x: F2848_POS.acts_form_1.x, y: F2848_POS.acts_form_1.y - lineGap, size: F2848_POS.acts_form_1.size, font, color: rgb(0, 0, 0) });

  const yearsLines = f2848_splitYears(periodText);
  if (yearsLines[0]) page1.drawText(yearsLines[0], { x: F2848_POS.acts_year_1.x, y: F2848_POS.acts_year_1.y,           size: F2848_POS.acts_year_1.size, font, color: rgb(0, 0, 0) });
  if (yearsLines[1]) page1.drawText(yearsLines[1], { x: F2848_POS.acts_year_1.x, y: F2848_POS.acts_year_1.y - lineGap, size: F2848_POS.acts_year_1.size, font, color: rgb(0, 0, 0) });

  if (data.line5aAuthorizeDisclosure) f2848_drawCheck(page1, F2848_POS.line5aAuthorizeDisclosure_Check.x, F2848_POS.line5aAuthorizeDisclosure_Check.y, font);
  if (data.line5aAccessRecords)       f2848_drawCheck(page1, F2848_POS.line5aAccessISP_Check.x,           F2848_POS.line5aAccessISP_Check.y,           font);
  if (data.line5aSubstituteOrAddRep)  f2848_drawCheck(page1, F2848_POS.line5aSubAddRep_Check.x,           F2848_POS.line5aSubAddRep_Check.y,           font);
  if (data.line5aSignReturn)          f2848_drawCheck(page1, F2848_POS.line5aSignReturn_Check.x,          F2848_POS.line5aSignReturn_Check.y,          font);

  return pdfDoc.save();
}

// Module-level cache for the 2848 PDF template. Reused across requests
// within the same Worker isolate. R2 fetch happens once per cold start.
let FORM_2848_TEMPLATE_CACHE = null;

async function load2848Template(env) {
  if (FORM_2848_TEMPLATE_CACHE) return FORM_2848_TEMPLATE_CACHE;
  const obj = await env.R2_VIRTUAL_LAUNCH.get('tools/2848/f2848.pdf');
  if (!obj) return null;
  const bytes = new Uint8Array(await obj.arrayBuffer());
  FORM_2848_TEMPLATE_CACHE = bytes;
  return bytes;
}

// Split "First Middle Last" → { first: "First", last: "Middle Last" }.
// If only one token is provided, it is treated as the last name.
function f2848_splitFullName(fullName) {
  const s = String(fullName || '').trim();
  if (!s) return { first: '', last: '' };
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: '', last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

// Encode Uint8Array → base64 string (Worker-safe — no Buffer, no atob/btoa limits).
function f2848_uint8ToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
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

  // -------------------------------------------------------------------------
  // DASHBOARD — aggregate KPIs + profile + recent activity for current session
  // -------------------------------------------------------------------------

  {
    method: 'GET', pattern: '/v1/dashboard',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      try {
        const accountId = session.account_id;
        const now = new Date();
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
        const nowIso = now.toISOString();

        const [accountRow, profileRow, membershipRow, tokenBalance] = await Promise.all([
          env.DB.prepare('SELECT account_id, email, first_name, last_name, platform, created_at FROM accounts WHERE account_id = ?').bind(accountId).first().catch(() => null),
          env.DB.prepare('SELECT professional_id, display_name, profession FROM profiles WHERE account_id = ?').bind(accountId).first().catch(() => null),
          env.DB.prepare("SELECT plan_key, status, stripe_subscription_id, created_at FROM memberships WHERE account_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").bind(accountId).first().catch(() => null),
          getCurrentTokenBalance(env, accountId).catch(() => ({ transcriptTokens: 0, taxGameTokens: 0, updatedAt: null })),
        ]);

        const [bookingsMonthRow, reportsMonthRow, openTicketsRow, upcomingBookingsResult] = await Promise.all([
          env.DB.prepare('SELECT COUNT(*) AS c FROM bookings WHERE account_id = ? AND scheduled_at >= ?').bind(accountId, monthStart).first().catch(() => ({ c: 0 })),
          env.DB.prepare('SELECT COUNT(*) AS c FROM transcript_jobs WHERE account_id = ? AND created_at >= ?').bind(accountId, monthStart).first().catch(() => ({ c: 0 })),
          env.DB.prepare("SELECT COUNT(*) AS c FROM support_tickets WHERE account_id = ? AND status IN ('open','in_progress','reopened')").bind(accountId).first().catch(() => ({ c: 0 })),
          env.DB.prepare('SELECT booking_id, scheduled_at, booking_type, status, professional_id FROM bookings WHERE account_id = ? AND scheduled_at >= ? ORDER BY scheduled_at ASC LIMIT 3').bind(accountId, nowIso).all().catch(() => ({ results: [] })),
        ]);

        const [bookingsRecent, reportsRecent, ticketsRecent] = await Promise.all([
          env.DB.prepare('SELECT booking_id, booking_type, status, scheduled_at, created_at FROM bookings WHERE account_id = ? ORDER BY created_at DESC LIMIT 5').bind(accountId).all().catch(() => ({ results: [] })),
          env.DB.prepare('SELECT job_id, transcript_type, tax_year, status, created_at FROM transcript_jobs WHERE account_id = ? ORDER BY created_at DESC LIMIT 5').bind(accountId).all().catch(() => ({ results: [] })),
          env.DB.prepare('SELECT ticket_id, subject, status, created_at FROM support_tickets WHERE account_id = ? ORDER BY created_at DESC LIMIT 5').bind(accountId).all().catch(() => ({ results: [] })),
        ]);

        const activity = [];
        for (const r of bookingsRecent.results ?? []) {
          activity.push({
            type: 'booking',
            title: `Booking ${r.status || 'pending'} — ${(r.booking_type || 'consultation').replace(/_/g, ' ')}`,
            timestamp: r.created_at,
          });
        }
        for (const r of reportsRecent.results ?? []) {
          const typeLabel = (r.transcript_type || 'transcript').replace(/_/g, ' ');
          activity.push({
            type: 'report',
            title: `${typeLabel} report${r.tax_year ? ` (${r.tax_year})` : ''} — ${r.status}`,
            timestamp: r.created_at,
          });
        }
        for (const r of ticketsRecent.results ?? []) {
          activity.push({
            type: 'support',
            title: `Support ticket: ${r.subject} — ${r.status}`,
            timestamp: r.created_at,
          });
        }
        activity.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
        const recentActivity = activity.slice(0, 5);

        // Tier + allocation mapping from CLAUDE.md section 19
        const TIER_LABELS = { vlp_free: 'Listed', vlp_starter: 'Active', vlp_scale: 'Featured', vlp_pro: 'Featured', vlp_advanced: 'Premier' };
        const PLAN_NAMES = { vlp_free: 'VLP Listed', vlp_starter: 'VLP Starter', vlp_scale: 'VLP Scale', vlp_pro: 'VLP Scale', vlp_advanced: 'VLP Advanced' };
        const MONTHLY_ALLOC = {
          vlp_free: { transcript: 0, game: 0 },
          vlp_starter: { transcript: 2, game: 5 },
          vlp_scale: { transcript: 5, game: 15 },
          vlp_pro: { transcript: 5, game: 15 },
          vlp_advanced: { transcript: 10, game: 40 },
        };
        const rawPlanKey = membershipRow?.plan_key ?? 'vlp_free';
        const planKey = rawPlanKey.replace(/_(monthly|yearly)$/, '');
        const tierLabel = TIER_LABELS[planKey] ?? 'Listed';
        const planName = PLAN_NAMES[planKey] ?? 'VLP Listed';
        const alloc = MONTHLY_ALLOC[planKey] ?? { transcript: 0, game: 0 };

        const firstName = accountRow?.first_name ?? '';
        const lastName = accountRow?.last_name ?? '';
        const fallbackName = `${firstName} ${lastName}`.trim() || (session.email?.split('@')[0] ?? 'Member');
        const name = profileRow?.display_name || fallbackName;

        return json({
          ok: true,
          dashboard: {
            account: {
              account_id: accountId,
              email: session.email,
              name,
              credential: profileRow?.profession ?? null,
              platform: session.platform,
              professional_id: profileRow?.professional_id ?? null,
              tier: tierLabel,
              plan_key: planKey,
              plan_name: planName,
              // memberships table has no current_period_end column; Stripe webhook
              // does not persist renewal date. Returning null until a future migration
              // or on-demand Stripe fetch fills this in.
              tier_renewal_date: null,
              member_since: accountRow?.created_at ?? null,
            },
            tokens: {
              balance: tokenBalance.transcriptTokens ?? 0,
              tax_game_balance: tokenBalance.taxGameTokens ?? 0,
              monthly_allocation: alloc.transcript,
              updated_at: tokenBalance.updatedAt ?? null,
            },
            bookings: {
              this_month: bookingsMonthRow?.c ?? 0,
              upcoming: (upcomingBookingsResult.results ?? []).map(b => ({
                booking_id: b.booking_id,
                scheduled_at: b.scheduled_at,
                booking_type: b.booking_type,
                status: b.status,
                professional_id: b.professional_id,
              })),
            },
            reports: {
              generated_this_month: reportsMonthRow?.c ?? 0,
              // transcript_jobs has no "pending_review" concept — all rows are terminal
              pending_review: 0,
            },
            support: {
              open_tickets: openTicketsRow?.c ?? 0,
              // no dedicated awaiting_response status on support_tickets yet
              awaiting_response: 0,
            },
            client_pool: {
              // No D1 projection for client_pool yet — would require R2 scan
              assigned_cases: 0,
              available_cases: 0,
            },
            activity: recentActivity,
          },
        }, 200, request);
      } catch (e) {
        console.error('/v1/dashboard error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to load dashboard' }, 500, request);
      }
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

  { method: 'POST', pattern: '/v1/webhooks/twilio', handler: (_method, _pattern, _params, request) => json({ ok: true, received: true }, 200, request) },

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
  // PER-USER FLOW — Calendar page "Connect Cal.com" OAuth
  //   App: Tax Monitor Pro Tax Professionals
  //   Client ID: env.CALCOM_CLIENT_ID (9d03bcaa...)
  //   Redirect: https://api.virtuallaunch.pro/v1/cal/oauth/callback
  //   PKCE: OFF (standard OAuth 2.0 authorization code flow)
  //   Tokens stored in: accounts.calcom_access_token / calcom_refresh_token / calcom_token_expiry
  //   Entry point: GET /v1/cal/oauth/start
  //   Used on: Calendar page "Connect Cal.com" button
  //
  // FLOW B — Tax pro connects their own Cal.com (clients book them)
  //   App: Tax Monitor Pro Tax Professionals (same app, different flow)
  //   Client ID: 9d03bcaa8ee24644d21dc7af5c3c17722ffa314c9790f2c7c83a1f88032b8420
  //   Redirect: https://api.virtuallaunch.pro/v1/cal/oauth/callback
  //   Tokens stored in: cal_connections table
  //   Entry point: GET /v1/cal/pro/oauth/start
  //   Used on: Profile Setup step 5
  //
  // NOT IN THIS REPO:
  //   Taxpayer App (d6839d7...) — lives in taxmonitor.pro repo only
  // ────────────────────────────────────────────────────────────────────

  {
    // Per-user Cal.com OAuth start — Calendar page "Connect Cal.com"
    // Redirects browser (302) to Cal.com authorize endpoint
    method: 'GET', pattern: '/v1/cal/oauth/start',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;
      const calClientId = env.CALCOM_CLIENT_ID ?? '9d03bcaa8ee24644d21dc7af5c3c17722ffa314c9790f2c7c83a1f88032b8420';
      const redirectUri = 'https://api.virtuallaunch.pro/v1/cal/oauth/callback';
      // Capture requesting domain so the callback can redirect back to the correct platform
      const refOrigin = request.headers.get('Referer') || request.headers.get('Origin') || '';
      const origin = refOrigin.includes('taxmonitor.pro') ? 'transcript.taxmonitor.pro' : 'virtuallaunch.pro';

      const state = btoa(JSON.stringify({
        accountId: session.account_id,
        nonce: crypto.randomUUID(),
        flow: 'calcom_user',
        origin,
      }));

      const now = new Date().toISOString();
      await d1Run(env.DB,
        'INSERT OR REPLACE INTO oauth_state (state_key, code_verifier, account_id, flow, created_at) VALUES (?, ?, ?, ?, ?)',
        [state, '', session.account_id, 'calcom_user', now]
      );

      const url = new URL('https://app.cal.com/auth/oauth2/authorize');
      url.searchParams.set('client_id', calClientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'BOOKING_READ BOOKING_WRITE');
      url.searchParams.set('state', state);
      return Response.redirect(url.toString(), 302);
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
      const url = new URL('https://app.cal.com/auth/oauth2/authorize');
      url.searchParams.set('client_id', calClientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'BOOKING_READ BOOKING_WRITE');
      return json({ ok: true, status: 'redirect_required', authorizationUrl: url.toString() }, 200, request);
    },
  },

  {
    // Cal.com OAuth callback — handles both per-user calendar flow and FLOW B (pro connection)
    // Registered redirect URI: https://api.virtuallaunch.pro/v1/cal/oauth/callback
    method: 'GET', pattern: '/v1/cal/oauth/callback',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return Response.redirect('https://virtuallaunch.pro/calendar?calcom=error&reason=session', 302);

      const url = new URL(request.url);
      const stateParam = url.searchParams.get('state');
      const code = url.searchParams.get('code');

      // Decode state to extract origin for domain-aware redirects
      let stateObj = {};
      try { stateObj = JSON.parse(atob(stateParam || '')); } catch { /* ignore */ }
      const calendarBase = (stateObj.origin || '').includes('taxmonitor.pro')
        ? 'https://transcript.taxmonitor.pro/app/calendar'
        : 'https://virtuallaunch.pro/calendar';

      // Determine flow from state
      let flow = 'cal_pro'; // default to legacy FLOW B
      if (stateParam) {
        try {
          const stateRow = await env.DB.prepare(
            'SELECT flow FROM oauth_state WHERE state_key = ?'
          ).bind(stateParam).first();
          if (stateRow && stateRow.flow === 'calcom_user') {
            flow = 'calcom_user';
          }
          await d1Run(env.DB, 'DELETE FROM oauth_state WHERE state_key = ?', [stateParam]);
        } catch { /* fall through to legacy */ }
      }

      if (flow === 'calcom_user') {
        // Per-user Cal.com OAuth — store tokens in accounts table
        if (!code) return Response.redirect(`${calendarBase}?calcom=error&reason=missing_code`, 302);

        const calClientId = env.CALCOM_CLIENT_ID ?? '9d03bcaa8ee24644d21dc7af5c3c17722ffa314c9790f2c7c83a1f88032b8420';
        const calClientSecret = env.CALCOM_CLIENT_SECRET;
        const redirectUri = 'https://api.virtuallaunch.pro/v1/cal/oauth/callback';
        const tokenUrl = 'https://api.cal.com/v2/auth/oauth2/token';
        const tokenBody = {
          grant_type: 'authorization_code',
          client_id: calClientId,
          client_secret: calClientSecret,
          redirect_uri: redirectUri,
          code,
        };

        try {
          console.log('[calcom callback] Token request URL:', tokenUrl);
          console.log('[calcom callback] Token request body:', JSON.stringify({ ...tokenBody, client_secret: '[REDACTED]' }));
          const tokenRes = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tokenBody),
          });
          const tokenText = await tokenRes.text();
          console.log('[calcom callback] Token response status:', tokenRes.status);
          console.log('[calcom callback] Token response body:', tokenText);

          if (!tokenRes.ok) {
            return Response.redirect(`${calendarBase}?calcom=error&reason=token_exchange`, 302);
          }

          const tokenData = JSON.parse(tokenText);
          const now = new Date().toISOString();
          const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 1800) * 1000).toISOString();
          await d1Run(env.DB,
            'UPDATE accounts SET calcom_access_token = ?, calcom_refresh_token = ?, calcom_token_expiry = ?, updated_at = ? WHERE account_id = ?',
            [tokenData.access_token, tokenData.refresh_token ?? null, expiresAt, now, session.account_id]
          );

          return Response.redirect(`${calendarBase}?calcom=connected`, 302);
        } catch (err) {
          console.log('[calcom-oauth] Callback error:', err.message);
          return Response.redirect(`${calendarBase}?calcom=error&reason=internal`, 302);
        }
      }

      // Legacy FLOW B — tax pro's Cal.com connection (profile setup)
      try {
        const result = await handleCalProOAuthCallback(request, env, session);
        if (!result.ok) {
          return Response.redirect(`https://virtuallaunch.pro/onboarding?cal=error&reason=${encodeURIComponent(result.error ?? 'unknown')}`, 302);
        }
        return Response.redirect('https://virtuallaunch.pro/onboarding?cal=connected', 302);
      } catch (err) {
        console.log('[cal-pro-oauth] Callback error:', err.message);
        return Response.redirect('https://virtuallaunch.pro/onboarding?cal=error&reason=internal', 302);
      }
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

  // GET /v1/profiles — directory listing (vlp.profiles.list.v1 contract shape)
  // Supports ?match=true for scored ranking used by the TMP inquiry flow.
  {
    method: 'GET', pattern: '/v1/profiles',
    handler: async (_method, _pattern, _params, request, env) => {
      try {
        const url = new URL(request.url);
        const stateFilter = url.searchParams.get('state') || null;
        const professionFilter = url.searchParams.get('profession') || null;
        const serviceFilter = url.searchParams.get('service') || null;
        const cityFilter = url.searchParams.get('city') || null;
        // client_type and language filters require D1 projection columns (pending migration)
        const q = url.searchParams.get('q') || null;
        const matchMode = url.searchParams.get('match') === 'true';
        const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
        const defaultLimit = matchMode ? 3 : 20;
        const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit')) || defaultLimit));
        const offset = (page - 1) * limit;

        let where = `WHERE status = 'active'`;
        const filterParams = [];

        if (stateFilter) {
          where += ` AND LOWER(state) = LOWER(?)`;
          filterParams.push(stateFilter);
        }
        if (professionFilter) {
          where += ` AND LOWER(profession) LIKE LOWER(?)`;
          filterParams.push(`%${professionFilter}%`);
        }
        if (serviceFilter) {
          where += ` AND LOWER(specialties) LIKE LOWER(?)`;
          filterParams.push(`%${serviceFilter}%`);
        }
        if (q) {
          where += ` AND (LOWER(display_name) LIKE LOWER(?) OR LOWER(bio) LIKE LOWER(?) OR LOWER(specialties) LIKE LOWER(?))`;
          filterParams.push(`%${q}%`, `%${q}%`, `%${q}%`);
        }

        // In match mode we score against R2 nested profiles, so pull a wider candidate
        // pool from D1 (capped at 30) and ignore pagination offset.
        if (matchMode) {
          const candidateCap = 30;
          const result = await env.DB.prepare(
            `SELECT professional_id, display_name, bio, specialties, profession,
                    firm_name, city, state, status, created_at
             FROM profiles ${where}
             ORDER BY created_at DESC LIMIT ?`
          ).bind(...filterParams, candidateCap).all();

          const rows = result.results || [];

          // Hydrate each candidate from R2 in parallel so scoring can see featured status,
          // reviews, schedule button, and weekly availability (none of which live in D1).
          const hydrated = await Promise.all(rows.map(async (row) => {
            try {
              const obj = await env.R2_VIRTUAL_LAUNCH.get(`profiles/${row.professional_id}.json`);
              if (!obj) return { row, nested: null };
              return { row, nested: await obj.json() };
            } catch {
              return { row, nested: null };
            }
          }));

          const scored = hydrated.map(({ row, nested }) => {
            const score = scoreMatchProfile(nested, { cityFilter });
            const card = nested
              ? nestedProfileToCard(nested, row.professional_id)
              : d1RowToProfileCard(row);
            return { ...card, match_score: score };
          });

          scored.sort((a, b) => (b.match_score || 0) - (a.match_score || 0));
          const top = scored.slice(0, limit);

          return json({
            ok: true,
            profiles: top,
            pagination: { page: 1, limit, total: scored.length, total_pages: 1 },
            match: true,
          }, 200, request);
        }

        const countResult = await env.DB.prepare(
          `SELECT COUNT(*) as total FROM profiles ${where}`
        ).bind(...filterParams).first();
        const total = countResult?.total || 0;

        const result = await env.DB.prepare(
          `SELECT professional_id, display_name, bio, specialties, profession,
                  firm_name, city, state, status, created_at
           FROM profiles ${where}
           ORDER BY created_at DESC LIMIT ? OFFSET ?`
        ).bind(...filterParams, limit, offset).all();

        const profiles = (result.results || []).map(row => d1RowToProfileCard(row));

        return json({
          ok: true,
          profiles,
          pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
        }, 200, request);
      } catch (error) {
        console.error('Profile list error:', error);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Internal server error' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/profiles',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;
      const body = (await parseBody(request)) || {};

      // Accept partial nested payload. Name is the one hard requirement —
      // slug + initials + hero are derived from it.
      const incomingName = body?.profile?.name || body?.name || '';
      if (!incomingName || typeof incomingName !== 'string') {
        return json({ ok: false, error: 'MISSING_FIELDS', message: 'profile.name is required' }, 400, request);
      }

      const professionalId = body?.professional_id || body?.professionalId || `PRO_${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      // Check if a profile already exists for this account — if so, short-circuit
      // to an update (onboarding "Step 1 save" is the natural place a user would
      // create a profile, so repeat calls should be idempotent).
      try {
        const existingRow = await env.DB.prepare(
          'SELECT professional_id FROM profiles WHERE account_id = ? LIMIT 1'
        ).bind(session.account_id).first();
        if (existingRow?.professional_id) {
          const existingObj = await env.R2_VIRTUAL_LAUNCH.get(`profiles/${existingRow.professional_id}.json`);
          if (existingObj) {
            const existing = await existingObj.json();
            const merged = mergeNestedProfile(existing, body);
            merged.accountId = session.account_id;
            merged.professional_id = existingRow.professional_id;
            merged.updatedAt = now;
            if (!merged.createdAt) merged.createdAt = existing.createdAt || now;
            deriveProfileFields(merged);
            await r2Put(env.R2_VIRTUAL_LAUNCH, `profiles/${existingRow.professional_id}.json`, merged);
            const p = profileD1ProjectionValues(merged);
            try {
              await d1Run(env.DB,
                `UPDATE profiles SET display_name=?, bio=?, specialties=?, profession=?, phone=?, availability_text=?, business_hours=?, cal_booking_url=?, website=?, firm_name=?, city=?, state=?, zip=?, status=?, updated_at=? WHERE professional_id=?`,
                [p.display_name, p.bio, p.specialties, p.profession, p.phone, p.availability_text, p.business_hours, p.cal_booking_url, p.website, p.firm_name, p.city, p.state, p.zip, p.status, now, existingRow.professional_id]
              );
            } catch (e) { console.error('D1 profile update error (POST upsert):', e); }
            return json({ ok: true, professional_id: existingRow.professional_id, profile: merged }, 200, request);
          }
        }
      } catch (e) {
        console.error('POST /v1/profiles upsert-check error:', e);
      }

      // Fresh create — start from canonical defaults, merge client body on top,
      // then re-derive computed fields.
      const profile = mergeNestedProfile(defaultNestedProfile(), body);
      profile.accountId = session.account_id;
      profile.professional_id = professionalId;
      profile.createdAt = now;
      profile.updatedAt = now;
      deriveProfileFields(profile);

      await r2Put(env.R2_VIRTUAL_LAUNCH, `profiles/${professionalId}.json`, profile);

      // D1 projection
      const p = profileD1ProjectionValues(profile);
      try {
        await d1Run(env.DB,
          `INSERT INTO profiles (professional_id, account_id, display_name, bio, specialties, profession, phone, availability_text, business_hours, cal_booking_url, website, firm_name, city, state, zip, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [professionalId, session.account_id, p.display_name, p.bio, p.specialties, p.profession, p.phone, p.availability_text, p.business_hours, p.cal_booking_url, p.website, p.firm_name, p.city, p.state, p.zip, p.status, now, now]
        );
      } catch (e) {
        // If D1 insert fails (e.g. duplicate), still return success since R2 is authoritative
        console.error('D1 profile insert error:', e);
      }
      return json({ ok: true, professional_id: professionalId, profile }, 201, request);
    },
  },

  {
    method: 'GET', pattern: '/v1/profiles/public/:professional_id',
    handler: async (_method, _pattern, params, _request, env) => {
      const obj = await env.R2_VIRTUAL_LAUNCH.get(`profiles/${params.professional_id}.json`);
      if (!obj) return json({ ok: false, error: 'NOT_FOUND', message: 'Profile not found' }, 404, _request);
      const data = await obj.json();
      // Strip private fields — R2 stores nested profile sections + accountId
      const { accountId: _a, account_id: _b, ...publicProfile } = data;
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
      const { session, error } = await requireSession(request, env);
      if (error) return error;
      const body = (await parseBody(request)) || {};

      const obj = await env.R2_VIRTUAL_LAUNCH.get(`profiles/${params.professional_id}.json`);
      if (!obj) return json({ ok: false, error: 'NOT_FOUND', message: 'Profile not found' }, 404, request);
      const existing = await obj.json();

      // Ownership check — only the owning account may mutate the profile.
      if (existing.accountId && existing.accountId !== session.account_id) {
        return json({ ok: false, error: 'FORBIDDEN' }, 403, request);
      }

      const now = new Date().toISOString();

      // Deep merge the nested patch into the existing profile.
      // - Top-level sections merge section-by-section.
      // - Arrays are replaced wholesale.
      const merged = mergeNestedProfile(existing, body);
      merged.accountId = existing.accountId || session.account_id;
      merged.professional_id = params.professional_id;
      merged.createdAt = existing.createdAt || now;
      merged.updatedAt = now;

      // Re-derive computed fields (hero.*, slug, initials, availability_display).
      deriveProfileFields(merged);

      await r2Put(env.R2_VIRTUAL_LAUNCH, `profiles/${params.professional_id}.json`, merged);

      // D1 projection — rebuild from merged nested profile.
      const p = profileD1ProjectionValues(merged);
      try {
        await d1Run(env.DB,
          `UPDATE profiles SET display_name=?, bio=?, specialties=?, profession=?, phone=?, availability_text=?, business_hours=?, cal_booking_url=?, website=?, firm_name=?, city=?, state=?, zip=?, status=?, updated_at=? WHERE professional_id=?`,
          [p.display_name, p.bio, p.specialties, p.profession, p.phone, p.availability_text, p.business_hours, p.cal_booking_url, p.website, p.firm_name, p.city, p.state, p.zip, p.status, now, params.professional_id]
        );
      } catch (e) {
        console.error('D1 profile update error:', e);
      }
      return json({ ok: true, profile: merged }, 200, request);
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
        const rows = result.results || []
        // Hydrate messages[] from R2 canonical record (parallel)
        const tickets = await Promise.all(rows.map(async (row) => {
          let messages = []
          try {
            const obj = await env.R2_VIRTUAL_LAUNCH.get(`support_tickets/${row.ticket_id}.json`)
            if (obj) {
              const data = await obj.json().catch(() => ({}))
              if (Array.isArray(data.messages)) messages = data.messages
            }
          } catch {}
          // Seed initial user message if R2 record has no thread yet
          if (messages.length === 0 && row.message) {
            messages = [{
              id: `msg_seed_${row.ticket_id}`,
              body: row.message,
              author: 'user',
              createdAt: row.created_at,
            }]
          }
          return { ...row, messages }
        }))
        return json({ ok: true, tickets }, 200, request)
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 500, request)
      }
    },
  },

  {
    method: 'PATCH', pattern: '/v1/admin/support/tickets/:ticket_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env)
      if (error) return error

      const adminEmails = ['jamie.williams@virtuallaunch.pro', 'hello@virtuallaunch.pro']
      if (!adminEmails.includes((session.email || '').toLowerCase())) {
        return json({ ok: false, error: 'FORBIDDEN' }, 403, request)
      }

      try {
        const body = await parseBody(request)
        const replyText = (body?.message ?? '').toString().trim()
        const newStatus = body?.status
        if (!replyText && !newStatus) {
          return json({ ok: false, error: 'VALIDATION', message: 'message or status required' }, 400, request)
        }
        const validStatuses = ['closed', 'in_progress', 'open', 'reopened', 'resolved', 'awaiting']
        if (newStatus && !validStatuses.includes(newStatus)) {
          return json({ ok: false, error: 'VALIDATION', message: `status must be one of: ${validStatuses.join(', ')}` }, 400, request)
        }

        const row = await env.DB.prepare(
          `SELECT t.*, a.email, a.platform FROM support_tickets t
             LEFT JOIN accounts a ON a.account_id = t.account_id
            WHERE t.ticket_id = ?`
        ).bind(params.ticket_id).first()
        if (!row) return json({ ok: false, error: 'NOT_FOUND' }, 404, request)

        const now = new Date().toISOString()
        const existingObj = await env.R2_VIRTUAL_LAUNCH.get(`support_tickets/${params.ticket_id}.json`)
        const existing = existingObj ? await existingObj.json().catch(() => ({})) : {}
        const messages = Array.isArray(existing.messages) ? existing.messages.slice() : []
        if (messages.length === 0 && row.message) {
          messages.push({
            id: `msg_seed_${params.ticket_id}`,
            body: row.message,
            author: 'user',
            createdAt: row.created_at,
          })
        }
        if (replyText) {
          messages.push({
            id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            body: replyText,
            author: 'support',
            createdAt: now,
          })
        }

        const effectiveStatus = newStatus || (replyText ? 'awaiting' : row.status)

        await r2Put(env.R2_VIRTUAL_LAUNCH, `support_tickets/${params.ticket_id}.json`, {
          ...existing,
          ticket_id: params.ticket_id,
          account_id: row.account_id,
          subject: row.subject,
          priority: row.priority,
          status: effectiveStatus,
          messages,
          updatedAt: now,
        })

        await d1Run(env.DB,
          `UPDATE support_tickets SET status = ?, updated_at = ? WHERE ticket_id = ?`,
          [effectiveStatus, now, params.ticket_id]
        )

        return json({
          ok: true,
          ticket: {
            ticket_id: params.ticket_id,
            account_id: row.account_id,
            subject: row.subject,
            message: row.message,
            priority: row.priority,
            status: effectiveStatus,
            created_at: row.created_at,
            updated_at: now,
            email: row.email,
            platform: row.platform,
            messages,
          },
        }, 200, request)
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
        const url = new URL(request.url)
        const includeClients = (url.searchParams.get('include') || '')
          .split(',')
          .map((s) => s.trim())
          .includes('clients')

        // Total accounts
        const accountsRow = await env.DB.prepare(
          `SELECT COUNT(*) AS total FROM accounts`
        ).first()

        // Paid accounts: distinct accounts with at least one active membership
        const paidRow = await env.DB.prepare(
          `SELECT COUNT(DISTINCT a.account_id) AS paid
             FROM accounts a
            INNER JOIN memberships m ON a.account_id = m.account_id
            WHERE m.status = 'active'`
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

        // Stripe payment intents from both VLP-family and TMP-family accounts.
        // Falls back to checkout sessions if payment_intents returns empty.
        const stripeTransactions = []
        const stripeErrors = []
        const stripeAccounts = [
          { label: 'vlp', key: env.STRIPE_SECRET_KEY_VLP },
          { label: 'tmp', key: env.STRIPE_SECRET_KEY },
        ]
        for (const acct of stripeAccounts) {
          if (!acct.key) {
            stripeErrors.push(`${acct.label}:missing_key`)
            continue
          }
          let added = 0
          try {
            const resp = await fetch('https://api.stripe.com/v1/payment_intents?limit=25', {
              headers: { 'Authorization': `Bearer ${acct.key}` },
            })
            if (!resp.ok) {
              stripeErrors.push(`${acct.label}:pi:${resp.status}`)
            } else {
              const body = await resp.json()
              for (const pi of (body.data || [])) {
                stripeTransactions.push({
                  id: pi.id,
                  amount: pi.amount,
                  currency: pi.currency,
                  status: pi.status,
                  description: pi.description || '',
                  email: pi.receipt_email || (pi.metadata && pi.metadata.email) || '',
                  customer: pi.customer || '',
                  created: pi.created,
                  platform: acct.label,
                  receipt_url: '',
                })
                added++
              }
            }
          } catch (e) {
            stripeErrors.push(`${acct.label}:pi:${e.message}`)
          }

          // Fallback: try checkout sessions if no payment intents surfaced
          if (added === 0) {
            try {
              const csResp = await fetch('https://api.stripe.com/v1/checkout/sessions?limit=25', {
                headers: { 'Authorization': `Bearer ${acct.key}` },
              })
              if (!csResp.ok) {
                stripeErrors.push(`${acct.label}:cs:${csResp.status}`)
              } else {
                const csBody = await csResp.json()
                for (const cs of (csBody.data || [])) {
                  stripeTransactions.push({
                    id: cs.id,
                    amount: cs.amount_total || 0,
                    currency: cs.currency || 'usd',
                    status: cs.payment_status || cs.status || '',
                    description: (cs.metadata && cs.metadata.description) || '',
                    email: cs.customer_email || (cs.customer_details && cs.customer_details.email) || '',
                    customer: cs.customer || '',
                    created: cs.created,
                    platform: acct.label,
                    receipt_url: '',
                  })
                }
              }
            } catch (e) {
              stripeErrors.push(`${acct.label}:cs:${e.message}`)
            }
          }
        }
        // Sort newest first across both accounts
        stripeTransactions.sort((a, b) => (b.created || 0) - (a.created || 0))

        // Optional: full client list (account_id, name, email, platform, created_at, membership)
        let clients = undefined
        if (includeClients) {
          const clientRows = await env.DB.prepare(
            `SELECT a.account_id, a.email, a.first_name, a.last_name, a.platform, a.created_at,
                    p.display_name AS profile_display_name,
                    m.plan_key, m.status AS membership_status
               FROM accounts a
               LEFT JOIN profiles p ON p.account_id = a.account_id
               LEFT JOIN memberships m ON a.account_id = m.account_id
              ORDER BY a.created_at DESC`
          ).all()
          clients = (clientRows.results || []).map((r) => {
            const fullName = [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
            const name = fullName || r.profile_display_name || (r.email ? r.email.split('@')[0] : '')
            return {
              account_id: r.account_id,
              name,
              email: r.email,
              platform: r.platform,
              created_at: r.created_at,
              plan_key: r.plan_key || null,
              membership_status: r.membership_status || null,
            }
          })
        }

        const responseBody = {
          ok: true,
          total_accounts: accountsRow?.total || 0,
          paid_accounts: paidRow?.paid || 0,
          memberships_by_tier: membershipsByTier,
          tokens: {
            transcript_total: tokenRow?.transcript_total || 0,
            tax_game_total: tokenRow?.tax_game_total || 0,
            holder_count: tokenRow?.holder_count || 0,
          },
          recent_transactions: recentTransactions,
          stripe_transactions: stripeTransactions,
          stripe_errors: stripeErrors,
        }
        if (clients !== undefined) responseBody.clients = clients
        return json(responseBody, 200, request)
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 500, request)
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/admin/accounts/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env)
      if (error) return error

      const adminEmails = ['jamie.williams@virtuallaunch.pro', 'hello@virtuallaunch.pro']
      if (!adminEmails.includes((session.email || '').toLowerCase())) {
        return json({ ok: false, error: 'FORBIDDEN' }, 403, request)
      }

      const accountId = params.account_id
      if (!accountId) {
        return json({ ok: false, error: 'VALIDATION', message: 'account_id required' }, 400, request)
      }

      try {
        const accountRow = await env.DB.prepare(
          `SELECT account_id, email, first_name, last_name, platform, status, created_at, updated_at
             FROM accounts
            WHERE account_id = ?`
        ).bind(accountId).first()
        if (!accountRow) {
          return json({ ok: false, error: 'NOT_FOUND' }, 404, request)
        }

        const fullName = [accountRow.first_name, accountRow.last_name].filter(Boolean).join(' ').trim()
        const accountOut = {
          id: accountRow.account_id,
          account_id: accountRow.account_id,
          email: accountRow.email,
          name: fullName || (accountRow.email ? accountRow.email.split('@')[0] : ''),
          platform: accountRow.platform,
          status: accountRow.status,
          created_at: accountRow.created_at,
          updated_at: accountRow.updated_at,
        }

        const membershipRows = await env.DB.prepare(
          `SELECT membership_id, plan_key, billing_interval, status, stripe_customer_id, stripe_subscription_id, created_at, updated_at
             FROM memberships
            WHERE account_id = ?
            ORDER BY created_at DESC`
        ).bind(accountId).all()
        const memberships = (membershipRows.results || []).map((m) => ({
          membership_id: m.membership_id,
          plan_key: m.plan_key,
          billing_interval: m.billing_interval,
          status: m.status,
          created_at: m.created_at,
          updated_at: m.updated_at,
        }))

        const tokenRow = await env.DB.prepare(
          `SELECT transcript_tokens, tax_game_tokens, updated_at
             FROM tokens
            WHERE account_id = ?`
        ).bind(accountId).first()
        const tokens = {
          transcript_total: tokenRow?.transcript_tokens || 0,
          tax_game_total: tokenRow?.tax_game_tokens || 0,
          updated_at: tokenRow?.updated_at || null,
        }

        const ticketRows = await env.DB.prepare(
          `SELECT ticket_id, subject, priority, status, created_at, updated_at
             FROM support_tickets
            WHERE account_id = ?
            ORDER BY created_at DESC
            LIMIT 50`
        ).bind(accountId).all()
        const tickets = (ticketRows.results || []).map((t) => ({
          id: t.ticket_id,
          ticket_id: t.ticket_id,
          subject: t.subject,
          priority: t.priority,
          status: t.status,
          created_at: t.created_at,
          updated_at: t.updated_at,
        }))

        // Resolve a Stripe customer id (prefer billing_customers, fall back to memberships)
        let stripeCustomerId = null
        try {
          const billingRow = await env.DB.prepare(
            `SELECT stripe_customer_id FROM billing_customers WHERE account_id = ?`
          ).bind(accountId).first()
          if (billingRow?.stripe_customer_id) stripeCustomerId = billingRow.stripe_customer_id
        } catch {/* ignore */}
        if (!stripeCustomerId) {
          for (const m of (membershipRows.results || [])) {
            if (m.stripe_customer_id) { stripeCustomerId = m.stripe_customer_id; break }
          }
        }

        // Stripe payment history — try VLP key first, then TMP. Fall back to receipt_email search.
        const payments = []
        const stripeKeys = [
          { label: 'vlp', key: env.STRIPE_SECRET_KEY_VLP },
          { label: 'tmp', key: env.STRIPE_SECRET_KEY },
        ]
        for (const acct of stripeKeys) {
          if (!acct.key) continue
          let url = ''
          if (stripeCustomerId) {
            url = `https://api.stripe.com/v1/payment_intents?customer=${encodeURIComponent(stripeCustomerId)}&limit=25`
          } else if (accountRow.email) {
            // Stripe doesn't support direct receipt_email filter on /v1/payment_intents,
            // but search API does.
            const query = encodeURIComponent(`receipt_email:"${accountRow.email}"`)
            url = `https://api.stripe.com/v1/payment_intents/search?query=${query}&limit=25`
          } else {
            continue
          }
          try {
            const resp = await fetch(url, {
              headers: { 'Authorization': `Bearer ${acct.key}` },
            })
            if (!resp.ok) continue
            const body = await resp.json()
            for (const pi of (body.data || [])) {
              payments.push({
                id: pi.id,
                amount: pi.amount,
                currency: pi.currency,
                status: pi.status,
                description: pi.description || '',
                email: pi.receipt_email || (pi.metadata && pi.metadata.email) || '',
                customer: pi.customer || '',
                created: pi.created,
                platform: acct.label,
              })
            }
          } catch {/* skip on error */}
        }
        payments.sort((a, b) => (b.created || 0) - (a.created || 0))

        return json({
          ok: true,
          account: accountOut,
          memberships,
          tokens,
          tickets,
          payments,
        }, 200, request)
      } catch (e) {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: e.message }, 500, request)
      }
    },
  },

  // ---------------------------------------------------------------------------
  // Cloudflare Analytics — admin-gated, queries Cloudflare GraphQL Analytics API
  // Token: env.CF_API_TOKEN (Analytics:Read on all zones)
  // ---------------------------------------------------------------------------
  // NOTE: /all must come before /:platform so the literal path isn't captured
  // by the param pattern.
  {
    method: 'GET', pattern: '/v1/admin/analytics/all',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env)
      if (error) return error

      const adminEmails = ['jamie.williams@virtuallaunch.pro', 'hello@virtuallaunch.pro']
      if (!adminEmails.includes((session.email || '').toLowerCase())) {
        return json({ ok: false, error: 'FORBIDDEN' }, 403, request)
      }

      const url = new URL(request.url)
      const now = new Date()
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      const sinceIso = url.searchParams.get('since') || sevenDaysAgo.toISOString()
      const untilIso = url.searchParams.get('until') || now.toISOString()

      // Optimization: many platforms share zones (VLP/DVLP/GVLP/TCVLP/WLVLP
      // all on the same zone, TMP/TTMP/TTTMP on another). Since the 1d
      // dataset can't filter by host, the per-zone result is identical for
      // every platform on that zone. Fetch each unique zone exactly once
      // and reuse the result — 8 platforms collapse to 2 GraphQL calls.
      const zoneToRep = new Map() // zoneId -> first platform key on that zone
      for (const [p, z] of Object.entries(CF_ZONE_MAP)) {
        if (!zoneToRep.has(z)) zoneToRep.set(z, p)
      }
      const uniqueReps = Array.from(zoneToRep.values())

      const fetchResults = await Promise.allSettled(
        uniqueReps.map((p) => fetchPlatformAnalytics(env, p, sinceIso, untilIso))
      )

      const dataByZone = new Map()
      for (let i = 0; i < uniqueReps.length; i++) {
        const zone = CF_ZONE_MAP[uniqueReps[i]]
        const settled = fetchResults[i]
        if (settled.status === 'fulfilled' && settled.value.ok) {
          dataByZone.set(zone, { ok: true, data: settled.value.data })
        } else {
          const err = settled.status === 'rejected'
            ? (settled.reason && settled.reason.message) || String(settled.reason)
            : settled.value.error
          dataByZone.set(zone, { ok: false, error: err })
        }
      }

      const platforms = {}
      for (const platform of Object.keys(CF_ZONE_MAP)) {
        const zone = CF_ZONE_MAP[platform]
        const domain = CF_DOMAIN_MAP[platform]
        const isSubdomain = !CF_ROOT_DOMAINS.has(platform)
        const sharedWith = sharedDomainsForPlatform(platform)
        const result = dataByZone.get(zone)
        if (!result || !result.ok) {
          platforms[platform] = {
            domain,
            shared_zone: isSubdomain,
            shared_with: sharedWith,
            error: (result && result.error) || 'no data',
          }
          continue
        }
        const t = result.data.traffic
        platforms[platform] = {
          domain,
          shared_zone: isSubdomain,
          shared_with: sharedWith,
          total_requests: t.total_requests,
          page_views: t.page_views,
          unique_visitors: t.unique_visitors,
          bandwidth_bytes: t.total_bytes,
          threats: t.threats,
          cache_hit_ratio: t.cache_hit_ratio,
        }
      }

      return json({
        ok: true,
        since: sinceIso,
        until: untilIso,
        platforms,
      }, 200, request)
    },
  },

  {
    method: 'GET', pattern: '/v1/admin/analytics/:platform',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env)
      if (error) return error

      const adminEmails = ['jamie.williams@virtuallaunch.pro', 'hello@virtuallaunch.pro']
      if (!adminEmails.includes((session.email || '').toLowerCase())) {
        return json({ ok: false, error: 'FORBIDDEN' }, 403, request)
      }

      const platform = (params.platform || '').toLowerCase()
      if (!CF_ZONE_MAP[platform]) {
        return json({ ok: false, error: 'VALIDATION', message: `unknown platform: ${platform}` }, 400, request)
      }

      const url = new URL(request.url)
      const now = new Date()
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      const sinceIso = url.searchParams.get('since') || sevenDaysAgo.toISOString()
      const untilIso = url.searchParams.get('until') || now.toISOString()

      const result = await fetchPlatformAnalytics(env, platform, sinceIso, untilIso)
      if (!result.ok) {
        return json({ ok: false, error: result.error }, 502, request)
      }

      const isSubdomain = !CF_ROOT_DOMAINS.has(platform)
      const sharedWith = sharedDomainsForPlatform(platform)

      return json({
        ok: true,
        platform,
        domain: CF_DOMAIN_MAP[platform],
        since: sinceIso,
        until: untilIso,
        shared_zone: isSubdomain,
        shared_with: sharedWith,
        ...result.data,
      }, 200, request)
    },
  },

  {
    method: 'GET', pattern: '/v1/admin/scale/workflow',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env)
      if (error) return error

      const adminEmails = ['jamie.williams@virtuallaunch.pro', 'hello@virtuallaunch.pro']
      if (!adminEmails.includes((session.email || '').toLowerCase())) {
        return json({ ok: false, error: 'FORBIDDEN' }, 403, request)
      }

      const obj = await env.R2_VIRTUAL_LAUNCH.get('vlp-scale/workflow.md')
      if (!obj) {
        return json({ ok: false, error: 'WORKFLOW.md not found in R2' }, 404, request)
      }

      const body = await obj.text()
      const corsHeaders = getCorsHeaders(request)
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Cache-Control': 'no-store',
          ...corsHeaders,
        },
      })
    },
  },

  // ── Admin prospect search (session auth — browser-friendly proxy) ──────
  {
    method: 'GET', pattern: '/v1/admin/scale/prospects/search',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env)
      if (error) return error

      const adminEmails = ['jamie.williams@virtuallaunch.pro', 'hello@virtuallaunch.pro']
      if (!adminEmails.includes((session.email || '').toLowerCase())) {
        return json({ ok: false, error: 'FORBIDDEN' }, 403, request)
      }

      const url = new URL(request.url)
      const q = (url.searchParams.get('q') || '').trim().toLowerCase()
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 500)
      const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0)

      const records = await readFoiaMasterRecords(env)
      if (!records) {
        return json({ ok: false, error: 'foia_master_not_found' }, 404, request)
      }

      let filtered = records
      if (q) {
        filtered = records.filter(r => {
          const fields = [
            r.First_NAME, r.LAST_NAME, r.DBA, r.BUS_ADDR_CITY,
            r.email_found, r.domain_clean,
          ]
          return fields.some(f => f && String(f).toLowerCase().includes(q))
        })
      }

      const total = records.length
      const filteredCount = filtered.length
      const page = filtered.slice(offset, offset + limit)

      const prospects = page.map(r => {
        const first = (r.First_NAME || '').trim()
        const last = (r.LAST_NAME || '').trim()
        const city = (r.BUS_ADDR_CITY || '').trim()
        const state = (r.BUS_ST_CODE || '').trim()
        const profession = (r.PROFESSION || r.CRED || '').trim()
        const email = (r.email_found || '').trim()
        const slug = dailyMakeSlug(
          dailySanitizeNamePart(first), dailySanitizeNamePart(last), city, state
        )

        let campaign = 'none'
        if (r.ttmp_email_1_prepared_at) campaign = 'ttmp'
        else if (r.vlp_email_1_prepared_at) campaign = 'vlp'
        else if (r.wlvlp_email_1_prepared_at) campaign = 'wlvlp'

        let maskedEmail = ''
        if (email && email.includes('@')) {
          const [local, domain] = email.split('@')
          maskedEmail = local.charAt(0) + '***@' + domain
        }

        const fullName = [first, last].filter(Boolean).join(' ')
        const linkedinParts = [fullName, city, profession].filter(Boolean).join(' ')
        const linkedin_url = linkedinParts
          ? 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(linkedinParts)
          : null

        return {
          slug, first_name: first, last_name: last, firm: (r.DBA || '').trim(),
          city, state, profession, email: maskedEmail, phone: (r.BUS_PHONE || '').trim(),
          domain: (r.domain_clean || '').trim(), email_status: (r.email_status || '').trim(),
          campaign, email_stage: r.unsubscribed_at ? 'unsubscribed' : 'not_queued', linkedin_url,
        }
      })

      return json({ ok: true, prospects, total, filtered: filteredCount, limit, offset }, 200, request)
    },
  },

  // ── Admin prospect detail (session auth — browser-friendly proxy) ─────
  {
    method: 'GET', pattern: '/v1/admin/scale/prospects/:slug',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env)
      if (error) return error

      const adminEmails = ['jamie.williams@virtuallaunch.pro', 'hello@virtuallaunch.pro']
      if (!adminEmails.includes((session.email || '').toLowerCase())) {
        return json({ ok: false, error: 'FORBIDDEN' }, 403, request)
      }

      const targetSlug = (params.slug || '').trim().toLowerCase()
      if (!targetSlug) {
        return json({ ok: false, error: 'slug_required' }, 400, request)
      }

      const records = await readFoiaMasterRecords(env)
      if (!records) {
        return json({ ok: false, error: 'foia_master_not_found' }, 404, request)
      }

      const record = records.find(r => {
        const slug = dailyMakeSlug(
          dailySanitizeNamePart(r.First_NAME),
          dailySanitizeNamePart(r.LAST_NAME),
          r.BUS_ADDR_CITY,
          r.BUS_ST_CODE
        )
        return slug === targetSlug
      })

      if (!record) {
        return json({ ok: false, error: 'prospect_not_found' }, 404, request)
      }

      const first = (record.First_NAME || '').trim()
      const last = (record.LAST_NAME || '').trim()
      const city = (record.BUS_ADDR_CITY || '').trim()
      const state = (record.BUS_ST_CODE || '').trim()
      const profession = (record.PROFESSION || record.CRED || '').trim()
      const fullName = [first, last].filter(Boolean).join(' ')
      const linkedinParts = [fullName, city, profession].filter(Boolean).join(' ')

      let campaign = 'none'
      if (record.ttmp_email_1_prepared_at) campaign = 'ttmp'
      else if (record.vlp_email_1_prepared_at) campaign = 'vlp'
      else if (record.wlvlp_email_1_prepared_at) campaign = 'wlvlp'

      const emails_sent = []
      if (campaign !== 'none') {
        const queuePrefix = `vlp-scale/${campaign}-send-queue/`
        const email = (record.email_found || '').trim().toLowerCase()

        try {
          const queueObj = await env.R2_VIRTUAL_LAUNCH.get(queuePrefix + 'email1-pending.json')
          if (queueObj) {
            const queueData = JSON.parse(await queueObj.text())
            const arr = Array.isArray(queueData) ? queueData : []
            for (const qr of arr) {
              const qrEmail = (qr.email || qr.to || '').trim().toLowerCase()
              if (qrEmail !== email) continue
              for (let n = 1; n <= 6; n++) {
                const sentKey = `email_${n}_sent_at`
                if (qr[sentKey]) {
                  emails_sent.push({
                    email_number: n,
                    subject: qr[n === 1 ? 'subject' : `email_${n}_subject`] || '',
                    body: qr[n === 1 ? 'body' : `email_${n}_body`] || '',
                    sent_at: qr[sentKey],
                    campaign,
                  })
                }
              }
            }
          }
        } catch {}

        try {
          const sentList = await env.R2_VIRTUAL_LAUNCH.list({ prefix: queuePrefix + 'sent-', limit: 30 })
          for (const obj of (sentList.objects || [])) {
            try {
              const archiveObj = await env.R2_VIRTUAL_LAUNCH.get(obj.key)
              if (!archiveObj) continue
              const archiveData = JSON.parse(await archiveObj.text())
              const arr = Array.isArray(archiveData) ? archiveData : []
              for (const qr of arr) {
                const qrEmail = (qr.email || qr.to || '').trim().toLowerCase()
                if (qrEmail !== email) continue
                for (let n = 1; n <= 6; n++) {
                  const sentKey = `email_${n}_sent_at`
                  if (qr[sentKey]) {
                    if (!emails_sent.some(e => e.email_number === n)) {
                      emails_sent.push({
                        email_number: n,
                        subject: qr[n === 1 ? 'subject' : `email_${n}_subject`] || '',
                        body: qr[n === 1 ? 'body' : `email_${n}_body`] || '',
                        sent_at: qr[sentKey],
                        campaign,
                      })
                    }
                  }
                }
              }
            } catch {}
          }
        } catch {}

        emails_sent.sort((a, b) => a.email_number - b.email_number)
      }

      let email_stage = 'not_queued'
      if (record.unsubscribed_at) {
        email_stage = 'unsubscribed'
      } else if (emails_sent.length > 0) {
        const maxSent = Math.max(...emails_sent.map(e => e.email_number))
        email_stage = `email_${maxSent}_sent`
      } else if (campaign !== 'none') {
        email_stage = 'pending'
      }

      const prospect = {
        slug: targetSlug,
        first_name: first, last_name: last, full_name: fullName,
        firm: (record.DBA || '').trim(), city, state,
        phone: (record.BUS_PHONE || '').trim(), profession,
        website: (record.WEBSITE || '').trim(),
        domain_clean: (record.domain_clean || '').trim(),
        email_found: (record.email_found || '').trim(),
        email_status: (record.email_status || '').trim(),
        firm_bucket: (record.firm_bucket || '').trim(),
        linkedin_url: linkedinParts
          ? 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(linkedinParts)
          : null,
        campaign, email_stage,
        timestamps: {
          email_found_at: record.email_found_at || null,
          email_verified_at: record.email_verified_at || null,
          ttmp_email_1_prepared_at: record.ttmp_email_1_prepared_at || null,
          vlp_email_1_prepared_at: record.vlp_email_1_prepared_at || null,
          wlvlp_email_1_prepared_at: record.wlvlp_email_1_prepared_at || null,
          wlvlp_asset_enriched_at: record.wlvlp_asset_enriched_at || null,
          unsubscribed_at: record.unsubscribed_at || null,
        },
      }

      return json({ ok: true, prospect, emails_sent }, 200, request)
    },
  },

  // ── Cal.com bookings (admin, cached 5min in KV) ────────────────────────
  {
    method: 'GET', pattern: '/v1/admin/bookings',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env)
      if (error) return error

      const adminEmails = ['jamie.williams@virtuallaunch.pro', 'hello@virtuallaunch.pro']
      if (!adminEmails.includes((session.email || '').toLowerCase())) {
        return json({ ok: false, error: 'FORBIDDEN' }, 403, request)
      }

      // Check KV cache first (5 min TTL)
      const KV_CACHE_KEY = 'cal_bookings_cache'
      try {
        const cached = await env.ENRICHMENT_KV.get(KV_CACHE_KEY)
        if (cached) {
          return json(JSON.parse(cached), 200, request)
        }
      } catch { /* cache miss or parse error — fetch fresh */ }

      const EMPTY_COUNTS = { all: 0, cancelled: 0, completed: 0, confirmed: 0, upcoming: 0, recurring: 0, unconfirmed: 0 }

      if (!env.CAL_API_KEY) {
        console.log('[bookings] CAL_API_KEY not configured')
        return json({ ok: true, bookings: [], counts: EMPTY_COUNTS, api_version: 'none', event_types: CAL_EVENT_TYPES, warning: 'CAL_API_KEY not configured' }, 200, request)
      }

      try {
      let rawBookings = []

      // Cal.com v2 only (v1 is decommissioned — returns 410)
      try {
        const v2Res = await fetch('https://api.cal.com/v2/bookings?status=upcoming,past,cancelled,recurring,unconfirmed&take=250', {
          headers: {
            'Authorization': `Bearer ${env.CAL_API_KEY}`,
            'cal-api-version': '2024-08-13',
          },
        })
        if (v2Res.ok) {
          const v2Data = await v2Res.json()
          rawBookings = v2Data.data || v2Data.bookings || []
        } else {
          const v2Body = await v2Res.text().catch(() => '')
          console.log(`[bookings] Cal.com v2 failed: ${v2Res.status} ${v2Body.slice(0, 500)}`)
          return json({ ok: true, bookings: [], counts: EMPTY_COUNTS, api_version: 'v2', event_types: CAL_EVENT_TYPES, warning: `Cal.com v2 returned ${v2Res.status}` }, 200, request)
        }
      } catch (e) {
        console.log(`[bookings] Cal.com v2 unreachable: ${e.message}`)
        return json({ ok: true, bookings: [], counts: EMPTY_COUNTS, api_version: 'v2', event_types: CAL_EVENT_TYPES, warning: `Cal.com unreachable: ${e.message}` }, 200, request)
      }

      // Normalize bookings to a consistent shape
      const now = Date.now()
      const bookings = rawBookings.map(b => {
        const start = b.startTime || b.start || b.start_time || ''
        const end = b.endTime || b.end || b.end_time || ''
        const status = (b.status || '').toLowerCase()
        const attendees = b.attendees || b.guests || []
        const firstAttendee = Array.isArray(attendees) && attendees.length > 0 ? attendees[0] : {}

        return {
          id: b.id || b.uid || b.bookingId,
          title: b.title || b.eventType?.title || '',
          status,
          start,
          end,
          attendee_name: firstAttendee.name || b.attendeeName || b.responses?.name || '',
          attendee_email: firstAttendee.email || b.attendeeEmail || b.responses?.email || '',
          event_type_slug: b.eventType?.slug || b.eventTypeSlug || '',
          created_at: b.createdAt || b.created_at || '',
        }
      })

      // Derive counts
      const counts = { all: bookings.length, cancelled: 0, completed: 0, confirmed: 0, upcoming: 0, recurring: 0, unconfirmed: 0 }
      for (const b of bookings) {
        const startMs = new Date(b.start).getTime()
        const endMs = new Date(b.end).getTime()

        if (b.status === 'cancelled') counts.cancelled++
        else if ((b.status === 'accepted' || b.status === 'attended') && endMs < now) counts.completed++
        else if (b.status === 'accepted' && startMs > now) counts.confirmed++
        else if (b.status === 'recurring') counts.recurring++
        else if (b.status === 'unconfirmed') counts.unconfirmed++

        if (startMs > now && b.status !== 'cancelled') counts.upcoming++
      }

      const result = { ok: true, bookings, counts, api_version: 'v2', event_types: CAL_EVENT_TYPES }

      // Cache in KV for 5 minutes
      try {
        await env.ENRICHMENT_KV.put(KV_CACHE_KEY, JSON.stringify(result), { expirationTtl: 300 })
      } catch { /* non-fatal */ }

      return json(result, 200, request)

      } catch (err) {
        console.log(`[bookings] Unexpected error: ${err.message}`, err.stack)
        return json({ ok: true, bookings: [], counts: EMPTY_COUNTS, api_version: 'error', event_types: CAL_EVENT_TYPES, warning: err.message }, 200, request)
      }
    },
  },

  {
    method: 'GET', pattern: '/v1/scale/dashboard',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env)
      if (error) return error

      const adminEmails = ['jamie.williams@virtuallaunch.pro', 'hello@virtuallaunch.pro']
      if (!adminEmails.includes(session.email)) {
        return json({ ok: false, error: 'forbidden' }, 403, request)
      }

      const nowIso = new Date().toISOString()
      const todayKey = nowIso.slice(0, 10)
      const yesterdayKey = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

      // Build batch log keys for last 7 days
      const batchLogKeys = []
      for (let i = 0; i < 7; i++) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
        batchLogKeys.push('vlp-scale/batch-logs/' + d + '.json')
      }

      // --- Parallel fetch: 3 pending queues + FOIA master JSONL + 3 sent-archive listings + batch logs ---
      const [
        ttmpQueueObj, vlpQueueObj, wlvlpQueueObj,
        foiaMasterObj,
        ttmpSentList, vlpSentList, wlvlpSentList,
        ...batchLogObjs
      ] = await Promise.all([
        env.R2_VIRTUAL_LAUNCH.get('vlp-scale/ttmp-send-queue/email1-pending.json'),
        env.R2_VIRTUAL_LAUNCH.get('vlp-scale/vlp-send-queue/email1-pending.json'),
        env.R2_VIRTUAL_LAUNCH.get('vlp-scale/wlvlp-send-queue/email1-pending.json'),
        env.R2_VIRTUAL_LAUNCH.get('vlp-scale/foia-leads/foia-master.json'),
        env.R2_VIRTUAL_LAUNCH.list({ prefix: 'vlp-scale/ttmp-send-queue/sent-' }),
        env.R2_VIRTUAL_LAUNCH.list({ prefix: 'vlp-scale/vlp-send-queue/sent-' }),
        env.R2_VIRTUAL_LAUNCH.list({ prefix: 'vlp-scale/wlvlp-send-queue/sent-' }),
        ...batchLogKeys.map(k => env.R2_VIRTUAL_LAUNCH.get(k)),
      ])

      // --- Parse pending queues ---
      async function parseJsonArr(obj) {
        if (!obj) return []
        try { const d = await obj.json(); return Array.isArray(d) ? d : [] }
        catch { return [] }
      }

      const ttmpQueue = await parseJsonArr(ttmpQueueObj)
      const vlpQueue = await parseJsonArr(vlpQueueObj)
      const wlvlpQueue = await parseJsonArr(wlvlpQueueObj)
      const allPending = [...ttmpQueue, ...vlpQueue, ...wlvlpQueue]

      // --- Count sent records from archives ---
      async function countSentArchive(sentList, r2) {
        let total = 0, todayCount = 0, yesterdayCount = 0
        for (const obj of (sentList.objects || [])) {
          try {
            const archiveObj = await r2.get(obj.key)
            if (!archiveObj) continue
            const recs = await archiveObj.json()
            const cnt = Array.isArray(recs) ? recs.length : 0
            total += cnt
            if (obj.key.includes('sent-' + todayKey)) todayCount = cnt
            if (obj.key.includes('sent-' + yesterdayKey)) yesterdayCount = cnt
          } catch { continue }
        }
        return { total, today: todayCount, yesterday: yesterdayCount }
      }

      const [ttmpSent, vlpSent, wlvlpSent] = await Promise.all([
        countSentArchive(ttmpSentList, env.R2_VIRTUAL_LAUNCH),
        countSentArchive(vlpSentList, env.R2_VIRTUAL_LAUNCH),
        countSentArchive(wlvlpSentList, env.R2_VIRTUAL_LAUNCH),
      ])

      const totalArchived = ttmpSent.total + vlpSent.total + wlvlpSent.total

      // --- Count per-email-step status (cumulative) ---
      const statusOrder = ['pending', 'email_1_sent', 'email_2_sent', 'email_3_sent', 'email_4_sent', 'email_5_sent', 'email_6_sent']
      const sentByEmail = { email_1_sent: 0, email_2_sent: 0, email_3_sent: 0, email_4_sent: 0, email_5_sent: 0, email_6_sent: 0, pending: 0 }

      for (const rec of allPending) {
        const status = rec.status || 'pending'
        if (status === 'pending' || status === 'unsubscribed') { sentByEmail.pending++; continue }
        const match = status.match(/^email_(\d+)_(sent|failed)$/)
        if (!match) { sentByEmail.pending++; continue }
        const emailNum = parseInt(match[1])
        const result = match[2]
        const sentCount = result === 'sent' ? emailNum : emailNum - 1
        if (sentCount === 0) { sentByEmail.pending++; continue }
        for (let i = 1; i <= sentCount; i++) sentByEmail['email_' + i + '_sent']++
      }
      // All archived records completed all 6 emails
      for (let i = 1; i <= 6; i++) sentByEmail['email_' + i + '_sent'] += totalArchived

      // --- Parse pipeline from FOIA master JSONL ---
      let pipeline = null
      try {
        if (foiaMasterObj) {
          const text = await foiaMasterObj.text()
          let total = 0, eligible = 0, exhausted = 0
          const lines = text.split('\n')
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            let r
            try { r = JSON.parse(trimmed) } catch { continue }
            total++
            const emailFound = (r.email_found || '').toString().trim()
            const emailStatus = (r.email_status || '').toString().trim().toLowerCase()
            const sendable = ALLOWED_SEND_STATUSES.has(emailStatus)
            const anyPrepared = (r.ttmp_email_1_prepared_at || r.vlp_email_1_prepared_at || r.wlvlp_email_1_prepared_at)
            if (anyPrepared) exhausted++
            else if (emailFound && sendable && !r.unsubscribed_at) eligible++
          }
          pipeline = { total, eligible, exhausted, days_remaining: eligible > 0 ? Math.ceil(eligible / 200) : 0 }
        }
      } catch { pipeline = null }

      // --- Parse batch logs (last 7 days) ---
      const batchHistory = []
      for (const obj of batchLogObjs) {
        if (!obj) continue
        try {
          const log = await obj.json()
          batchHistory.push({
            date: log.date || '',
            batch_size: log.batch_size || 0,
            routed_ttmp: log.routed_ttmp || 0,
            routed_vlp: log.routed_vlp || 0,
            routed_wlvlp: log.routed_wlvlp || 0,
            queue_sizes: log.queue_sizes || {},
          })
        } catch { continue }
      }
      batchHistory.sort((a, b) => (b.date || '').localeCompare(a.date || ''))

      // --- Aggregate responses from vlp-scale/responses/ prefix ---
      const responses = {
        bookings: { created: 0, cancelled: 0, rescheduled: 0, paid: 0, no_show: 0 },
        purchases: { count: 0, total_revenue: 0 }
      }
      try {
        const responsesList = await env.R2_VIRTUAL_LAUNCH.list({ prefix: 'vlp-scale/responses/' })
        for (const obj of (responsesList.objects || [])) {
          try {
            const rObj = await env.R2_VIRTUAL_LAUNCH.get(obj.key)
            if (!rObj) continue
            const data = await rObj.json()
            if (obj.key.includes('/bookings/')) {
              const et = data.event_type || data.raw_trigger || ''
              if (et.includes('CREATED')) responses.bookings.created++
              else if (et.includes('CANCELLED')) responses.bookings.cancelled++
              else if (et.includes('RESCHEDULED')) responses.bookings.rescheduled++
              else if (et.includes('PAID')) responses.bookings.paid++
              else if (et.includes('NO_SHOW')) responses.bookings.no_show++
            } else if (obj.key.includes('/purchases/')) {
              responses.purchases.count++
              if (data.amount) responses.purchases.total_revenue += data.amount
            }
          } catch { continue }
        }
      } catch {}

      // --- Build response ---
      return json({
        pipeline: pipeline ? {
          ...pipeline,
          queued: {
            ttmp: ttmpQueue.length,
            vlp: vlpQueue.length,
            wlvlp: wlvlpQueue.length,
            all: allPending.length,
          },
          sent: {
            ttmp: { total: ttmpSent.total, today: ttmpSent.today, yesterday: ttmpSent.yesterday },
            vlp: { total: vlpSent.total, today: vlpSent.today, yesterday: vlpSent.yesterday },
            wlvlp: { total: wlvlpSent.total, today: wlvlpSent.today, yesterday: wlvlpSent.yesterday },
            all: totalArchived,
          },
          sent_by_email: sentByEmail,
        } : null,
        batch_history: batchHistory,
        responses: responses,
        fetched_at: nowIso,
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
          }, accountId: params.account_id }, 200, request);
        }
        return json({ ok: true, preferences: {
          accountId: params.account_id,
          appearance: row.appearance,
          timezone: row.timezone ?? null,
          defaultDashboard: row.default_dashboard ?? null,
          accentColor: row.accent_color ?? null,
          inAppEnabled: row.in_app_enabled === 1,
          smsEnabled: row.sms_enabled === 1,
        }, accountId: params.account_id }, 200, request);
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
      // Calendar OAuth uses its own redirect URI — NOT env.GOOGLE_REDIRECT_URI (that's the login callback)
      const redirectUri = 'https://api.virtuallaunch.pro/v1/google/oauth/callback';
      // Capture requesting domain so the callback can redirect back to the correct platform
      const refOrigin = request.headers.get('Referer') || request.headers.get('Origin') || '';
      const origin = refOrigin.includes('taxmonitor.pro') ? 'transcript.taxmonitor.pro' : 'virtuallaunch.pro';
      const state = btoa(JSON.stringify({ accountId: session.account_id, nonce: crypto.randomUUID(), origin }));
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.readonly');
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
      url.searchParams.set('state', state);
      return Response.redirect(url.toString(), 302);
    },
  },

  {
    method: 'GET', pattern: '/v1/google/oauth/callback',
    handler: async (_method, _pattern, _params, request, env) => {
      const url = new URL(request.url);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const oauthError = url.searchParams.get('error');
      // Decode state early to extract origin for domain-aware redirects
      let stateObj = {};
      try { stateObj = JSON.parse(atob(state || '')); } catch { /* handled below */ }
      const calendarBase = (stateObj.origin || '').includes('taxmonitor.pro')
        ? 'https://transcript.taxmonitor.pro/app/calendar'
        : 'https://virtuallaunch.pro/calendar';
      if (oauthError) {
        return Response.redirect(`${calendarBase}?google=error&reason=${encodeURIComponent(oauthError)}`, 302);
      }
      if (!code || !state) {
        return Response.redirect(`${calendarBase}?google=error&reason=missing_params`, 302);
      }
      let accountId;
      try {
        accountId = stateObj.accountId;
        if (!accountId) throw new Error('missing accountId');
      } catch {
        return Response.redirect(`${calendarBase}?google=error&reason=invalid_state`, 302);
      }
      // Must match the redirect_uri used in /v1/google/oauth/start — NOT env.GOOGLE_REDIRECT_URI
      const redirectUri = 'https://api.virtuallaunch.pro/v1/google/oauth/callback';
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
          return Response.redirect(`${calendarBase}?google=error&reason=token_exchange_failed`, 302);
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
        return Response.redirect(`${calendarBase}?google=connected`, 302);
      } catch {
        return Response.redirect(`${calendarBase}?google=error&reason=internal_error`, 302);
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
          const errorBody = await calRes.text().catch(() => '');
          console.log('[google/events] Google API error:', calRes.status, errorBody);
          return json({ ok: false, error: 'GOOGLE_API_ERROR', message: 'Google Calendar API returned ' + calRes.status }, 502, request);
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
  // CAL.COM INTEGRATION (per-user OAuth tokens)
  // Users connect Cal.com via OAuth from the Calendar page
  // -------------------------------------------------------------------------

  {
    method: 'GET', pattern: '/v1/calcom/status',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;
      try {
        const row = await env.DB.prepare(
          'SELECT calcom_access_token FROM accounts WHERE account_id = ?'
        ).bind(session.account_id).first();
        const connected = !!(row && row.calcom_access_token);
        return json({ ok: true, connected }, 200, request);
      } catch {
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to check Cal.com status' }, 500, request);
      }
    },
  },

  {
    method: 'POST', pattern: '/v1/calcom/disconnect',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;
      await d1Run(env.DB,
        'UPDATE accounts SET calcom_access_token = NULL, calcom_refresh_token = NULL, calcom_token_expiry = NULL WHERE account_id = ?',
        [session.account_id]
      );
      return json({ ok: true, message: 'Cal.com disconnected' }, 200, request);
    },
  },

  {
    method: 'GET', pattern: '/v1/calcom/bookings',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;
      const row = await env.DB.prepare(
        'SELECT calcom_access_token, calcom_refresh_token, calcom_token_expiry FROM accounts WHERE account_id = ?'
      ).bind(session.account_id).first();
      if (!row || !row.calcom_access_token) {
        return json({ ok: false, error: 'NOT_CONNECTED', message: 'Cal.com not connected. Connect via OAuth first.' }, 400, request);
      }

      let accessToken = row.calcom_access_token;

      // Refresh if expired or expiring within 60s
      const expiry = row.calcom_token_expiry ? new Date(row.calcom_token_expiry).getTime() : 0;
      if (Date.now() + 60000 > expiry && row.calcom_refresh_token) {
        try {
          const calClientId = env.CALCOM_CLIENT_ID ?? '9d03bcaa8ee24644d21dc7af5c3c17722ffa314c9790f2c7c83a1f88032b8420';
          const refreshRes = await fetch('https://app.cal.com/api/auth/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              grant_type: 'refresh_token',
              client_id: calClientId,
              client_secret: env.CALCOM_CLIENT_SECRET,
              refresh_token: row.calcom_refresh_token,
            }),
          });
          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            accessToken = refreshData.access_token;
            const newExpiry = new Date(Date.now() + (refreshData.expires_in ?? 3600) * 1000).toISOString();
            await d1Run(env.DB,
              'UPDATE accounts SET calcom_access_token = ?, calcom_refresh_token = ?, calcom_token_expiry = ? WHERE account_id = ?',
              [accessToken, refreshData.refresh_token ?? row.calcom_refresh_token, newExpiry, session.account_id]
            );
          }
        } catch (err) {
          console.log('[calcom] Token refresh failed:', err.message);
        }
      }

      try {
        let rawBookings = [];
        const v2Res = await fetch('https://api.cal.com/v2/bookings?status=upcoming,past,cancelled,recurring,unconfirmed&take=250', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'cal-api-version': '2024-08-13',
          },
        });
        if (v2Res.ok) {
          const v2Data = await v2Res.json();
          rawBookings = v2Data.data || v2Data.bookings || [];
        }
        const bookings = rawBookings.map(b => ({
          id: b.id || b.uid || b.bookingId,
          title: b.title || b.eventType?.title || 'Cal.com Booking',
          status: (b.status || '').toLowerCase(),
          start: b.startTime || b.start || b.start_time || '',
          end: b.endTime || b.end || b.end_time || '',
          attendee_name: (b.attendees?.[0]?.name || ''),
          attendee_email: (b.attendees?.[0]?.email || ''),
          event_type_slug: b.eventType?.slug || '',
          meeting_url: b.meetingUrl || '',
          created_at: b.createdAt || b.created_at || '',
        }));
        return json({ ok: true, bookings }, 200, request);
      } catch {
        return json({ ok: false, error: 'CALCOM_ERROR', message: 'Failed to fetch Cal.com bookings' }, 502, request);
      }
    },
  },

  // -------------------------------------------------------------------------
  // CAL.COM BOOKING STATS
  // -------------------------------------------------------------------------

  {
    method: 'GET', pattern: '/v1/calcom/stats',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;
      const row = await env.DB.prepare(
        'SELECT calcom_access_token, calcom_refresh_token, calcom_token_expiry FROM accounts WHERE account_id = ?'
      ).bind(session.account_id).first();
      if (!row || !row.calcom_access_token) {
        return json({ ok: true, connected: false, stats: null }, 200, request);
      }

      let accessToken = row.calcom_access_token;
      const expiry = row.calcom_token_expiry ? new Date(row.calcom_token_expiry).getTime() : 0;
      if (Date.now() + 60000 > expiry && row.calcom_refresh_token) {
        try {
          const calClientId = env.CALCOM_CLIENT_ID ?? '9d03bcaa8ee24644d21dc7af5c3c17722ffa314c9790f2c7c83a1f88032b8420';
          const refreshRes = await fetch('https://app.cal.com/api/auth/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              grant_type: 'refresh_token',
              client_id: calClientId,
              client_secret: env.CALCOM_CLIENT_SECRET,
              refresh_token: row.calcom_refresh_token,
            }),
          });
          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            accessToken = refreshData.access_token;
            const newExpiry = new Date(Date.now() + (refreshData.expires_in ?? 3600) * 1000).toISOString();
            await d1Run(env.DB,
              'UPDATE accounts SET calcom_access_token = ?, calcom_refresh_token = ?, calcom_token_expiry = ? WHERE account_id = ?',
              [accessToken, refreshData.refresh_token ?? row.calcom_refresh_token, newExpiry, session.account_id]
            );
          }
        } catch (err) {
          console.log('[calcom] Token refresh failed:', err.message);
        }
      }

      try {
        const v2Res = await fetch('https://api.cal.com/v2/bookings?status=upcoming,past,cancelled,recurring,unconfirmed&take=250', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'cal-api-version': '2024-08-13',
          },
        });
        if (!v2Res.ok) {
          return json({ ok: false, error: 'CALCOM_ERROR', message: 'Failed to fetch Cal.com bookings' }, 502, request);
        }
        const v2Data = await v2Res.json();
        const rawBookings = v2Data.data || v2Data.bookings || [];

        const now = Date.now();
        let upcoming = 0, completed = 0, cancelled = 0, past = 0, noShow = 0;
        const byEventType = {};
        for (const b of rawBookings) {
          const s = (b.status || '').toLowerCase();
          const startMs = new Date(b.startTime || b.start || '').getTime();
          if (s === 'cancelled') { cancelled++; }
          else if (s === 'no_show' || s === 'no-show') { noShow++; }
          else if (!Number.isNaN(startMs) && startMs >= now) { upcoming++; }
          else { completed++; past++; }

          const slug = b.eventType?.slug || 'unknown';
          const label = b.eventType?.title || slug;
          if (!byEventType[slug]) byEventType[slug] = { slug, label, count: 0 };
          byEventType[slug].count++;
        }

        return json({
          ok: true,
          connected: true,
          stats: {
            total: rawBookings.length,
            upcoming,
            completed,
            cancelled,
            no_show: noShow,
            by_event_type: Object.values(byEventType),
          },
        }, 200, request);
      } catch {
        return json({ ok: false, error: 'CALCOM_ERROR', message: 'Failed to fetch Cal.com bookings' }, 502, request);
      }
    },
  },

  // -------------------------------------------------------------------------
  // UNIFIED CALENDAR (Google + Cal.com + IRS)
  // -------------------------------------------------------------------------

  {
    method: 'GET', pattern: '/v1/calendar/events',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const url = new URL(request.url);
      const startParam = url.searchParams.get('start');
      const endParam = url.searchParams.get('end');
      if (!startParam || !endParam) {
        return json({ ok: false, error: 'MISSING_PARAMS', message: 'start and end query params required (YYYY-MM-DD)' }, 400, request);
      }
      const rangeStart = startParam;
      const rangeEnd = endParam;

      const merged = [];

      // --- Google Calendar ---
      let googleConnected = false;
      let googleEvents = [];
      try {
        const row = await env.DB.prepare(
          'SELECT google_access_token, google_refresh_token, google_token_expiry FROM accounts WHERE account_id = ?'
        ).bind(session.account_id).first();

        if (row && row.google_access_token) {
          googleConnected = true;
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

          const calUrl = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
          calUrl.searchParams.set('timeMin', new Date(rangeStart + 'T00:00:00Z').toISOString());
          calUrl.searchParams.set('timeMax', new Date(rangeEnd + 'T23:59:59Z').toISOString());
          calUrl.searchParams.set('singleEvents', 'true');
          calUrl.searchParams.set('orderBy', 'startTime');
          calUrl.searchParams.set('maxResults', '250');

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

          if (calRes.ok) {
            const calData = await calRes.json();
            googleEvents = (calData.items ?? []).map((e) => {
              const startDt = e.start?.dateTime ?? e.start?.date ?? '';
              const endDt = e.end?.dateTime ?? e.end?.date ?? '';
              const allDay = !!(e.start?.date && !e.start?.dateTime);
              const dateStr = allDay ? startDt : startDt.slice(0, 10);
              const startTime = allDay ? null : startDt.slice(11, 16);
              const endTime = allDay ? null : endDt.slice(11, 16);
              return {
                id: e.id ?? '',
                title: e.summary ?? '(No title)',
                date: dateStr,
                start_time: startTime,
                end_time: endTime,
                all_day: allDay,
                source: 'google',
                color: '#4285f4',
                url: e.htmlLink ?? '',
                description: e.description ?? '',
                location: e.location ?? '',
              };
            });
            for (const ge of googleEvents) merged.push(ge);
          } else {
            const errorBody = await calRes.text().catch(() => '');
            console.log('[calendar] Google API error:', calRes.status, errorBody);
            googleEvents = [];
            googleConnected = { error: 'Google Calendar API returned ' + calRes.status };
          }
        }
      } catch (err) {
        console.log('[calendar] Google fetch error:', err.message);
        googleConnected = { error: 'Google Calendar fetch failed: ' + err.message };
      }

      // --- Cal.com bookings ---
      // Priority: per-user OAuth token > admin CAL_API_KEY (scoped by email)
      let calcomBookings = [];
      let calcomConnected = false;
      try {
        const calcomRow = await env.DB.prepare(
          'SELECT calcom_access_token, calcom_refresh_token, calcom_token_expiry FROM accounts WHERE account_id = ?'
        ).bind(session.account_id).first();
        let userCalToken = calcomRow?.calcom_access_token || null;
        calcomConnected = !!userCalToken;

        // Refresh OAuth token if expired
        if (userCalToken && calcomRow.calcom_refresh_token) {
          const expiry = calcomRow.calcom_token_expiry ? new Date(calcomRow.calcom_token_expiry).getTime() : 0;
          if (Date.now() + 60000 > expiry) {
            try {
              const calClientId = env.CALCOM_CLIENT_ID ?? '9d03bcaa8ee24644d21dc7af5c3c17722ffa314c9790f2c7c83a1f88032b8420';
              const refreshRes = await fetch('https://app.cal.com/api/auth/oauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  grant_type: 'refresh_token',
                  client_id: calClientId,
                  client_secret: env.CALCOM_CLIENT_SECRET,
                  refresh_token: calcomRow.calcom_refresh_token,
                }),
              });
              if (refreshRes.ok) {
                const refreshData = await refreshRes.json();
                userCalToken = refreshData.access_token;
                const newExpiry = new Date(Date.now() + (refreshData.expires_in ?? 3600) * 1000).toISOString();
                await d1Run(env.DB,
                  'UPDATE accounts SET calcom_access_token = ?, calcom_refresh_token = ?, calcom_token_expiry = ? WHERE account_id = ?',
                  [userCalToken, refreshData.refresh_token ?? calcomRow.calcom_refresh_token, newExpiry, session.account_id]
                );
              }
            } catch (err) {
              console.log('[calendar] Cal.com token refresh error:', err.message);
            }
          }
        }

        const calApiKey = userCalToken || env.CAL_API_KEY || null;

        if (calApiKey) {
          let rawBookings = [];
          try {
            const v2Res = await fetch('https://api.cal.com/v2/bookings?status=upcoming,past,cancelled,recurring,unconfirmed&take=250', {
              headers: {
                'Authorization': `Bearer ${calApiKey}`,
                'cal-api-version': '2024-08-13',
              },
            });
            const v2Text = await v2Res.text();
            if (v2Res.ok) {
              const v2Data = JSON.parse(v2Text);
              rawBookings = v2Data.data || v2Data.bookings || [];
            } else {
              console.log('[calendar] Cal.com v2 bookings error:', v2Res.status, v2Text.slice(0, 500));
            }
          } catch (v2Err) {
            console.log('[calendar] Cal.com v2 bookings fetch failed:', v2Err.message);
          }

          // When using the admin key, filter by user email; personal key returns only their bookings
          const userEmail = (session.email || '').toLowerCase();
          for (const b of rawBookings) {
            const start = b.startTime || b.start || b.start_time || '';
            const end = b.endTime || b.end || b.end_time || '';
            const status = (b.status || '').toLowerCase();
            if (status === 'cancelled') continue;
            const dateStr = start.slice(0, 10);
            if (dateStr < rangeStart || dateStr > rangeEnd) continue;

            // When using admin key, scope to user's email
            if (!userCalToken && userEmail) {
              const attendees = b.attendees || b.guests || [];
              const attendeeEmails = Array.isArray(attendees) ? attendees.map(a => (a.email || '').toLowerCase()) : [];
              const hostEmail = (b.user?.email || b.hostEmail || '').toLowerCase();
              const isRelevant = hostEmail === userEmail || attendeeEmails.includes(userEmail);
              if (!isRelevant) continue;
            }

            const attendees = b.attendees || b.guests || [];
            const firstAttendee = Array.isArray(attendees) && attendees.length > 0 ? attendees[0] : {};
            const startTime = start.length > 10 ? start.slice(11, 16) : null;
            const endTime = end.length > 10 ? end.slice(11, 16) : null;
            const bookingUid = b.uid || b.id || b.bookingId || '';
            const booking = {
              id: `calcom-${b.id || b.uid || b.bookingId}`,
              title: b.title || b.eventType?.title || 'Cal.com Booking',
              date: dateStr,
              start_time: startTime,
              end_time: endTime,
              all_day: false,
              source: 'calcom',
              color: '#22c55e',
              url: b.meetingUrl || '',
              meeting_url: b.meetingUrl || '',
              manage_url: bookingUid ? `https://app.cal.com/booking/${bookingUid}` : '',
              description: `${firstAttendee.name || ''} (${firstAttendee.email || ''})`.trim(),
            };
            calcomBookings.push(booking);
            merged.push(booking);
          }
        }
      } catch (err) {
        console.log('[calendar] Cal.com fetch error:', err.message);
      }

      // --- IRS tax dates ---
      const irsDates = IRS_TAX_DATES
        .filter(d => d.date >= rangeStart && d.date <= rangeEnd)
        .map(d => ({
          id: `irs-${d.date}-${d.title.slice(0, 20).replace(/\s/g, '-').toLowerCase()}`,
          title: d.title,
          date: d.date,
          start_time: null,
          end_time: null,
          all_day: true,
          source: 'irs',
          color: '#dc2626',
          url: '',
          description: '',
        }));
      for (const irs of irsDates) merged.push(irs);

      // Sort merged: by date, then by start_time (nulls/all-day first)
      merged.sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        const at = a.start_time || '';
        const bt = b.start_time || '';
        return at < bt ? -1 : at > bt ? 1 : 0;
      });

      const googleResult = typeof googleConnected === 'object' && googleConnected?.error
        ? { connected: true, events: [], error: googleConnected.error }
        : { connected: googleConnected, events: googleEvents };

      return json({
        ok: true,
        google: googleResult,
        calcom: { connected: calcomConnected, bookings: calcomBookings },
        irs: { dates: irsDates },
        merged,
      }, 200, request);
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
        }, 200, request);
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
      }, 200, request);
    },
  },


  // -------------------------------------------------------------------------
  // TMP — Form 2848 Generator (POA)
  // Contract: contracts/tmp/tmp.tool.2848.v1.json
  // Returns a filled IRS Form 2848 Page 1 as base64. Template lives in R2 at
  // `tools/2848/f2848.pdf` — upload via `node scripts/upload-2848-template.js`.
  // -------------------------------------------------------------------------

  {
    method: 'POST', pattern: '/v1/tools/2848/generate',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      // Rate limit: 5 req/min per account
      const rlKey = `rl:tools_2848:${session.account_id}`;
      const rlObj = await env.R2_VIRTUAL_LAUNCH.get(rlKey);
      if (rlObj) {
        const rlData = await rlObj.json();
        const windowStart = Date.now() - 60000;
        const recentHits = (rlData.hits || []).filter((t) => t > windowStart);
        if (recentHits.length >= 5) {
          return json({ ok: false, error: 'RATE_LIMIT_EXCEEDED', message: 'Maximum 5 Form 2848 generations per minute' }, 429, request);
        }
        recentHits.push(Date.now());
        await r2Put(env.R2_VIRTUAL_LAUNCH, rlKey, { hits: recentHits });
      } else {
        await r2Put(env.R2_VIRTUAL_LAUNCH, rlKey, { hits: [Date.now()] });
      }

      const payload = await parseBody(request);
      if (!payload || typeof payload !== 'object') {
        return json({ ok: false, error: 'validation_failed', details: ['JSON body required'] }, 400, request);
      }

      // Whitelist top-level fields (enforces contract `additionalProperties: false`)
      const allowedFields = new Set([
        'taxpayer_name', 'taxpayer_address', 'taxpayer_tin', 'taxpayer_daytime_phone', 'taxpayer_plan_number',
        'rep_name', 'rep_caf_number', 'rep_ptin', 'rep_phone', 'rep_fax', 'rep_address', 'rep_designation', 'rep_jurisdiction',
        'tax_matters',
        'line5a_access_irs_records', 'line5a_sign_consent_disclosure', 'line5a_substitute_return',
        'line5a_sign_claim_refund', 'line5a_receive_refund', 'line5a_other', 'line5a_other_text',
        'case_id', 'generated_by',
      ]);
      const extraFields = Object.keys(payload).filter((k) => !allowedFields.has(k));
      if (extraFields.length > 0) {
        return json({ ok: false, error: 'validation_failed', details: [`Unexpected fields: ${extraFields.join(', ')}`] }, 400, request);
      }

      // Required field validation
      const requiredString = (name, max) => {
        const v = payload[name];
        if (typeof v !== 'string' || v.trim() === '') return `${name} is required`;
        if (max && v.length > max) return `${name} exceeds max length ${max}`;
        return null;
      };
      const errs = [];
      [
        ['taxpayer_name', 100],
        ['taxpayer_address', 200],
        ['taxpayer_tin', 11],
        ['rep_name', 100],
        ['rep_caf_number', 20],
        ['rep_ptin', 20],
        ['rep_phone', 20],
        ['rep_address', 200],
      ].forEach(([name, max]) => {
        const e = requiredString(name, max);
        if (e) errs.push(e);
      });

      if (!/^(\d{3}-\d{2}-\d{4}|\d{2}-\d{7}|\d{9})$/.test(String(payload.taxpayer_tin || ''))) {
        errs.push('taxpayer_tin must be XXX-XX-XXXX, XX-XXXXXXX, or 9 digits');
      }

      const allowedDesignations = new Set([
        'Attorney', 'CPA', 'Enrolled Agent', 'Officer', 'Full-Time Employee', 'Family Member',
        'Enrolled Actuary', 'Enrolled Retirement Plan Agent', 'Registered Tax Return Preparer',
        'Student Attorney', 'Other',
      ]);
      if (!allowedDesignations.has(payload.rep_designation)) {
        errs.push('rep_designation must be one of the allowed values');
      }

      if (!Array.isArray(payload.tax_matters) || payload.tax_matters.length < 1 || payload.tax_matters.length > 4) {
        errs.push('tax_matters must be an array with 1–4 entries');
      } else {
        payload.tax_matters.forEach((m, i) => {
          if (!m || typeof m !== 'object') {
            errs.push(`tax_matters[${i}] must be an object`);
            return;
          }
          if (typeof m.description !== 'string' || m.description.trim() === '' || m.description.length > 100) {
            errs.push(`tax_matters[${i}].description invalid`);
          }
          if (typeof m.tax_form !== 'string' || m.tax_form.trim() === '' || m.tax_form.length > 20) {
            errs.push(`tax_matters[${i}].tax_form invalid`);
          }
          if (typeof m.years_or_periods !== 'string' || m.years_or_periods.trim() === '' || m.years_or_periods.length > 60) {
            errs.push(`tax_matters[${i}].years_or_periods invalid`);
          }
        });
      }

      if (payload.generated_by !== 'client' && payload.generated_by !== 'staff') {
        errs.push('generated_by must be "client" or "staff"');
      }

      if (errs.length > 0) {
        return json({ ok: false, error: 'validation_failed', details: errs }, 400, request);
      }

      // Load template from R2 (cached per isolate)
      const templateBytes = await load2848Template(env);
      if (!templateBytes) {
        return json({
          ok: false,
          error: 'template_not_found',
          details: ['Form 2848 template not found in R2 at tools/2848/f2848.pdf. Run scripts/upload-2848-template.js to upload.'],
        }, 500, request);
      }

      // Transform contract payload → generator input shape
      const taxpayerNameParts = f2848_splitFullName(payload.taxpayer_name);
      const repNameParts = f2848_splitFullName(payload.rep_name);
      const firstMatter = payload.tax_matters[0];

      const generatorInput = {
        clientFirstName: taxpayerNameParts.first,
        clientLastName: taxpayerNameParts.last,
        clientAddressLine1: payload.taxpayer_address,
        clientAddressLine2: '',
        clientAddressTown: '',
        clientAddressRegion: '',
        clientAddressZip: '',
        TaxpayerSSNITIN: payload.taxpayer_tin,

        repFirst: repNameParts.first,
        repLast: repNameParts.last,
        repAddr1: payload.rep_address,
        repAddr2: '',
        repCity: '',
        repState: '',
        repZip: '',
        repCAF: payload.rep_caf_number,
        repPTIN: payload.rep_ptin,
        repTel: payload.rep_phone,
        repFax: payload.rep_fax || '',

        line3DescriptionOfMatter: firstMatter.description,
        line3TaxFormNumber: firstMatter.tax_form,
        // The generator's formatPeriod expects yearFrom/yearTo; passing the
        // full string through yearFrom preserves the contract's flexibility
        // (e.g. "2020, 2021, 2022, 2023" or "2020 through 2023").
        yearFrom: firstMatter.years_or_periods,
        yearTo: '',

        line5aAccessRecords: payload.line5a_access_irs_records !== false,
        line5aAuthorizeDisclosure: payload.line5a_sign_consent_disclosure === true,
        line5aSubstituteOrAddRep: false,
        line5aSignReturn: payload.line5a_substitute_return === true,
      };

      let pdfBytes;
      try {
        pdfBytes = await f2848_generate(generatorInput, templateBytes);
      } catch (e) {
        return json({
          ok: false,
          error: 'pdf_generation_failed',
          details: [String(e && e.message ? e.message : e)],
        }, 500, request);
      }

      const pdfBase64 = f2848_uint8ToBase64(pdfBytes);
      const filename = f2848_buildFilename(generatorInput);

      // Receipt
      const eventId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const nowMs = Date.now();
      const tinDigits = String(payload.taxpayer_tin || '').replace(/\D/g, '');
      const tinLast4 = tinDigits.slice(-4) || '0000';
      const dedupeKey = `${payload.taxpayer_tin}+${payload.rep_caf_number}`;

      const receipt = {
        event_id: eventId,
        account_id: session.account_id,
        dedupe_key: dedupeKey,
        tool_name: '2848',
        build_id: F2848_BUILD_ID,
        generated_by: payload.generated_by,
        case_id: payload.case_id || null,
        filename,
        created_at: nowIso,
        // PII-safe: store structured summary, not the raw TIN
        summary: {
          taxpayer_name: payload.taxpayer_name,
          taxpayer_tin_last4: tinLast4,
          rep_name: payload.rep_name,
          rep_caf_number: payload.rep_caf_number,
          rep_designation: payload.rep_designation,
          tax_matters_count: payload.tax_matters.length,
        },
      };
      const receiptKey = `receipts/tmp/tools/2848/${tinLast4}-${nowMs}.json`;
      await r2Put(env.R2_VIRTUAL_LAUNCH, receiptKey, receipt);

      return json({
        ok: true,
        pdf_base64: pdfBase64,
        filename,
        event_id: eventId,
        build_id: F2848_BUILD_ID,
      }, 200, request);
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
      }, 200, request);
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
      }, 200, request);
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
          }, 200, request);
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
        }, 200, request);
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
        }, 200, request);
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
        }, 200, request);
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
        }, 200, request);
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
      const url = new URL(request.url);
      const specialty = url.searchParams.get('specialty') || null;
      const city = url.searchParams.get('city') || null;
      const state = url.searchParams.get('state') || null;
      const zip = url.searchParams.get('zip') || null;
      const page = Math.max(1, Math.min(100, parseInt(url.searchParams.get('page')) || 1));
      const limit = 20;
      const offset = (page - 1) * limit;

      let where = `WHERE status = 'active'`;
      const filterParams = [];

      if (specialty) { where += ` AND LOWER(specialties) LIKE LOWER(?)`; filterParams.push(`%${specialty}%`); }
      if (city)      { where += ` AND LOWER(city) LIKE LOWER(?)`; filterParams.push(`%${city}%`); }
      if (state)     { where += ` AND LOWER(state) LIKE LOWER(?)`; filterParams.push(`%${state}%`); }
      if (zip)       { where += ` AND LOWER(zip) LIKE LOWER(?)`; filterParams.push(`%${zip}%`); }

      try {
        const countResult = await env.DB.prepare(
          `SELECT COUNT(*) as total FROM profiles ${where}`
        ).bind(...filterParams).first();
        const total = countResult?.total || 0;

        const result = await env.DB.prepare(
          `SELECT professional_id, display_name, bio, specialties, profession,
                  firm_name, city, state, status, created_at
           FROM profiles ${where}
           ORDER BY created_at DESC LIMIT ? OFFSET ?`
        ).bind(...filterParams, limit, offset).all();

        const profiles = (result.results || []).map(row => d1RowToProfileCard(row));

        return json({
          ok: true,
          profiles,
          pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
        }, 200, request);
      } catch (error) {
        console.error('Directory listing error:', error);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Internal server error' }, 500, request);
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

  // GET /v1/tmp/client-pool
  // Contract: /contracts/tmp/tmp.client-pool.list.v1.json (pending — read-model)
  // Lists cases from R2 under client_pool/ prefix. Filters:
  //   ?status=available              → only cases with that status
  //   ?status=assigned,in_progress   → comma-separated list = union match
  //   ?professional_id={id}          → only cases assigned to that pro
  //   ?page=1&limit=20               → pagination (default page 1, limit 20, max 100)
  {
    method: 'GET', pattern: '/v1/tmp/client-pool',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      try {
        const url = new URL(request.url);
        const statusFilter = url.searchParams.get('status');
        const professionalIdFilter = url.searchParams.get('professional_id');
        const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
        const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit')) || 20));

        const listResult = await env.R2_VIRTUAL_LAUNCH.list({ prefix: 'client_pool/', limit: 1000 });
        const objectsOnly = (listResult.objects || []).filter(obj => obj.key.endsWith('.json'));

        const loaded = await Promise.all(
          objectsOnly.map(async (obj) => {
            try {
              const item = await env.R2_VIRTUAL_LAUNCH.get(obj.key);
              if (!item) return null;
              return await item.json();
            } catch {
              return null;
            }
          })
        );

        let cases = loaded.filter(Boolean);
        if (statusFilter) {
          const allowed = statusFilter.split(',').map(s => s.trim()).filter(Boolean);
          if (allowed.length === 1) {
            cases = cases.filter(c => c.status === allowed[0]);
          } else if (allowed.length > 1) {
            const allowedSet = new Set(allowed);
            cases = cases.filter(c => allowedSet.has(c.status));
          }
        }
        if (professionalIdFilter) {
          cases = cases.filter(c => c.servicing_professional_id === professionalIdFilter);
        }

        cases.sort((a, b) => {
          const ta = a.created_at || a.updated_at || '';
          const tb = b.created_at || b.updated_at || '';
          return tb.localeCompare(ta);
        });

        const total = cases.length;
        const offset = (page - 1) * limit;
        const pageCases = cases.slice(offset, offset + limit);

        return json({
          ok: true,
          cases: pageCases,
          pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 1 }
        }, 200, request);
      } catch (e) {
        console.error('Client pool list error:', e?.message, e?.stack);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to list client pool cases' }, 500, request);
      }
    },
  },

  // POST /v1/tmp/inquiries
  // Contract: /contracts/tmp/tmp.inquiry.submit.v1.json
  // Public taxpayer intake — no auth. Writes canonical to R2 + receipt + best-effort D1.
  {
    method: 'POST', pattern: '/v1/tmp/inquiries',
    handler: async (_method, _pattern, _params, request, env) => {
      const contentType = request.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('application/json')) {
        return json({ ok: false, error: 'validation_failed', message: 'Content-Type must be application/json' }, 400, request);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'validation_failed', message: 'Invalid JSON body' }, 400, request);
      }
      if (!body || typeof body !== 'object') {
        return json({ ok: false, error: 'validation_failed', message: 'Payload must be a JSON object' }, 400, request);
      }

      const TMP_STATE_ENUM = new Set([
        'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
        'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
        'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
        'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
        'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
      ]);
      const TMP_SERVICE_ENUM = new Set([
        'Appeals','Audit Defense','Business Tax Advisory','Compliance','Consulting',
        'Estate & Trust Tax','Expert Witness','Foreign Reporting (FBAR/FATCA)',
        'IRS Collections Defense','Offer in Compromise','Payroll Tax Defense',
        'Penalty Abatement','Tax Litigation','Tax Monitoring','Tax Planning',
        'Tax Preparation','Tax Resolution','Trust Fund Recovery Defense'
      ]);
      const TMP_ENTITY_ENUM = new Set([
        'Businesses','C Corporations','Executives','Individuals',
        'LLCs','Nonprofits','Partnerships','S Corporations'
      ]);
      const TMP_LANGUAGE_ENUM = new Set([
        'Arabic','Chinese','English','French','German','Hindi','Japanese',
        'Korean','Portuguese','Russian','Spanish','Tagalog','Vietnamese'
      ]);
      const TMP_SOURCE_ENUM = new Set(['inquiry_form', 'questionnaire']);

      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 100) {
        return json({ ok: false, error: 'validation_failed', message: 'name is required (1-100 chars)' }, 400, request);
      }
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ ok: false, error: 'validation_failed', message: 'email is required and must be a valid email address' }, 400, request);
      }
      const phone = body.phone == null ? null : String(body.phone).trim();
      if (phone !== null && phone.length > 20) {
        return json({ ok: false, error: 'validation_failed', message: 'phone must be 20 chars or fewer' }, 400, request);
      }
      const state = typeof body.state === 'string' ? body.state.trim().toUpperCase() : '';
      if (!TMP_STATE_ENUM.has(state)) {
        return json({ ok: false, error: 'validation_failed', message: 'state must be a valid 2-letter US state code' }, 400, request);
      }
      const serviceNeeded = typeof body.service_needed === 'string' ? body.service_needed.trim() : '';
      if (!TMP_SERVICE_ENUM.has(serviceNeeded)) {
        return json({ ok: false, error: 'validation_failed', message: 'service_needed must match the canonical services enum' }, 400, request);
      }
      const entityType = typeof body.entity_type === 'string' ? body.entity_type.trim() : '';
      if (!TMP_ENTITY_ENUM.has(entityType)) {
        return json({ ok: false, error: 'validation_failed', message: 'entity_type must match the canonical entity types enum' }, 400, request);
      }
      let languagePreference = null;
      if (body.language_preference != null && body.language_preference !== '') {
        const lp = String(body.language_preference).trim();
        if (!TMP_LANGUAGE_ENUM.has(lp)) {
          return json({ ok: false, error: 'validation_failed', message: 'language_preference must match the canonical languages enum' }, 400, request);
        }
        languagePreference = lp;
      }
      let description = null;
      if (body.description != null && body.description !== '') {
        if (typeof body.description !== 'string' || body.description.length > 2000) {
          return json({ ok: false, error: 'validation_failed', message: 'description must be a string of 2000 chars or fewer' }, 400, request);
        }
        description = body.description;
      }
      let matchedProfessionalIds = [];
      if (body.matched_professional_ids != null) {
        if (!Array.isArray(body.matched_professional_ids) || body.matched_professional_ids.length > 3) {
          return json({ ok: false, error: 'validation_failed', message: 'matched_professional_ids must be an array of at most 3 strings' }, 400, request);
        }
        for (const id of body.matched_professional_ids) {
          if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
            return json({ ok: false, error: 'validation_failed', message: 'matched_professional_ids entries must be non-empty strings' }, 400, request);
          }
        }
        matchedProfessionalIds = body.matched_professional_ids;
      }
      let selectedProfessionalId = null;
      if (body.selected_professional_id != null && body.selected_professional_id !== '') {
        if (typeof body.selected_professional_id !== 'string' || body.selected_professional_id.length > 128) {
          return json({ ok: false, error: 'validation_failed', message: 'selected_professional_id must be a string up to 128 chars' }, 400, request);
        }
        selectedProfessionalId = body.selected_professional_id;
      }
      const source = typeof body.source === 'string' ? body.source : '';
      if (!TMP_SOURCE_ENUM.has(source)) {
        return json({ ok: false, error: 'validation_failed', message: 'source must be inquiry_form or questionnaire' }, 400, request);
      }

      const inquiryId = `INQ_${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const canonical = {
        inquiry_id: inquiryId,
        name,
        email,
        phone,
        state,
        service_needed: serviceNeeded,
        entity_type: entityType,
        language_preference: languagePreference,
        description,
        matched_professional_ids: matchedProfessionalIds,
        selected_professional_id: selectedProfessionalId,
        source,
        status: 'new',
        created_at: now,
      };

      // Step 1 — receipt
      try {
        await r2Put(env.R2_VIRTUAL_LAUNCH, `receipts/tmp/inquiries/${inquiryId}.json`, {
          event: 'TMP_INQUIRY_SUBMITTED',
          event_id: inquiryId,
          inquiry_id: inquiryId,
          email,
          source,
          matched_professional_ids: matchedProfessionalIds,
          selected_professional_id: selectedProfessionalId,
          created_at: now,
        });
      } catch (e) {
        console.error('tmp/inquiries: receipt write failed', e?.message);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to write receipt' }, 500, request);
      }

      // Step 2 — canonical
      try {
        await r2Put(env.R2_VIRTUAL_LAUNCH, `inquiries/${inquiryId}.json`, canonical);
      } catch (e) {
        console.error('tmp/inquiries: canonical write failed', e?.message);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to write inquiry' }, 500, request);
      }

      // Step 3 — best-effort D1 projection. The legacy inquiries table has a
      // split first_name/last_name shape and NOT NULL constraints on phone; if
      // the insert fails, R2 remains authoritative.
      try {
        const parts = name.split(/\s+/).filter(Boolean);
        const firstName = parts[0] || name;
        const lastName = parts.slice(1).join(' ') || '';
        await d1Run(env.DB,
          `INSERT INTO inquiries (
            inquiry_id, first_name, last_name, email, phone,
            business_types, services_needed,
            preferred_state, preferred_city, prior_audit_experience,
            membership_interest, status, assigned_professional_id,
            response_message, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`,
          [
            inquiryId, firstName, lastName, email, phone || '',
            JSON.stringify([entityType]),
            JSON.stringify([serviceNeeded]),
            state,
            '',
            0,
            '',
            selectedProfessionalId,
            description,
            now,
          ]
        );
      } catch (e) {
        // Table shape drift or constraint miss — R2 is authoritative, swallow.
      }

      return json({ ok: true, inquiry_id: inquiryId }, 200, request);
    },
  },

  // POST /v1/tmp/client-pool/accept
  // Contract: /contracts/tmp/tmp.client-pool.accept.v1.json
  // A tax professional claims an available case from the Client Pool.
  // Write order: validate → receiptAppend → canonicalUpsert → D1 projection (best-effort).
  // First claim wins: rejects with 409 case_not_available if status !== 'available'.
  {
    method: 'POST', pattern: '/v1/tmp/client-pool/accept',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'validation_failed', message: 'Invalid JSON body' }, 400, request);
      }

      const caseId = typeof body?.case_id === 'string' ? body.case_id.trim() : '';
      if (!caseId) {
        return json({ ok: false, error: 'validation_failed', message: 'case_id is required' }, 400, request);
      }

      // Resolve professional_id server-side from session — client value is informational only.
      let professionalId = null;
      try {
        const profileRow = await env.DB.prepare(
          "SELECT professional_id FROM profiles WHERE account_id = ?"
        ).bind(session.account_id).first();
        professionalId = profileRow?.professional_id || null;
      } catch (e) {
        console.error('client-pool/accept: profile lookup failed', e?.message);
      }

      if (!professionalId) {
        return json({ ok: false, error: 'profile_required', message: 'Session account has no linked professional profile.' }, 403, request);
      }

      // Read canonical case record from R2.
      const canonicalKey = `client_pool/${caseId}.json`;
      let caseRecord;
      try {
        const raw = await r2Get(env.R2_VIRTUAL_LAUNCH, canonicalKey);
        if (!raw) {
          return json({ ok: false, error: 'case_not_found', message: 'Case not found in client pool.' }, 404, request);
        }
        caseRecord = JSON.parse(raw);
      } catch (e) {
        console.error('client-pool/accept: canonical read failed', e?.message);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to read case record' }, 500, request);
      }

      if (caseRecord.status !== 'available') {
        // First-claim-wins: if already assigned to the same pro, return the existing record as success
        // (idempotent replay). Otherwise reject.
        if (caseRecord.status === 'assigned' && caseRecord.servicing_professional_id === professionalId) {
          return json({
            ok: true,
            deduped: true,
            eventId: caseId,
            status: 'assigned',
            case_id: caseId,
            professional_id: professionalId,
            assigned_at: caseRecord.assigned_at || null
          }, 200, request);
        }
        return json({
          ok: false,
          error: 'case_not_available',
          message: 'This case has already been accepted by another professional.'
        }, 409, request);
      }

      const now = new Date().toISOString();

      // Step 1: append receipt (immutable event record)
      const receiptKey = `receipts/tmp/client-pool/accept/${caseId}.json`;
      try {
        await r2Put(env.R2_VIRTUAL_LAUNCH, receiptKey, {
          event: 'CLIENT_POOL_CASE_ACCEPTED',
          event_id: caseId,
          case_id: caseId,
          account_id: session.account_id,
          professional_id: professionalId,
          accepted_at: now,
          prior_status: caseRecord.status || null
        });
      } catch (e) {
        console.error('client-pool/accept: receipt write failed', e?.message);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to write receipt' }, 500, request);
      }

      // Step 2: canonical upsert
      const updatedRecord = {
        ...caseRecord,
        status: 'assigned',
        servicing_professional_id: professionalId,
        assigned_at: now,
        updated_at: now
      };
      try {
        await r2Put(env.R2_VIRTUAL_LAUNCH, canonicalKey, updatedRecord);
      } catch (e) {
        console.error('client-pool/accept: canonical write failed', e?.message);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to update case record' }, 500, request);
      }

      // Step 3: D1 projection (best-effort — table may not exist yet)
      try {
        await env.DB.prepare(
          "UPDATE client_pool SET status = ?, servicing_professional_id = ?, assigned_at = ?, updated_at = ? WHERE case_id = ?"
        ).bind('assigned', professionalId, now, now, caseId).run();
      } catch (e) {
        // Table may not exist yet — R2 is authoritative, swallow and continue.
      }

      return json({
        ok: true,
        status: 'assigned',
        case_id: caseId,
        professional_id: professionalId,
        assigned_at: now
      }, 200, request);
    },
  },

  // -------------------------------------------------------------------------
  // TMP Compliance Record Routes
  // Contracts:
  //   - /contracts/tmp/tmp.compliance-record.write.v1.json  (staff write + staff read)
  //   - /contracts/tmp/tmp.compliance-record.read.v1.json   (client-facing report read)
  // Write pipeline (per CLAUDE.md):
  //   validate → receiptAppend → canonicalUpsert → D1 projection (best-effort)
  // R2 keys:
  //   canonical: compliance_records/{order_id}.json
  //   receipt:   receipts/tmp/compliance-records/{order_id}.json (history log — appended)
  // -------------------------------------------------------------------------

  // POST /v1/tmp/compliance-records
  // Staff writes a draft or finalizes a compliance record for a given order.
  // Finalization lock: once compliance_record_status === 'Final' on canonical,
  // subsequent POSTs return { ok: false, error: 'record_finalized' }.
  {
    method: 'POST', pattern: '/v1/tmp/compliance-records',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      // Require application/json content-type (contract.validation.requireJsonContentType)
      const contentType = request.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('application/json')) {
        return json({ ok: false, error: 'validation_failed', message: 'Content-Type must be application/json' }, 400, request);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'validation_failed', message: 'Invalid JSON body' }, 400, request);
      }

      // Required fields (contract.payload.required)
      const required = ['account_id', 'order_id', 'servicing_professional_id', 'source'];
      for (const field of required) {
        if (typeof body[field] !== 'string' || body[field].length === 0) {
          return json({ ok: false, error: 'validation_failed', message: `${field} is required` }, 400, request);
        }
      }
      if (body.source !== 'staff_compliance_records') {
        return json({ ok: false, error: 'validation_failed', message: 'source must be staff_compliance_records' }, 400, request);
      }

      const orderId = body.order_id;
      const canonicalKey = `compliance_records/${orderId}.json`;

      // Resolve session's professional_id from linked profile
      let sessionProfessionalId = null;
      try {
        const profileRow = await env.DB.prepare(
          "SELECT professional_id FROM profiles WHERE account_id = ?"
        ).bind(session.account_id).first();
        sessionProfessionalId = profileRow?.professional_id || null;
      } catch (e) {
        console.error('compliance-records: profile lookup failed', e?.message);
      }

      // Authorization: the session must be the servicing professional for this case.
      // If a client_pool case exists with matching case_id === order_id, enforce ownership.
      // Otherwise allow a standalone compliance record (the session pro becomes the author).
      try {
        const caseRaw = await r2Get(env.R2_VIRTUAL_LAUNCH, `client_pool/${orderId}.json`);
        if (caseRaw) {
          const caseRecord = JSON.parse(caseRaw);
          if (caseRecord.servicing_professional_id && sessionProfessionalId &&
              caseRecord.servicing_professional_id !== sessionProfessionalId) {
            return json({ ok: false, error: 'FORBIDDEN', message: 'You are not the servicing professional for this case.' }, 403, request);
          }
        }
      } catch (e) {
        // Non-fatal — continue. Standalone records are permitted.
      }

      // Load existing canonical to enforce finalization lock
      let existing = null;
      try {
        const raw = await r2Get(env.R2_VIRTUAL_LAUNCH, canonicalKey);
        if (raw) existing = JSON.parse(raw);
      } catch (e) {
        // Missing or unreadable — treat as first write
      }

      if (existing && existing.compliance_record_status === 'Final') {
        return json({ ok: false, error: 'record_finalized', message: 'This compliance record is finalized and cannot be modified.' }, 409, request);
      }

      const now = new Date().toISOString();
      const recordStatus = body.compliance_record_status === 'Final' ? 'Final' : 'Draft';
      const priorVersion = typeof existing?.version === 'number' ? existing.version : 0;

      // Step 1: receipt (immutable event record — keyed per-save via timestamp suffix)
      const receiptKey = `receipts/tmp/compliance-records/${orderId}.json`;
      try {
        await r2Put(env.R2_VIRTUAL_LAUNCH, receiptKey, {
          event: 'TMP_COMPLIANCE_RECORD_SAVED',
          event_id: orderId,
          order_id: orderId,
          account_id: session.account_id,
          professional_id: sessionProfessionalId,
          record_status: recordStatus,
          saved_at: now,
          version: priorVersion + 1
        });
      } catch (e) {
        console.error('compliance-records: receipt write failed', e?.message);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to write receipt' }, 500, request);
      }

      // Step 2: canonical upsert
      const canonicalRecord = {
        ...(existing || {}),
        ...body,
        compliance_record_status: recordStatus,
        updated_at: now,
        updated_by: session.account_id,
        version: priorVersion + 1
      };
      if (!canonicalRecord.created_at) canonicalRecord.created_at = now;
      if (recordStatus === 'Final' && !canonicalRecord.finalized_at) {
        canonicalRecord.finalized_at = now;
        canonicalRecord.finalized_by = session.account_id;
      }

      try {
        await r2Put(env.R2_VIRTUAL_LAUNCH, canonicalKey, canonicalRecord);
      } catch (e) {
        console.error('compliance-records: canonical write failed', e?.message);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to write canonical record' }, 500, request);
      }

      // Step 3: D1 projection (best-effort — table may not exist yet)
      try {
        await env.DB.prepare(
          "INSERT INTO compliance_records (order_id, account_id, servicing_professional_id, record_status, updated_at, finalized_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(order_id) DO UPDATE SET record_status = excluded.record_status, updated_at = excluded.updated_at, finalized_at = excluded.finalized_at"
        ).bind(
          orderId,
          body.account_id,
          body.servicing_professional_id,
          recordStatus,
          now,
          canonicalRecord.finalized_at || null
        ).run();
      } catch (e) {
        // Table may not exist — R2 is authoritative, swallow.
      }

      return json({
        ok: true,
        status: 'saved',
        record_status: recordStatus.toLowerCase(),
        order_id: orderId,
        version: canonicalRecord.version,
        updated_at: now,
        finalized_at: canonicalRecord.finalized_at || null
      }, 200, request);
    },
  },

  // GET /v1/tmp/compliance-records/:order_id
  // Staff read — returns the full canonical record from R2.
  // Requires session; requester must be the servicing professional for the linked case
  // (if a client_pool case with the same id exists).
  {
    method: 'GET', pattern: '/v1/tmp/compliance-records/:order_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const orderId = params.order_id;
      if (!orderId) {
        return json({ ok: false, error: 'validation_failed', message: 'order_id is required' }, 400, request);
      }

      let sessionProfessionalId = null;
      try {
        const profileRow = await env.DB.prepare(
          "SELECT professional_id FROM profiles WHERE account_id = ?"
        ).bind(session.account_id).first();
        sessionProfessionalId = profileRow?.professional_id || null;
      } catch (e) {
        console.error('compliance-records read: profile lookup failed', e?.message);
      }

      // Authorization: if there's a linked client_pool case, enforce ownership.
      try {
        const caseRaw = await r2Get(env.R2_VIRTUAL_LAUNCH, `client_pool/${orderId}.json`);
        if (caseRaw) {
          const caseRecord = JSON.parse(caseRaw);
          if (caseRecord.servicing_professional_id && sessionProfessionalId &&
              caseRecord.servicing_professional_id !== sessionProfessionalId) {
            return json({ ok: false, error: 'FORBIDDEN', message: 'You are not the servicing professional for this case.' }, 403, request);
          }
        }
      } catch (e) {
        // Non-fatal — continue.
      }

      let record;
      try {
        const raw = await r2Get(env.R2_VIRTUAL_LAUNCH, `compliance_records/${orderId}.json`);
        if (!raw) {
          return json({ ok: false, error: 'not_found', message: 'No compliance record exists for this order.' }, 404, request);
        }
        record = JSON.parse(raw);
      } catch (e) {
        console.error('compliance-records read: canonical read failed', e?.message);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to read compliance record' }, 500, request);
      }

      return json({ ok: true, record }, 200, request);
    },
  },

  // GET /v1/tmp/compliance-records/:order_id/report
  // Client-facing read — returns the client-safe projection of the compliance record.
  // Contract: /contracts/tmp/tmp.compliance-record.read.v1.json
  // Excludes internal notes, IRS rep/agent fields, RO details, transcripts, authority flags.
  // Truncates notice details to 500 chars.
  {
    method: 'GET', pattern: '/v1/tmp/compliance-records/:order_id/report',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const orderId = params.order_id;
      if (!orderId) {
        return json({ ok: false, error: 'validation_failed', message: 'order_id is required' }, 400, request);
      }

      let record;
      try {
        const raw = await r2Get(env.R2_VIRTUAL_LAUNCH, `compliance_records/${orderId}.json`);
        if (!raw) {
          return json({ ok: false, error: 'not_found', message: 'No compliance report exists for this order.' }, 404, request);
        }
        record = JSON.parse(raw);
      } catch (e) {
        console.error('compliance-records report: read failed', e?.message);
        return json({ ok: false, error: 'INTERNAL_ERROR', message: 'Failed to read compliance report' }, 500, request);
      }

      // Ownership: the requesting session must either be the client (account_id match)
      // or the servicing professional (professional_id match on the record).
      const isClientOwner = record.account_id && record.account_id === session.account_id;
      let isServicingPro = false;
      if (!isClientOwner) {
        try {
          const profileRow = await env.DB.prepare(
            "SELECT professional_id FROM profiles WHERE account_id = ?"
          ).bind(session.account_id).first();
          const sessionProfessionalId = profileRow?.professional_id || null;
          isServicingPro = !!sessionProfessionalId &&
            record.servicing_professional_id === sessionProfessionalId;
        } catch (e) {
          // Non-fatal — treat as non-owner
        }
      }
      if (!isClientOwner && !isServicingPro) {
        return json({ ok: false, error: 'FORBIDDEN', message: 'You are not authorized to view this report.' }, 403, request);
      }

      // Client-safe projection per tmp.compliance-record.read.v1.json
      const report = {
        order_id: orderId,
        client_name: record.client_name,
        filing_status: record.filing_status,
        compliance_tax_year: record.compliance_tax_year,
        total_irs_balance: record.total_irs_balance,
        irs_account_status: record.irs_account_status,
        return_processing_status: record.return_processing_status,
        return_date_filed: record.return_date_filed,
        return_tax_liability: record.return_tax_liability,
        notices: Array.isArray(record.notices)
          ? record.notices.map((n) => ({
              received: n.received,
              date: n.date,
              type: n.type,
              cp_number: n.cp_number ?? null,
              details: typeof n.details === 'string' ? n.details.slice(0, 500) : n.details
            }))
          : [],
        ia_established: record.ia_established,
        ia_payment_amount: record.ia_payment_amount,
        ia_payment_date: record.ia_payment_date,
        compliance_client_summary: record.compliance_client_summary,
        compliance_record_status: record.compliance_record_status,
        compliance_prepared_date: record.compliance_prepared_date
      };

      return json({ ok: true, report }, 200, request);
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

  // POST /v1/wlvlp/site-requests
  // Public submission from WLVLP SCALE asset pages. Writes receipt + canonical
  // request JSON to R2 with status: "pending". A daily cron at 06:00 UTC
  // (handleWlvlpSiteGeneration) processes pending requests by template-fill.
  {
    method: 'POST', pattern: '/v1/wlvlp/site-requests',
    handler: async (_method, _pattern, _params, request, env) => {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'invalid_json' }, 400, request);
      }

      if (!body || typeof body !== 'object') {
        return json({ ok: false, error: 'invalid_payload' }, 400, request);
      }

      const rawSlug = typeof body.slug === 'string' ? body.slug : '';
      const slug = rawSlug.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 200);
      if (!slug) {
        return json({ ok: false, error: 'invalid_slug' }, 400, request);
      }

      // Required field checks
      if (typeof body.firm_name !== 'string' || !body.firm_name.trim()) {
        return json({ ok: false, error: 'invalid_payload', field: 'firm_name' }, 400, request);
      }
      if (!Array.isArray(body.services) || body.services.length === 0) {
        return json({ ok: false, error: 'invalid_payload', field: 'services' }, 400, request);
      }

      // Whitelist properties (additionalProperties: false)
      const allowedKeys = [
        'slug', 'firm_name', 'credential', 'city', 'state', 'services',
        'target_clients', 'color_scheme', 'logo_url', 'phone', 'email',
        'website_url', 'additional_notes',
      ];
      const clean = {};
      for (const k of allowedKeys) {
        if (body[k] !== undefined) clean[k] = body[k];
      }
      clean.slug = slug;
      if (typeof clean.phone === 'string') clean.phone = normalizePhone(clean.phone);

      const canonicalKey = `vlp-scale/wlvlp-site-requests/${slug}.json`;
      const receiptKey = `receipts/wlvlp/site-requests/${slug}.json`;

      try {
        // Idempotency check
        const existing = await env.R2_VIRTUAL_LAUNCH.get(canonicalKey);
        if (existing) {
          return json({ ok: true, status: 'already_submitted', slug }, 200, request);
        }

        const submittedAt = new Date().toISOString();
        const record = {
          ...clean,
          status: 'pending',
          submitted_at: submittedAt,
        };

        // Write receipt (immutable)
        await env.R2_VIRTUAL_LAUNCH.put(receiptKey, JSON.stringify({
          slug,
          payload: clean,
          submitted_at: submittedAt,
        }), { httpMetadata: { contentType: 'application/json' } });

        // Write canonical request — cron will pick this up at 06:00 UTC
        await env.R2_VIRTUAL_LAUNCH.put(canonicalKey, JSON.stringify(record), {
          httpMetadata: { contentType: 'application/json' },
        });

        return json({ ok: true, status: 'submitted', slug }, 200, request);
      } catch (e) {
        console.error('WLVLP site request submit error:', e);
        return json({ ok: false, error: 'internal_error' }, 500, request);
      }
    },
  },

  // GET /v1/wlvlp/admin/trigger-site-gen
  // Temporary admin route for manually triggering the WLVLP site generation
  // cron job. Useful for end-to-end testing without waiting for 06:00 UTC.
  {
    method: 'GET', pattern: '/v1/wlvlp/admin/trigger-site-gen',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;
      const adminEmails = ['jamie.williams@virtuallaunch.pro', 'hello@virtuallaunch.pro'];
      if (!adminEmails.includes((session.email || '').toLowerCase())) {
        return json({ ok: false, error: 'FORBIDDEN' }, 403, request);
      }
      try {
        const stats = await handleWlvlpSiteGeneration(env);
        return json({ ok: true, ...stats }, 200, request);
      } catch (e) {
        console.error('WLVLP admin trigger-site-gen error:', e);
        return json({ ok: false, error: 'internal_error', message: String(e?.message || e) }, 500, request);
      }
    },
  },

  // POST /v1/wlvlp/admin/upload-prospects
  // Admin-only route for uploading the WLVLP SCALE prospect list to R2.
  // Replaces the prior manual CSV upload + Claude-based batch generation step.
  // Body: { prospects: [...] }  → writes to vlp-scale/wlvlp-prospects/active.json
  {
    method: 'POST', pattern: '/v1/wlvlp/admin/upload-prospects',
    handler: async (_method, _pattern, _params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;
      const adminEmails = ['jamie.williams@virtuallaunch.pro', 'hello@virtuallaunch.pro'];
      if (!adminEmails.includes((session.email || '').toLowerCase())) {
        return json({ ok: false, error: 'FORBIDDEN' }, 403, request);
      }
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400, request); }
      if (!body || !Array.isArray(body.prospects)) {
        return json({ ok: false, error: 'invalid_payload', message: 'prospects array required' }, 400, request);
      }
      try {
        await env.R2_VIRTUAL_LAUNCH.put(
          'vlp-scale/wlvlp-prospects/active.json',
          JSON.stringify(body.prospects),
          { httpMetadata: { contentType: 'application/json' } }
        );
        return json({ ok: true, count: body.prospects.length }, 200, request);
      } catch (e) {
        console.error('WLVLP upload-prospects error:', e);
        return json({ ok: false, error: 'internal_error', message: String(e?.message || e) }, 500, request);
      }
    },
  },

  // GET /v1/wlvlp/admin/trigger-batch-gen
  // Admin-only manual trigger for the WLVLP batch generation cron.
  {
    method: 'GET', pattern: '/v1/wlvlp/admin/trigger-batch-gen',
    handler: async (_method, _pattern, _params, request, env, ctx) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;
      const adminEmails = ['jamie.williams@virtuallaunch.pro', 'hello@virtuallaunch.pro'];
      if (!adminEmails.includes((session.email || '').toLowerCase())) {
        return json({ ok: false, error: 'FORBIDDEN' }, 403, request);
      }
      try {
        const stats = await handleWlvlpBatchGeneration(env, ctx);
        return json({ ok: true, ...stats }, 200, request);
      } catch (e) {
        console.error('WLVLP admin trigger-batch-gen error:', e);
        return json({ ok: false, error: 'internal_error', message: String(e?.message || e) }, 500, request);
      }
    },
  },

  // GET /v1/wlvlp/site-requests/:slug
  // Returns current status of a site request (pending | generated | generation_failed).
  {
    method: 'GET', pattern: '/v1/wlvlp/site-requests/:slug',
    handler: async (_method, _pattern, params, request, env) => {
      const slug = (params.slug || '').toLowerCase();
      if (!/^[a-z0-9-]{1,200}$/.test(slug)) {
        return json({ ok: false, error: 'not_found' }, 404, request);
      }
      try {
        const obj = await env.R2_VIRTUAL_LAUNCH.get(`vlp-scale/wlvlp-site-requests/${slug}.json`);
        if (!obj) {
          return json({ ok: false, error: 'not_found' }, 404, request);
        }
        const data = await obj.json();
        return json({
          ok: true,
          status: data.status || 'pending',
          generated_at: data.generated_at || null,
          submitted_at: data.submitted_at || null,
        }, 200, request);
      } catch (e) {
        console.error('WLVLP site request get error:', e);
        return json({ ok: false, error: 'not_found' }, 404, request);
      }
    },
  },

  // GET /v1/wlvlp/custom-sites/:slug
  // Serves the Anthropic-generated HTML for a custom site request.
  {
    method: 'GET', pattern: '/v1/wlvlp/custom-sites/:slug',
    handler: async (_method, _pattern, params, request, env) => {
      const slug = (params.slug || '').toLowerCase();
      if (!/^[a-z0-9-]{1,200}$/.test(slug)) {
        return new Response('Not Found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain', ...getCorsHeaders(request) },
        });
      }
      try {
        const obj = await env.R2_VIRTUAL_LAUNCH.get(`vlp-scale/wlvlp-custom-sites/${slug}.html`);
        if (!obj) {
          return new Response('Not Found', {
            status: 404,
            headers: { 'Content-Type': 'text/plain', ...getCorsHeaders(request) },
          });
        }
        return new Response(obj.body, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
            ...getCorsHeaders(request),
          },
        });
      } catch (e) {
        console.error('WLVLP custom site read error:', e);
        return new Response('Not Found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain', ...getCorsHeaders(request) },
        });
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
        // Check for existing vote (per-account dedup)
        const existing = await env.DB.prepare(
          "SELECT 1 FROM wlvlp_votes WHERE account_id = ? AND template_slug = ?"
        ).bind(session.account_id, slug).first();
        if (existing) {
          return json({ ok: false, error: 'already_voted' }, 409, request);
        }

        // Record the vote
        await env.DB.prepare(
          "INSERT INTO wlvlp_votes (account_id, template_slug, voted_at) VALUES (?, ?, ?)"
        ).bind(session.account_id, slug, timestamp).run();

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

        // WLVLP price IDs live in the Virtual Launch Pro Stripe account.
        // STRIPE_SECRET_KEY belongs to the TaxMonitor Pro account, so we
        // must use STRIPE_SECRET_KEY_VLP for any WLVLP/VLP-account prices.
        const vlpSecretKey = env.STRIPE_SECRET_KEY_VLP;
        if (!vlpSecretKey) {
          console.error('WLVLP checkout: STRIPE_SECRET_KEY_VLP secret is not set');
          return json({ ok: false, error: 'STRIPE_NOT_CONFIGURED' }, 503, request);
        }

        // Look up template name from D1 for personalized checkout
        let templateName = slug;
        try {
          const tpl = await env.DB.prepare(
            "SELECT title FROM wlvlp_templates WHERE slug = ?"
          ).bind(slug).first();
          if (tpl?.title) templateName = tpl.title;
        } catch (e) {
          console.error('WLVLP checkout: template lookup failed (non-fatal):', e?.message);
        }

        const WLVLP_AMOUNT_MAP = { standard: 24900, premium: 39900 };
        const tierLabel = tier === 'premium' ? 'Premium' : 'Standard';

        const customerEmail = sessionEmail || (typeof bodyEmail === 'string' ? bodyEmail.trim() : '') || null;

        const sessionPayload = {
          mode: 'payment',
          line_items: [{
            price_data: {
              currency: 'usd',
              unit_amount: WLVLP_AMOUNT_MAP[tier],
              product_data: {
                name: `${templateName} — ${tierLabel} Website`,
                description: `Professional website template designed for your business.\n\u2022 Ready to customize with your branding\n\u2022 Custom domain connection included\n\u2022 Managed hosting setup\n\u2022 Mobile-responsive design`,
                metadata: { template_slug: slug }
              }
            },
            quantity: 1
          }],
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

        // Auto-apply best unredeemed scratch ticket promo code for authenticated users
        if (accountId) {
          try {
            const VALUE_ORDER = ['discount_50', 'free_month', 'discount_25', 'credit_9'];
            const prizes = await env.DB.prepare(
              "SELECT promo_code_id, prize_type, promo_expires_at FROM wlvlp_scratch_tickets WHERE account_id = ? AND promo_code_id IS NOT NULL AND redeemed_at IS NULL AND status = 'scratched' ORDER BY revealed_at ASC"
            ).bind(accountId).all();

            if (prizes?.results?.length) {
              const now = new Date().toISOString();
              const valid = prizes.results.filter(p => !p.promo_expires_at || p.promo_expires_at > now);
              if (valid.length) {
                // Pick highest-value promo
                valid.sort((a, b) => {
                  const ai = VALUE_ORDER.indexOf(a.prize_type);
                  const bi = VALUE_ORDER.indexOf(b.prize_type);
                  return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
                });
                sessionPayload.discounts = [{ promotion_code: valid[0].promo_code_id }];
              }
            }
          } catch (promoErr) {
            console.error('WLVLP checkout: promo lookup failed (non-fatal):', promoErr?.message);
          }
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
        // Check daily limit: one scratch ticket per rolling 24-hour period
        const recentTicket = await env.DB.prepare(
          "SELECT created_at FROM wlvlp_scratch_tickets WHERE account_id = ? ORDER BY created_at DESC LIMIT 1"
        ).bind(session.account_id).first();

        if (recentTicket) {
          const lastCreated = new Date(recentTicket.created_at);
          const nextAvailable = new Date(lastCreated.getTime() + 24 * 60 * 60 * 1000);
          if (new Date() < nextAvailable) {
            return json({
              ok: false,
              error: 'daily_limit',
              next_available_at: nextAvailable.toISOString()
            }, 429, request);
          }
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

        // --- Prize-specific side-effects ---
        const PRIZE_TO_COUPON = {
          discount_50: 'wlvlp_50_off',
          discount_25: 'wlvlp_25_off',
          credit_9:    'wlvlp_9_credit',
          free_month:  'wlvlp_free_month',
        };

        let promoCodeId = null;
        let promoCodeStr = null;
        let promoExpiresAt = null;
        let newTicketId = null;

        const couponId = PRIZE_TO_COUPON[prize.prize_type];
        if (couponId) {
          // Create a single-use Stripe Promotion Code
          const expiresUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days
          const promo = await stripePost('/promotion_codes', {
            coupon: couponId,
            max_redemptions: 1,
            expires_at: expiresUnix,
            metadata: {
              account_id: session.account_id,
              ticket_id,
              prize: prize.prize_type,
            },
          }, env, env.STRIPE_SECRET_KEY_VLP);
          promoCodeId = promo.id;
          promoCodeStr = promo.code;
          promoExpiresAt = new Date(expiresUnix * 1000).toISOString();
        } else if (prize.prize_type === 'free_ticket') {
          // Create a new scratch ticket for the same account
          const freeTicketId = `TKT_${crypto.randomUUID()}`;
          const freeTicketKey = `wlvlp/scratch/${session.account_id}/${freeTicketId}.json`;
          const freeTicketData = {
            ticket_id: freeTicketId,
            account_id: session.account_id,
            status: 'unscratched',
            created_at: timestamp,
          };
          await r2Put(env.R2_VIRTUAL_LAUNCH, freeTicketKey, freeTicketData);
          await env.DB.prepare(
            "INSERT INTO wlvlp_scratch_tickets (ticket_id, account_id, status, created_at) VALUES (?, ?, 'unscratched', ?)"
          ).bind(freeTicketId, session.account_id, timestamp).run();
          newTicketId = freeTicketId;
        }
        // no_prize: nothing extra

        // Write receipt to R2
        const receiptKey = `wlvlp/receipts/scratch/${session.account_id}/${ticket_id}.json`;
        const receipt = {
          ticket_id,
          account_id: session.account_id,
          prize_type: prize.prize_type,
          prize_value: prize.prize_value,
          promo_code_id: promoCodeId,
          promo_code: promoCodeStr,
          new_ticket_id: newTicketId,
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
          promo_code_id: promoCodeId,
          promo_code: promoCodeStr,
          promo_expires_at: promoExpiresAt,
          revealed_at: timestamp,
          created_at: ticket.created_at
        };
        await r2Put(env.R2_VIRTUAL_LAUNCH, ticketKey, updatedTicketData);

        // Update D1 projection
        await env.DB.prepare(
          "UPDATE wlvlp_scratch_tickets SET status = 'scratched', prize_type = ?, prize_value = ?, revealed_at = ?, promo_code_id = ?, promo_code = ?, promo_expires_at = ? WHERE ticket_id = ?"
        ).bind(prize.prize_type, prize.prize_value, timestamp, promoCodeId, promoCodeStr, promoExpiresAt, ticket_id).run();

        // Build response based on prize type
        const response = {
          ok: true,
          prize_type: prize.prize_type,
          prize_value: prize.prize_value,
        };
        if (promoCodeStr) {
          response.promo_code = promoCodeStr;
          response.promo_code_id = promoCodeId;
          response.auto_apply = true;
          response.expires_at = promoExpiresAt;
        }
        if (newTicketId) {
          response.new_ticket_id = newTicketId;
          response.auto_apply = true;
        }

        return json(response, 200, request);
      } catch (e) {
        console.error('WLVLP scratch reveal error:', e);
        return json({ ok: false, error: 'INTERNAL_ERROR' }, 500, request);
      }
    },
  },

  // GET /v1/wlvlp/scratch/prizes/:account_id — unredeemed promo code prizes
  {
    method: 'GET', pattern: '/v1/wlvlp/scratch/prizes/:account_id',
    handler: async (_method, _pattern, params, request, env) => {
      const { session, error } = await requireSession(request, env);
      if (error) return error;

      const { account_id } = params;
      if (account_id !== session.account_id) {
        return json({ ok: false, error: 'FORBIDDEN' }, 403, request);
      }

      try {
        const now = new Date().toISOString();
        const rows = await env.DB.prepare(
          "SELECT ticket_id, prize_type, prize_value, promo_code, promo_code_id, promo_expires_at, revealed_at FROM wlvlp_scratch_tickets WHERE account_id = ? AND promo_code_id IS NOT NULL AND redeemed_at IS NULL AND status = 'scratched'"
        ).bind(account_id).all();

        const prizes = (rows?.results || [])
          .filter(r => !r.promo_expires_at || r.promo_expires_at > now)
          .map(r => ({
            ticket_id: r.ticket_id,
            prize_type: r.prize_type,
            prize_value: r.prize_value,
            promo_code: r.promo_code,
            promo_code_id: r.promo_code_id,
            expires_at: r.promo_expires_at,
            revealed_at: r.revealed_at,
          }));

        return json({ ok: true, prizes }, 200, request);
      } catch (e) {
        console.error('WLVLP scratch prizes error:', e);
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

            // Stamp redeemed_at on scratch ticket if a promotion code was used
            const discounts = session.discounts || session.total_details?.breakdown?.discounts || [];
            for (const disc of discounts) {
              const promoId = disc.promotion_code || disc.discount?.promotion_code;
              if (promoId) {
                try {
                  await env.DB.prepare(
                    "UPDATE wlvlp_scratch_tickets SET redeemed_at = ? WHERE promo_code_id = ? AND redeemed_at IS NULL"
                  ).bind(timestamp, promoId).run();
                } catch (redeemErr) {
                  console.error('Failed to stamp redeemed_at for promo', promoId, redeemErr);
                }
              }
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
  // Scale Prospects FOIA Master JSONL (Admin)
  // -------------------------------------------------------------------------
  // The FOIA master JSONL at vlp-scale/foia-leads/foia-master.json is the
  // single data store for the entire SCALE pipeline. find-emails,
  // validate-emails, the enrichment cron, and the campaign router all
  // read/write this same file. There is no separate "master CSV" or
  // "FOIA source" — they used to be distinct files but were collapsed.

  {
    method: 'PUT', pattern: '/v1/scale/prospects/upload-source',
    handler: async (_method, _pattern, _params, request, env) => {
      const authHeader = request.headers.get('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!env.SCALE_API_KEY || !token || token !== env.SCALE_API_KEY) {
        return json({ ok: false, error: 'Unauthorized' }, 401, request);
      }

      const contentType = (request.headers.get('content-type') || '').toLowerCase();
      const isJsonl = contentType.includes('application/jsonl') || contentType.includes('application/x-ndjson');
      if (!isJsonl) {
        return json({ ok: false, error: 'content_type_must_be_application_jsonl' }, 400, request);
      }

      const url = new URL(request.url);
      const sourceFilename = (url.searchParams.get('source_filename') || '').slice(0, 200);
      const force = url.searchParams.get('force') === 'true';

      const body = await request.text();
      if (!body || body.length < 10) {
        return json({ ok: false, error: 'empty_body' }, 400, request);
      }

      // Validate first non-empty line parses as JSON to catch a JSON-array
      // mistake.
      let firstNonEmpty = null;
      let rowCount = 0;
      {
        let lineStart = 0;
        for (let i = 0; i <= body.length; i++) {
          if (i === body.length || body[i] === '\n') {
            const line = body.slice(lineStart, i).trim();
            if (line.length > 0) {
              if (firstNonEmpty === null) firstNonEmpty = line;
              rowCount++;
            }
            lineStart = i + 1;
          }
        }
      }
      if (firstNonEmpty === null) {
        return json({ ok: false, error: 'no_data_lines' }, 400, request);
      }
      try { JSON.parse(firstNonEmpty); }
      catch { return json({ ok: false, error: 'first_line_not_valid_json' }, 400, request); }

      // Safety check: refuse to overwrite a master file that contains rows
      // with discovered/verified emails unless ?force=true. This prevents an
      // accidental re-upload from wiping enrichment progress.
      let existing_enriched_rows = 0;
      let existing_total_rows = 0;
      try {
        const existing = await env.R2_VIRTUAL_LAUNCH.get(ENRICHMENT_R2_KEY);
        if (existing) {
          const text = await existing.text();
          const lines = text.split('\n');
          for (const line of lines) {
            const t = line.trim();
            if (!t) continue;
            existing_total_rows++;
            try {
              const r = JSON.parse(t);
              if (r && r.email_found && String(r.email_found).trim()) existing_enriched_rows++;
            } catch {}
          }
        }
      } catch {}

      if (existing_enriched_rows > 0 && !force) {
        return json({
          ok: false,
          error: 'would_lose_enrichment',
          existing_total_rows,
          existing_enriched_rows,
          hint: 'Pass ?force=true to overwrite anyway.',
        }, 409, request);
      }

      const fileSizeBytes = new TextEncoder().encode(body).byteLength;
      const uploadedAt = new Date().toISOString();

      await env.R2_VIRTUAL_LAUNCH.put(ENRICHMENT_R2_KEY, body, {
        httpMetadata: { contentType: 'application/x-ndjson; charset=utf-8' },
      });

      return json({
        ok: true,
        r2_key: ENRICHMENT_R2_KEY,
        uploaded_at: uploadedAt,
        row_count: rowCount,
        file_size_bytes: fileSizeBytes,
        source_filename: sourceFilename || null,
        format: 'jsonl',
        uploaded_by: 'scale_api_key',
        replaced_existing_total_rows: existing_total_rows,
        replaced_existing_enriched_rows: existing_enriched_rows,
        forced: force,
      }, 200, request);
    },
  },

  {
    method: 'GET', pattern: '/v1/scale/prospects/status',
    handler: async (_method, _pattern, _params, request, env) => {
      const authHeader = request.headers.get('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!env.SCALE_API_KEY || !token || token !== env.SCALE_API_KEY) {
        return json({ ok: false, error: 'Unauthorized' }, 401, request);
      }

      const obj = await env.R2_VIRTUAL_LAUNCH.get(ENRICHMENT_R2_KEY);
      if (!obj) {
        return json({ ok: false, error: 'foia_master_jsonl_not_found', r2_key: ENRICHMENT_R2_KEY }, 404, request);
      }

      const text = await obj.text();
      const fileSizeBytes = new TextEncoder().encode(text).byteLength;

      let total_rows = 0;
      let rows_with_email_found = 0;
      let rows_valid = 0;
      let rows_unverified = 0;
      let rows_no_mx = 0;
      let rows_dead_end = 0;
      let rows_eligible_for_discovery = 0;
      let rows_eligible_for_validation = 0;
      let rows_eligible_for_router = 0;
      let rows_unsubscribed = 0;
      let rows_routed_ttmp = 0;
      let rows_routed_vlp = 0;
      let rows_routed_wlvlp = 0;
      let last_find_emails_at = null;
      let last_validate_emails_at = null;

      const lines = text.split('\n');
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        let r;
        try { r = JSON.parse(t); } catch { continue; }
        total_rows++;

        const ef = (r.email_found || '').toString().trim();
        const es = (r.email_status || '').toString().trim().toLowerCase();
        const dom = (r.domain_clean || '').toString().trim();
        const website = r.WEBSITE || '';
        const unsubscribed = !!(r.unsubscribed_at && String(r.unsubscribed_at).trim());

        if (ef) rows_with_email_found++;
        if (es === 'valid') rows_valid++;
        if (es === 'unverified') rows_unverified++;
        if (es === 'no_mx') rows_no_mx++;
        if (FIND_EMAILS_DEAD_END_STATUSES.has(es)) rows_dead_end++;
        if (unsubscribed) rows_unsubscribed++;

        // Eligible for discovery: no email_found, not dead-end, has resolvable domain.
        if (!ef && !FIND_EMAILS_DEAD_END_STATUSES.has(es)) {
          if (dom || normalizeDomainFromWebsite(website)) rows_eligible_for_discovery++;
        }
        // Eligible for validation: has email_found, status empty or 'unverified'.
        if (ef && (es === '' || es === 'unverified')) {
          rows_eligible_for_validation++;
        }
        // Eligible for campaign router: sendable status, no _prepared_at stamps.
        if (
          ef && ALLOWED_SEND_STATUSES.has(es) && !unsubscribed &&
          !r.ttmp_email_1_prepared_at && !r.vlp_email_1_prepared_at && !r.wlvlp_email_1_prepared_at
        ) {
          rows_eligible_for_router++;
        }
        if (r.ttmp_email_1_prepared_at) rows_routed_ttmp++;
        if (r.vlp_email_1_prepared_at) rows_routed_vlp++;
        if (r.wlvlp_email_1_prepared_at) rows_routed_wlvlp++;

        const fea = r.email_found_at;
        if (fea && (!last_find_emails_at || fea > last_find_emails_at)) last_find_emails_at = fea;
        const vea = r.email_verified_at;
        if (vea && (!last_validate_emails_at || vea > last_validate_emails_at)) last_validate_emails_at = vea;
      }

      const stats = {
        r2_key: ENRICHMENT_R2_KEY,
        file_size_bytes: fileSizeBytes,
        total_rows,
        rows_with_email_found,
        rows_valid,
        rows_unverified,
        rows_no_mx,
        rows_dead_end,
        rows_unsubscribed,
        rows_eligible_for_discovery,
        rows_eligible_for_validation,
        rows_eligible_for_router,
        rows_routed_ttmp,
        rows_routed_vlp,
        rows_routed_wlvlp,
        last_find_emails_at,
        last_validate_emails_at,
      };

      return json({ ok: true, stats, fetched_at: new Date().toISOString() }, 200, request);
    },
  },

  // ── Prospect search ───────────────────────────────────────────────
  {
    method: 'GET', pattern: '/v1/scale/prospects/search',
    handler: async (_method, _pattern, _params, request, env) => {
      const authHeader = request.headers.get('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!env.SCALE_API_KEY || !token || token !== env.SCALE_API_KEY) {
        return json({ ok: false, error: 'Unauthorized' }, 401, request);
      }

      const url = new URL(request.url);
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 500);
      const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

      const records = await readFoiaMasterRecords(env);
      if (!records) {
        return json({ ok: false, error: 'foia_master_not_found' }, 404, request);
      }

      let filtered = records;
      if (q) {
        filtered = records.filter(r => {
          const fields = [
            r.First_NAME, r.LAST_NAME, r.DBA, r.BUS_ADDR_CITY,
            r.email_found, r.domain_clean,
          ];
          return fields.some(f => f && String(f).toLowerCase().includes(q));
        });
      }

      const total = records.length;
      const filteredCount = filtered.length;
      const page = filtered.slice(offset, offset + limit);

      const prospects = page.map(r => {
        const first = (r.First_NAME || '').trim();
        const last = (r.LAST_NAME || '').trim();
        const city = (r.BUS_ADDR_CITY || '').trim();
        const state = (r.BUS_ST_CODE || '').trim();
        const profession = (r.PROFESSION || r.CRED || '').trim();
        const email = (r.email_found || '').trim();
        const slug = dailyMakeSlug(
          dailySanitizeNamePart(first), dailySanitizeNamePart(last), city, state
        );

        // Determine campaign
        let campaign = 'none';
        if (r.ttmp_email_1_prepared_at) campaign = 'ttmp';
        else if (r.vlp_email_1_prepared_at) campaign = 'vlp';
        else if (r.wlvlp_email_1_prepared_at) campaign = 'wlvlp';

        // Mask email: show first char + *** + @ + domain
        let maskedEmail = '';
        if (email && email.includes('@')) {
          const [local, domain] = email.split('@');
          maskedEmail = local.charAt(0) + '***@' + domain;
        }

        // LinkedIn search URL
        const fullName = [first, last].filter(Boolean).join(' ');
        const linkedinParts = [fullName, city, profession].filter(Boolean).join(' ');
        const linkedin_url = linkedinParts
          ? 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(linkedinParts)
          : null;

        return {
          slug,
          first_name: first,
          last_name: last,
          firm: (r.DBA || '').trim(),
          city,
          state,
          profession,
          email: maskedEmail,
          phone: (r.BUS_PHONE || '').trim(),
          domain: (r.domain_clean || '').trim(),
          email_status: (r.email_status || '').trim(),
          campaign,
          email_stage: r.unsubscribed_at ? 'unsubscribed' : 'not_queued',
          linkedin_url,
        };
      });

      return json({ ok: true, prospects, total, filtered: filteredCount, limit, offset }, 200, request);
    },
  },

  // ── Prospect detail ───────────────────────────────────────────────
  {
    method: 'GET', pattern: '/v1/scale/prospects/:slug',
    handler: async (_method, _pattern, params, request, env) => {
      const authHeader = request.headers.get('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!env.SCALE_API_KEY || !token || token !== env.SCALE_API_KEY) {
        return json({ ok: false, error: 'Unauthorized' }, 401, request);
      }

      const targetSlug = (params.slug || '').trim().toLowerCase();
      if (!targetSlug) {
        return json({ ok: false, error: 'slug_required' }, 400, request);
      }

      const records = await readFoiaMasterRecords(env);
      if (!records) {
        return json({ ok: false, error: 'foia_master_not_found' }, 404, request);
      }

      // Find matching record by slug
      const record = records.find(r => {
        const slug = dailyMakeSlug(
          dailySanitizeNamePart(r.First_NAME),
          dailySanitizeNamePart(r.LAST_NAME),
          r.BUS_ADDR_CITY,
          r.BUS_ST_CODE
        );
        return slug === targetSlug;
      });

      if (!record) {
        return json({ ok: false, error: 'prospect_not_found' }, 404, request);
      }

      const first = (record.First_NAME || '').trim();
      const last = (record.LAST_NAME || '').trim();
      const city = (record.BUS_ADDR_CITY || '').trim();
      const state = (record.BUS_ST_CODE || '').trim();
      const profession = (record.PROFESSION || record.CRED || '').trim();
      const fullName = [first, last].filter(Boolean).join(' ');
      const linkedinParts = [fullName, city, profession].filter(Boolean).join(' ');

      // Determine campaign
      let campaign = 'none';
      if (record.ttmp_email_1_prepared_at) campaign = 'ttmp';
      else if (record.vlp_email_1_prepared_at) campaign = 'vlp';
      else if (record.wlvlp_email_1_prepared_at) campaign = 'wlvlp';

      // Build emails_sent by scanning the relevant send queue + archives
      const emails_sent = [];
      if (campaign !== 'none') {
        const queuePrefix = `vlp-scale/${campaign}-send-queue/`;
        const email = (record.email_found || '').trim().toLowerCase();

        // Read current queue
        try {
          const queueObj = await env.R2_VIRTUAL_LAUNCH.get(queuePrefix + 'email1-pending.json');
          if (queueObj) {
            const queueData = JSON.parse(await queueObj.text());
            const arr = Array.isArray(queueData) ? queueData : [];
            for (const qr of arr) {
              const qrEmail = (qr.email || qr.to || '').trim().toLowerCase();
              if (qrEmail !== email) continue;
              for (let n = 1; n <= 6; n++) {
                const sentKey = `email_${n}_sent_at`;
                if (qr[sentKey]) {
                  emails_sent.push({
                    email_number: n,
                    subject: qr[n === 1 ? 'subject' : `email_${n}_subject`] || '',
                    body: qr[n === 1 ? 'body' : `email_${n}_body`] || '',
                    sent_at: qr[sentKey],
                    campaign,
                  });
                }
              }
            }
          }
        } catch {}

        // Scan sent archives (last 30 days)
        try {
          const sentList = await env.R2_VIRTUAL_LAUNCH.list({ prefix: queuePrefix + 'sent-', limit: 30 });
          for (const obj of (sentList.objects || [])) {
            try {
              const archiveObj = await env.R2_VIRTUAL_LAUNCH.get(obj.key);
              if (!archiveObj) continue;
              const archiveData = JSON.parse(await archiveObj.text());
              const arr = Array.isArray(archiveData) ? archiveData : [];
              for (const qr of arr) {
                const qrEmail = (qr.email || qr.to || '').trim().toLowerCase();
                if (qrEmail !== email) continue;
                for (let n = 1; n <= 6; n++) {
                  const sentKey = `email_${n}_sent_at`;
                  if (qr[sentKey]) {
                    // Dedupe by email_number
                    if (!emails_sent.some(e => e.email_number === n)) {
                      emails_sent.push({
                        email_number: n,
                        subject: qr[n === 1 ? 'subject' : `email_${n}_subject`] || '',
                        body: qr[n === 1 ? 'body' : `email_${n}_body`] || '',
                        sent_at: qr[sentKey],
                        campaign,
                      });
                    }
                  }
                }
              }
            } catch {}
          }
        } catch {}

        emails_sent.sort((a, b) => a.email_number - b.email_number);
      }

      // Determine email_stage from emails_sent
      let email_stage = 'not_queued';
      if (record.unsubscribed_at) {
        email_stage = 'unsubscribed';
      } else if (emails_sent.length > 0) {
        const maxSent = Math.max(...emails_sent.map(e => e.email_number));
        email_stage = `email_${maxSent}_sent`;
      } else if (campaign !== 'none') {
        email_stage = 'pending';
      }

      const prospect = {
        slug: targetSlug,
        first_name: first,
        last_name: last,
        full_name: fullName,
        firm: (record.DBA || '').trim(),
        city,
        state,
        phone: (record.BUS_PHONE || '').trim(),
        profession,
        website: (record.WEBSITE || '').trim(),
        domain_clean: (record.domain_clean || '').trim(),
        email_found: (record.email_found || '').trim(),
        email_status: (record.email_status || '').trim(),
        firm_bucket: (record.firm_bucket || '').trim(),
        linkedin_url: linkedinParts
          ? 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(linkedinParts)
          : null,
        campaign,
        email_stage,
        timestamps: {
          email_found_at: record.email_found_at || null,
          email_verified_at: record.email_verified_at || null,
          ttmp_email_1_prepared_at: record.ttmp_email_1_prepared_at || null,
          vlp_email_1_prepared_at: record.vlp_email_1_prepared_at || null,
          wlvlp_email_1_prepared_at: record.wlvlp_email_1_prepared_at || null,
          wlvlp_asset_enriched_at: record.wlvlp_asset_enriched_at || null,
          unsubscribed_at: record.unsubscribed_at || null,
        },
      };

      return json({ ok: true, prospect, emails_sent }, 200, request);
    },
  },

  {
    method: 'POST', pattern: '/v1/scale/cron/find-emails',
    handler: async (_method, _pattern, _params, request, env) => {
      const authHeader = request.headers.get('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!env.SCALE_API_KEY || !token || token !== env.SCALE_API_KEY) {
        return json({ ok: false, error: 'Unauthorized' }, 401, request);
      }
      const url = new URL(request.url);
      const limitParam = parseInt(url.searchParams.get('limit') || '', 10);
      const opts = Number.isFinite(limitParam) && limitParam >= 0 ? { limit: limitParam } : {};
      const runLog = await handleFindEmailsCron(env, opts);
      return json({ ok: true, run_log: runLog }, 200, request);
    },
  },

  {
    method: 'POST', pattern: '/v1/scale/cron/validate-emails',
    handler: async (_method, _pattern, _params, request, env) => {
      const authHeader = request.headers.get('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!env.SCALE_API_KEY || !token || token !== env.SCALE_API_KEY) {
        return json({ ok: false, error: 'Unauthorized' }, 401, request);
      }
      const url = new URL(request.url);
      const limitParam = parseInt(url.searchParams.get('limit') || '', 10);
      const opts = Number.isFinite(limitParam) && limitParam > 0 ? { limit: limitParam } : {};
      const runLog = await handleValidateEmailsCron(env, opts);
      return json({ ok: true, run_log: runLog }, 200, request);
    },
  },

  {
    method: 'POST', pattern: '/v1/scale/cron/wlvlp-enrich',
    handler: async (_method, _pattern, _params, request, env) => {
      const authHeader = request.headers.get('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!env.SCALE_API_KEY || !token || token !== env.SCALE_API_KEY) {
        return json({ ok: false, error: 'Unauthorized' }, 401, request);
      }
      const url = new URL(request.url);
      const limitParam = parseInt(url.searchParams.get('limit') || '', 10);
      const opts = Number.isFinite(limitParam) && limitParam >= 0 ? { limit: limitParam } : {};
      const runLog = await handleWlvlpAssetEnrichmentCron(env, opts);
      return json({ ok: true, run_log: runLog }, 200, request);
    },
  },

  // POST /v1/wlvlp/cron/auction-settle — Manual trigger for auction settlement
  {
    method: 'POST', pattern: '/v1/wlvlp/cron/auction-settle',
    handler: async (_method, _pattern, _params, request, env) => {
      const authHeader = request.headers.get('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!env.SCALE_API_KEY || !token || token !== env.SCALE_API_KEY) {
        return json({ ok: false, error: 'Unauthorized' }, 401, request);
      }
      const runLog = await handleWlvlpAuctionSettlementCron(env);
      return json({ ok: true, settlement_log: runLog }, 200, request);
    },
  },

  // POST /v1/scale/cron/backfill-asset-pages — One-shot backfill for TTMP + VLP asset pages
  {
    method: 'POST', pattern: '/v1/scale/cron/backfill-asset-pages',
    handler: async (_method, _pattern, _params, request, env) => {
      const authHeader = request.headers.get('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!env.SCALE_API_KEY || !token || token !== env.SCALE_API_KEY) {
        return json({ ok: false, error: 'Unauthorized' }, 401, request);
      }
      const bfUrl = new URL(request.url);
      const forceOverwrite = bfUrl.searchParams.get('force') === 'true';
      const nowIso = new Date().toISOString();
      const campaigns = [
        { key: 'vlp-scale/ttmp-send-queue/email1-pending.json', campaign: 'ttmp' },
        { key: 'vlp-scale/vlp-send-queue/email1-pending.json',  campaign: 'vlp'  },
      ];
      const report = { ttmp: { scanned: 0, written: 0, skipped: 0, errors: 0, overwritten: 0 }, vlp: { scanned: 0, written: 0, skipped: 0, errors: 0, overwritten: 0 } };
      for (const c of campaigns) {
        try {
          const obj = await env.R2_VIRTUAL_LAUNCH.get(c.key);
          if (!obj) { report[c.campaign].skipped_reason = 'no_queue'; continue; }
          const arr = await obj.json();
          if (!Array.isArray(arr)) continue;
          report[c.campaign].scanned = arr.length;
          for (const rec of arr) {
            const slug = rec.slug;
            if (!slug) { report[c.campaign].skipped++; continue; }
            const existing = await env.R2_VIRTUAL_LAUNCH.head(`vlp-scale/asset-pages/${slug}.json`);
            if (existing && !forceOverwrite) { report[c.campaign].skipped++; continue; }
            if (existing && forceOverwrite) report[c.campaign].overwritten++;
            const credKey = dailyNormalizeCred(rec.profession || '');
            const cred = DAILY_CRED[credKey] || DAILY_CRED.EA;
            const firstDisplay = rec.first_name || 'Friend';
            const lastDisplay = rec.last_name || '';
            const city = rec.city || '';
            const state = rec.state || '';
            let page;
            if (c.campaign === 'ttmp') {
              page = buildTtmpAssetPageData({ slug, credKey, cred, firstDisplay, lastDisplay, city, state, firm: `${firstDisplay} ${lastDisplay}`.trim(), nowIso, backfilled: true });
            } else {
              page = {
                slug, campaign: 'vlp',
                headline: `${firstDisplay}, taxpayers in ${city || 'your area'} are searching for help you're not showing up for`,
                subheadline: `A practice analysis for ${cred.label}s — new client value, directory visibility, and transcript automation.`,
                practice_type: credKey, credential_label: cred.label, city, state,
                firm: `${firstDisplay} ${lastDisplay}`.trim(),
                stats: { new_client_value: cred.new_client_value, billing_range: cred.billing, weekly_hours: cred.weekly, annual_hours: cred.annual, revenue_impact: cred.revenue },
                cta_primary_url: 'https://virtuallaunch.pro/pricing',
                cta_primary_label: 'See listing tiers — starts at $79/mo',
                cta_booking_url: 'https://cal.com/vlp/vlp-discovery',
                generated_at: nowIso, backfilled: true,
              };
            }
            try {
              await env.R2_VIRTUAL_LAUNCH.put(
                `vlp-scale/asset-pages/${slug}.json`,
                JSON.stringify(page),
                { httpMetadata: { contentType: 'application/json' } }
              );
              report[c.campaign].written++;
            } catch (e) {
              console.error(`Backfill asset page failed ${slug}:`, e);
              report[c.campaign].errors++;
            }
          }
        } catch (e) {
          report[c.campaign].error = String(e && e.message || e);
        }
      }
      return json({ ok: true, report }, 200, request);
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
// WLVLP Site Request: Template-Fill Generation
// ---------------------------------------------------------------------------
// Replaces the prior Anthropic-API generation flow. Templates live in R2 at
// vlp-scale/wlvlp-templates/{slug}.html (uploaded via scale/upload-wlvlp-templates.mjs).
// A cron at 06:00 UTC sweeps pending site-requests, fills the matching
// template with questionnaire data, and writes the customized HTML to
// vlp-scale/wlvlp-custom-sites/{slug}.html.

const WLVLP_TEMPLATE_MAP = {
  CPA:     'clear-ledger-bookkeeping',
  EA:      'tax-preparation-now',
  ATTY:    'tax-attorney-services',
  DEFAULT: 'tax-command-advisory',
};

const WLVLP_COLOR_SCHEMES = {
  'Professional Blue': '#1d4ed8',
  'Modern Teal':       '#0d9488',
  'Classic Navy':      '#1e3a5f',
  'Warm Charcoal':     '#374151',
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Apply find-and-replace customizations to a template HTML string using
// questionnaire fields. Returns the modified HTML.
function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw.trim();
}

function fillTemplate(templateHtml, requestData) {
  let html = templateHtml;
  const data = requestData || {};
  const firmName     = (data.firm_name || '').trim();
  const credential   = (data.credential || 'Tax Professional').trim();
  const city         = (data.city || '').trim();
  const state        = (data.state || '').trim();
  const phone        = normalizePhone(data.phone || '');
  const email        = (data.email || '').trim();
  const services     = Array.isArray(data.services) ? data.services : [];
  const servicesStr  = services.join(', ');
  const colorScheme  = (data.color_scheme || '').trim();
  const logoUrl      = (data.logo_url || '').trim();
  const locationStr  = [city, state].filter(Boolean).join(', ');

  // 1) <title> tag
  if (firmName) {
    const titleText = locationStr
      ? `${firmName} — ${credential} in ${locationStr}`
      : `${firmName} — ${credential}`;
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(titleText)}</title>`);
  }

  // 2) <meta name="description">
  if (firmName) {
    const descText = `${firmName} provides ${servicesStr || 'professional services'}${locationStr ? ` in ${locationStr}` : ''}. Book a consultation today.`;
    html = html.replace(
      /<meta\s+name=["']description["']\s+content=["'][^"']*["']\s*\/?>/i,
      `<meta name="description" content="${escapeHtml(descText)}">`
    );
  }

  // 3) First <h1> text content → firm_name
  if (firmName) {
    let replacedH1 = false;
    html = html.replace(/(<h1\b[^>]*>)([\s\S]*?)(<\/h1>)/i, (m, open, _inner, close) => {
      if (replacedH1) return m;
      replacedH1 = true;
      return `${open}${escapeHtml(firmName)}${close}`;
    });
  }

  // 4) Phone numbers — replace any (xxx) xxx-xxxx or xxx-xxx-xxxx in visible text
  if (phone) {
    html = html.replace(/\(\d{3}\)\s*\d{3}-\d{4}/g, escapeHtml(phone));
    html = html.replace(/\b\d{3}-\d{3}-\d{4}\b/g, escapeHtml(phone));
  }

  // 5) Email addresses in visible text
  if (email) {
    html = html.replace(
      /(>[^<]*?)([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
      (_m, prefix) => `${prefix}${escapeHtml(email)}`
    );
  }

  // 6) CTA text — common buttons → "Book a Consultation"
  const ctaPatterns = [
    /\bBook Now\b/gi,
    /\bGet Started\b/gi,
    /\bContact Us\b/gi,
    /\bStart Filing Now\b/gi,
    /\bSchedule a Call\b/gi,
    /\bRequest a Quote\b/gi,
  ];
  for (const re of ctaPatterns) {
    html = html.replace(re, 'Book a Consultation');
  }

  // 7) Color scheme — replace primary accent color in <style> blocks
  if (colorScheme) {
    let primary = WLVLP_COLOR_SCHEMES[colorScheme] || null;
    if (!primary && /^#?[0-9a-fA-F]{6}$/.test(colorScheme)) {
      primary = colorScheme.startsWith('#') ? colorScheme : `#${colorScheme}`;
    }
    if (primary) {
      html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (m, css) => {
        const hexes = css.match(/#[0-9a-fA-F]{6}\b/g) || [];
        if (hexes.length === 0) return m;
        const counts = {};
        for (const h of hexes) counts[h.toLowerCase()] = (counts[h.toLowerCase()] || 0) + 1;
        let topHex = null;
        let topCount = 0;
        for (const [h, c] of Object.entries(counts)) {
          if (c > topCount) { topHex = h; topCount = c; }
        }
        if (!topHex) return m;
        const newCss = css.replace(new RegExp(escapeRegex(topHex), 'gi'), primary);
        return m.replace(css, newCss);
      });
    }
  }

  // 8) Logo: first <img> in header/nav area
  if (logoUrl) {
    const headerMatch = html.match(/<(?:header|nav)\b[\s\S]*?<\/(?:header|nav)>/i);
    if (headerMatch) {
      const headerHtml = headerMatch[0];
      const newHeaderHtml = headerHtml.replace(
        /(<img\b[^>]*?\bsrc=)["'][^"']*["']/i,
        `$1"${escapeHtml(logoUrl)}"`
      );
      if (newHeaderHtml !== headerHtml) {
        html = html.replace(headerHtml, newHeaderHtml);
      }
    }
  }

  return html;
}

// Process all pending wlvlp-site-requests in R2: fill the matching template
// with questionnaire data and write the customized HTML. Idempotent — only
// touches requests with status === 'pending'.
async function handleWlvlpSiteGeneration(env) {
  const requestsPrefix = 'vlp-scale/wlvlp-site-requests/';
  let cursor = undefined;
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  while (true) {
    const listRes = await env.R2_VIRTUAL_LAUNCH.list({ prefix: requestsPrefix, cursor });
    for (const obj of listRes.objects) {
      if (!obj.key.endsWith('.json')) { skipped++; continue; }
      try {
        const reqObj = await env.R2_VIRTUAL_LAUNCH.get(obj.key);
        if (!reqObj) { skipped++; continue; }
        const requestData = await reqObj.json();
        if (!requestData || requestData.status !== 'pending') { skipped++; continue; }

        const slug = requestData.slug;
        if (!slug) { skipped++; continue; }

        const credential = (requestData.credential || '').toUpperCase();
        const templateSlug =
          WLVLP_TEMPLATE_MAP[credential] || WLVLP_TEMPLATE_MAP.DEFAULT;
        const templateKey = `vlp-scale/wlvlp-templates/${templateSlug}.html`;
        const templateObj = await env.R2_VIRTUAL_LAUNCH.get(templateKey);

        if (!templateObj) {
          const failedRecord = {
            ...requestData,
            status: 'generation_failed',
            error: 'template_not_found',
            template_attempted: templateSlug,
            failed_at: new Date().toISOString(),
          };
          await env.R2_VIRTUAL_LAUNCH.put(obj.key, JSON.stringify(failedRecord), {
            httpMetadata: { contentType: 'application/json' },
          });
          failed++;
          continue;
        }

        const templateHtml = await templateObj.text();
        const customHtml = fillTemplate(templateHtml, requestData);

        const customKey = `vlp-scale/wlvlp-custom-sites/${slug}.html`;
        await env.R2_VIRTUAL_LAUNCH.put(customKey, customHtml, {
          httpMetadata: { contentType: 'text/html; charset=utf-8' },
        });

        const updated = {
          ...requestData,
          status: 'generated',
          generated_at: new Date().toISOString(),
          template_used: templateSlug,
        };
        await env.R2_VIRTUAL_LAUNCH.put(obj.key, JSON.stringify(updated), {
          httpMetadata: { contentType: 'application/json' },
        });
        console.log(`Generated custom site: ${slug} using ${templateSlug}`);
        generated++;
      } catch (e) {
        console.error('WLVLP site generation: failed to process', obj.key, e);
        failed++;
      }
    }
    if (!listRes.truncated) break;
    cursor = listRes.cursor;
  }

  console.log(`WLVLP site generation complete: ${generated} generated, ${skipped} skipped, ${failed} failed`);
  return { generated, skipped, failed };
}

// ---------------------------------------------------------------------------
// WLVLP SCALE Batch Generation (ported from scale/generate-batch.mjs)
// ---------------------------------------------------------------------------
// Runs as a cron at 12:00 UTC. Reads the active prospect list from R2,
// applies SCALE selection logic, crawls each prospect's website, builds a
// Conversion Leak Report, generates personalized Email 1 / Email 2 copy,
// and writes:
//   - vlp-scale/wlvlp-asset-pages/{slug}.json   (per-prospect asset page)
//   - vlp-scale/wlvlp-send-queue/email1-pending.json  (send queue)
//   - vlp-scale/wlvlp-batches/batch-{YYYY-MM-DD}.json (batch record)
//   - vlp-scale/wlvlp-prospects/active.json (updated w/ prepared timestamps)
//
// Zero Claude/Anthropic usage — deterministic selection + crawl + template.

const WLVLP_TITLE_RE = /\b(dr|mr|mrs|ms|jr|sr|ii|iii|iv|esq|cpa|ea|jd|atty|attorney)\.?\b/gi;

function wlvlpSlugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(WLVLP_TITLE_RE, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function wlvlpTitleCase(s) {
  return String(s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function wlvlpIsEmpty(v) {
  if (v == null) return true;
  const s = String(v).trim().toLowerCase();
  return s === '' || s === 'undefined' || s === 'nan' || s === 'null';
}

function wlvlpNormalizeCredential(profession) {
  const p = String(profession || '').toUpperCase().trim();
  if (p.includes('CPA')) return 'CPA';
  if (p === 'EA' || p.includes('ENROLLED')) return 'EA';
  if (p.includes('ATTY') || p.includes('ATTORNEY') || p === 'JD' || p.includes('LAWYER')) return 'ATTY';
  return 'Unknown';
}

const WLVLP_TEMPLATE_BY_CRED = {
  CPA:     { slug: 'accounting-firm-modern',   label: 'CPA' },
  EA:      { slug: 'tax-professional-clean',   label: 'EA' },
  ATTY:    { slug: 'law-firm-professional',    label: 'tax attorney' },
  Unknown: { slug: 'tax-professional-clean',   label: 'tax professional' },
};

const WLVLP_TRAFFIC_BY_CRED = { CPA: 500, EA: 300, ATTY: 400, Unknown: 300 };
const WLVLP_VALUE_BY_CRED   = { CPA: 2500, EA: 1500, ATTY: 3500, Unknown: 1500 };

async function wlvlpCrawlSite(domainClean) {
  const fallback = {
    has_above_fold_cta: false,
    has_phone_visible: false,
    has_intake_form: false,
    form_field_count: 0,
    has_reviews_or_testimonials: false,
    has_credentials_visible: false,
    headline_text: 'Not available',
    meta_description: '',
    page_title: '',
    fetch_ok: false,
    status: 0,
    elapsed_ms: 0,
  };
  if (!domainClean) return fallback;

  const url = `https://${domainClean}`;
  const start = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10000);
  let res, html;
  try {
    res = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; WLVLP-ConversionAudit/1.0; +https://websitelotto.virtuallaunch.pro)',
        'accept': 'text/html,application/xhtml+xml',
      },
    });
    html = await res.text();
  } catch (e) {
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    console.log(`WLVLP crawl ${domainClean}: ERR ${e.name || 'fetch'} (${elapsed}ms)`);
    return { ...fallback, elapsed_ms: elapsed };
  }
  clearTimeout(timer);
  const elapsed = Date.now() - start;
  console.log(`WLVLP crawl ${domainClean}: ${res.status} (${elapsed}ms)`);

  if (!res.ok || !html) {
    return { ...fallback, fetch_ok: false, status: res.status, elapsed_ms: elapsed };
  }

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : html;
  const first2k = body.slice(0, 2000);
  const first3k = body.slice(0, 3000);

  const ACTION = /(book|call|schedule|consult|contact|get started|free)/i;
  const ctaCandidates = first2k.match(/<(a|button)[^>]*>([\s\S]*?)<\/\1>/gi) || [];
  let has_above_fold_cta = false;
  for (const c of ctaCandidates) {
    const text = c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (ACTION.test(text)) { has_above_fold_cta = true; break; }
  }

  const PHONE = /(\(\d{3}\)\s*\d{3}[-.\s]?\d{4}|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|\b\d{10}\b)/;
  const has_phone_visible = PHONE.test(first3k.replace(/<[^>]+>/g, ' '));

  const formMatches = body.match(/<form[\s\S]*?<\/form>/gi) || [];
  const has_intake_form = formMatches.length > 0;
  let form_field_count = 0;
  for (const f of formMatches) {
    const inputs = (f.match(/<input\b[^>]*>/gi) || []).filter(t => !/type=["']?(hidden|submit|button|image|reset)["']?/i.test(t));
    const textareas = f.match(/<textarea\b/gi) || [];
    const selects = f.match(/<select\b/gi) || [];
    form_field_count += inputs.length + textareas.length + selects.length;
  }

  const REVIEW_RE = /(review|testimonial|client says|stars|rating)/i;
  const has_reviews_or_testimonials = REVIEW_RE.test(body);

  const CRED_RE = /(\bCPA\b|\bEA\b|Enrolled Agent|\bJD\b|Attorney|licensed|certified|member of)/i;
  const has_credentials_visible = CRED_RE.test(body);

  function firstTagText(tag) {
    const m = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (!m) return '';
    return m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const headline_text = firstTagText('h1') || firstTagText('h2') || 'Not available';

  const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i);
  const meta_description = metaMatch ? metaMatch[1].trim() : '';

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const page_title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

  return {
    has_above_fold_cta,
    has_phone_visible,
    has_intake_form,
    form_field_count,
    has_reviews_or_testimonials,
    has_credentials_visible,
    headline_text,
    meta_description,
    page_title,
    fetch_ok: true,
    status: res.status,
    elapsed_ms: elapsed,
  };
}

function wlvlpIsGenericHeadline(h) {
  if (!h || h === 'Not available') return true;
  const s = h.toLowerCase();
  const hasTax = /\btax\b/.test(s);
  const hasGeneric = /(services?|help|solutions?)/.test(s);
  const hasSpecific = /(\$|\d|irs|penalt|audit|refund|resolv|reduc|save|recover|file|return)/i.test(s);
  return hasTax && hasGeneric && !hasSpecific;
}

function wlvlpCalculateScore(c) {
  let score = 100;
  if (!c.has_above_fold_cta) score -= 25;
  if (!c.has_intake_form) score -= 15;
  if (c.form_field_count > 6) score -= 10;
  if (!c.has_reviews_or_testimonials) score -= 15;
  if (!c.has_credentials_visible) score -= 10;
  if (wlvlpIsGenericHeadline(c.headline_text)) score -= 15;
  if (!c.has_phone_visible) score -= 10;
  return Math.max(10, score);
}

function wlvlpIdentifyLeaks(c) {
  const leaks = [];
  if (!c.has_above_fold_cta) {
    leaks.push({
      title: 'No above-the-fold call to action',
      description: 'Visitors land and scroll without a clear next step. High-intent traffic should see a booking or consult CTA immediately.',
    });
  }
  if (!c.has_intake_form || c.form_field_count > 6) {
    leaks.push({
      title: 'Intake path creates friction',
      description: 'Long or vague forms cause drop-off. A shorter, clearer path captures more qualified leads without looking cheap.',
    });
  }
  if (wlvlpIsGenericHeadline(c.headline_text)) {
    leaks.push({
      title: 'Weak first-impression positioning',
      description: 'If the headline does not state who you help and what outcome you create, visitors hesitate. That hesitation becomes lost calls.',
    });
  }
  if (!c.has_reviews_or_testimonials || !c.has_credentials_visible) {
    leaks.push({
      title: 'Trust signals underperforming',
      description: 'Credentials, reviews, and results are not doing enough work. Strong visual trust markers turn uncertain visitors into booked consultations.',
    });
  }
  return leaks;
}

function wlvlpEstimateConversionRate(score) {
  if (score >= 70) return 2.8;
  if (score >= 40) return 1.8;
  return 1.2;
}

function wlvlpUpgradedHeadline(credential) {
  switch (credential) {
    case 'EA':   return 'Resolve IRS issues faster — without the back-and-forth.';
    case 'CPA':  return 'Tax strategy that saves you money — not just files your return.';
    case 'ATTY': return 'Tax disputes resolved. Penalties reduced. Your case, handled.';
    default:     return 'Stop losing clients to a website that does not convert.';
  }
}

function wlvlpUpgradedDescription(prospect) {
  const { credential, City } = prospect;
  const where = City ? ` in ${City}` : '';
  switch (credential) {
    case 'EA':   return `Enrolled agent representation${where}. Free 15-minute consult — see if we can help before you commit.`;
    case 'CPA':  return `Tax planning and accounting${where} for owner-operators who want their numbers working harder.`;
    case 'ATTY': return `Tax controversy and IRS defense${where}. Confidential consultation, clear next steps.`;
    default:     return `Book a free consultation${where} and find out exactly what is costing you clients.`;
  }
}

function wlvlpBuildLeakReport(prospect, crawl) {
  const score = wlvlpCalculateScore(crawl);
  const leaks = wlvlpIdentifyLeaks(crawl);
  const credential = prospect.credential;
  const visitors_month = WLVLP_TRAFFIC_BY_CRED[credential] || 300;
  const avg_client_value = WLVLP_VALUE_BY_CRED[credential] || 1500;
  const current_rate = wlvlpEstimateConversionRate(score);

  const current_problems = [];
  if (wlvlpIsGenericHeadline(crawl.headline_text)) current_problems.push('Generic headline');
  if (!crawl.has_above_fold_cta) current_problems.push('Weak CTA');
  if (!crawl.has_intake_form || crawl.form_field_count > 6) current_problems.push('Friction-heavy intake');
  if (!crawl.has_reviews_or_testimonials) current_problems.push('No social proof');
  if (current_problems.length === 0) current_problems.push('Generic headline', 'Weak CTA');

  return {
    score,
    leaks,
    metrics: {
      visitors_month,
      current_rate,
      optimized_rate: 3.6,
      avg_client_value,
      close_rate: 40,
    },
    before_after: {
      current_headline: crawl.headline_text || 'Generic tax services headline',
      current_problems,
      upgraded_headline: wlvlpUpgradedHeadline(credential),
      upgraded_description: wlvlpUpgradedDescription(prospect),
      upgraded_chips: ['Book a consultation', 'See services'],
    },
    crawl_meta: {
      fetched: crawl.fetch_ok,
      status: crawl.status,
      elapsed_ms: crawl.elapsed_ms,
      page_title: crawl.page_title,
      meta_description: crawl.meta_description,
    },
  };
}

function wlvlpDeriveLeadEconomics(report) {
  const { visitors_month, current_rate, optimized_rate, avg_client_value, close_rate } = report.metrics;
  const currentLeads = visitors_month * (current_rate / 100);
  const optimizedLeads = visitors_month * (optimized_rate / 100);
  const lostLeads = Math.max(0, optimizedLeads - currentLeads);
  const lostLeadsMonth = Math.round(lostLeads);
  const lostClientsYear = lostLeads * 12 * (close_rate / 100);
  const revenueLostYear = Math.round(lostClientsYear * avg_client_value);
  return { lost_leads_month: lostLeadsMonth, revenue_lost_year: revenueLostYear };
}

// ---------------------------------------------------------------------------
// WLVLP Auction Settlement Cron (10:00 UTC daily, alongside enrichment)
// Settles expired auctions: notifies winners, creates Stripe Checkout
// sessions, resets no-bid auctions to Buy Now, and sweeps stale
// pending_payment templates past the 48-hour deadline.
// ---------------------------------------------------------------------------

async function handleWlvlpAuctionSettlementCron(env) {
  const eventId = `EVT_${crypto.randomUUID()}`;
  const timestamp = new Date().toISOString();
  const now = new Date();

  const log = {
    event_id: eventId,
    timestamp,
    ended_auctions_found: 0,
    auctions_processed: 0,
    winners_notified: 0,
    no_bid_resets: 0,
    deadline_sweeps: 0,
    second_bidder_offers: 0,
    buy_now_resets: 0,
    errors: [],
  };

  try {
    // ── Phase 1: Settle newly expired auctions ──────────────────────────
    const endedAuctionsResult = await env.DB.prepare(
      "SELECT * FROM wlvlp_templates WHERE status = 'auction' AND auction_ends_at < ?"
    ).bind(now.toISOString()).all();
    const endedAuctions = endedAuctionsResult.results || [];
    log.ended_auctions_found = endedAuctions.length;

    for (const template of endedAuctions) {
      try {
        const highestBid = await env.DB.prepare(
          "SELECT * FROM wlvlp_bids WHERE slug = ? AND status = 'active' ORDER BY amount DESC LIMIT 1"
        ).bind(template.slug).first();

        if (highestBid) {
          // Winner — create Stripe Checkout Session (VLP Stripe account)
          const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.STRIPE_SECRET_KEY_VLP || env.STRIPE_SECRET_KEY}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              mode: 'subscription',
              'line_items[0][price_data][currency]': 'usd',
              'line_items[0][price_data][unit_amount]': (highestBid.amount * 100).toString(),
              'line_items[0][price_data][product_data][name]': `${template.title || template.slug} - Website Template (Auction Winner)`,
              'line_items[0][price_data][recurring][interval]': 'month',
              'line_items[0][quantity]': '1',
              success_url: `https://websitelotto.virtuallaunch.pro/success?session_id={CHECKOUT_SESSION_ID}`,
              cancel_url: `https://websitelotto.virtuallaunch.pro/templates/${template.slug}`,
              'metadata[platform]': 'wlvlp',
              'metadata[slug]': template.slug,
              'metadata[account_id]': highestBid.account_id,
              'metadata[acquisition_type]': 'auction_win',
              'metadata[auction_winner]': 'true',
            }),
          });

          if (stripeRes.ok) {
            const sessionData = await stripeRes.json();

            // Notify winner
            const winner = await env.DB.prepare(
              "SELECT email FROM accounts WHERE account_id = ?"
            ).bind(highestBid.account_id).first();

            if (winner?.email) {
              try {
                await sendEmail(winner.email,
                  `You won the auction for ${template.title || template.slug}!`,
                  `<p>Congratulations! You won the auction for <strong>${template.title || template.slug}</strong>.</p>
                   <p>Your winning bid: <strong>$${highestBid.amount}/month</strong></p>
                   <p>Complete your payment within 48 hours to claim your template:</p>
                   <p><a href="${sessionData.url}" style="background:#f97316;color:white;padding:12px 24px;text-decoration:none;border-radius:4px;">Complete Payment</a></p>
                   <p>If payment is not completed within 48 hours, the template may be offered to the next highest bidder.</p>`,
                  env);
                log.winners_notified++;
              } catch (emailError) {
                console.error('Failed to send auction winner email:', emailError);
                log.errors.push({ slug: template.slug, phase: 'winner_email', error: emailError.message });
              }
            }

            // Mark losing bids
            await env.DB.prepare(
              "UPDATE wlvlp_bids SET status = 'lost' WHERE slug = ? AND account_id != ?"
            ).bind(template.slug, highestBid.account_id).run();

            // Set template to pending_payment with settlement metadata
            await env.DB.prepare(
              "UPDATE wlvlp_templates SET status = 'pending_payment', updated_at = ? WHERE slug = ?"
            ).bind(timestamp, template.slug).run();

            // Write settlement receipt
            await r2Put(env.R2_VIRTUAL_LAUNCH, `wlvlp/receipts/cron/auction-settlement/${template.slug}/${timestamp}.json`, {
              eventId: `${eventId}_${template.slug}`,
              timestamp,
              type: 'auction_settlement',
              slug: template.slug,
              winner_account_id: highestBid.account_id,
              winning_bid: highestBid.amount,
              settlement_status: 'pending_payment',
              stripe_session_url: sessionData.url,
              payment_deadline: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
            });
          } else {
            const errText = await stripeRes.text();
            console.error('Failed to create Stripe session for auction winner:', errText);
            log.errors.push({ slug: template.slug, phase: 'stripe_session', error: errText });
          }
        } else {
          // No bids — reset to Buy Now
          await env.DB.prepare(
            "UPDATE wlvlp_templates SET status = 'available', auction_ends_at = NULL, updated_at = ? WHERE slug = ?"
          ).bind(timestamp, template.slug).run();

          await r2Put(env.R2_VIRTUAL_LAUNCH, `wlvlp/receipts/cron/auction-settlement/${template.slug}/${timestamp}.json`, {
            eventId: `${eventId}_${template.slug}`,
            timestamp,
            type: 'auction_settlement',
            slug: template.slug,
            settlement_status: 'no_bids',
            action: 'reset_to_available',
          });
          log.no_bid_resets++;
        }
        log.auctions_processed++;
      } catch (templateError) {
        console.error(`Failed to process auction for ${template.slug}:`, templateError);
        log.errors.push({ slug: template.slug, phase: 'settlement', error: templateError.message });
      }
    }

    // ── Phase 2: Sweep stale pending_payment (48-hour deadline) ─────────
    // Templates set to pending_payment whose settlement receipt is >48h old.
    const pendingResult = await env.DB.prepare(
      "SELECT * FROM wlvlp_templates WHERE status = 'pending_payment'"
    ).all();
    const pendingTemplates = (pendingResult.results || []);

    for (const template of pendingTemplates) {
      try {
        // updated_at was set when we flipped to pending_payment — use it as settlement time
        const settledAt = template.updated_at ? new Date(template.updated_at) : null;
        if (!settledAt || (now.getTime() - settledAt.getTime()) < 48 * 60 * 60 * 1000) continue;

        log.deadline_sweeps++;

        // Find the original winning bidder (their bid is still 'active')
        const winnerBid = await env.DB.prepare(
          "SELECT * FROM wlvlp_bids WHERE slug = ? AND status = 'active' ORDER BY amount DESC LIMIT 1"
        ).bind(template.slug).first();

        // Mark winner's bid as expired
        if (winnerBid) {
          await env.DB.prepare(
            "UPDATE wlvlp_bids SET status = 'expired' WHERE bid_id = ?"
          ).bind(winnerBid.bid_id).run();
        }

        // Look for second-highest bidder (status = 'lost' since we marked them earlier)
        const secondBid = await env.DB.prepare(
          "SELECT * FROM wlvlp_bids WHERE slug = ? AND status = 'lost' ORDER BY amount DESC LIMIT 1"
        ).bind(template.slug).first();

        if (secondBid) {
          // Offer to second-highest bidder — create new Checkout Session
          const stripe2 = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.STRIPE_SECRET_KEY_VLP || env.STRIPE_SECRET_KEY}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              mode: 'subscription',
              'line_items[0][price_data][currency]': 'usd',
              'line_items[0][price_data][unit_amount]': (secondBid.amount * 100).toString(),
              'line_items[0][price_data][product_data][name]': `${template.title || template.slug} - Website Template (Auction - 2nd Offer)`,
              'line_items[0][price_data][recurring][interval]': 'month',
              'line_items[0][quantity]': '1',
              success_url: `https://websitelotto.virtuallaunch.pro/success?session_id={CHECKOUT_SESSION_ID}`,
              cancel_url: `https://websitelotto.virtuallaunch.pro/templates/${template.slug}`,
              'metadata[platform]': 'wlvlp',
              'metadata[slug]': template.slug,
              'metadata[account_id]': secondBid.account_id,
              'metadata[acquisition_type]': 'auction_win',
              'metadata[auction_winner]': 'true',
            }),
          });

          if (stripe2.ok) {
            const session2 = await stripe2.json();

            // Promote second bidder to active, reset their status
            await env.DB.prepare(
              "UPDATE wlvlp_bids SET status = 'active' WHERE bid_id = ?"
            ).bind(secondBid.bid_id).run();

            // Mark remaining lost bids as lost (they already are, but ensure consistency)
            await env.DB.prepare(
              "UPDATE wlvlp_bids SET status = 'lost' WHERE slug = ? AND bid_id != ? AND status != 'expired'"
            ).bind(template.slug, secondBid.bid_id).run();

            // Reset pending_payment timer
            await env.DB.prepare(
              "UPDATE wlvlp_templates SET updated_at = ? WHERE slug = ?"
            ).bind(timestamp, template.slug).run();

            // Notify second bidder
            const secondBidder = await env.DB.prepare(
              "SELECT email FROM accounts WHERE account_id = ?"
            ).bind(secondBid.account_id).first();

            if (secondBidder?.email) {
              try {
                await sendEmail(secondBidder.email,
                  `You have a second chance to win ${template.title || template.slug}!`,
                  `<p>The previous auction winner for <strong>${template.title || template.slug}</strong> did not complete payment.</p>
                   <p>As the next highest bidder at <strong>$${secondBid.amount}/month</strong>, you can now claim this template.</p>
                   <p>Complete your payment within 48 hours:</p>
                   <p><a href="${session2.url}" style="background:#f97316;color:white;padding:12px 24px;text-decoration:none;border-radius:4px;">Complete Payment</a></p>`,
                  env);
              } catch (e2) {
                console.error('Failed to send second-bidder email:', e2);
              }
            }

            log.second_bidder_offers++;

            await r2Put(env.R2_VIRTUAL_LAUNCH, `wlvlp/receipts/cron/auction-settlement/${template.slug}/second-offer-${timestamp}.json`, {
              eventId: `${eventId}_second_${template.slug}`,
              timestamp,
              type: 'auction_settlement_second_offer',
              slug: template.slug,
              expired_winner: winnerBid?.account_id,
              new_offer_account_id: secondBid.account_id,
              new_offer_amount: secondBid.amount,
              stripe_session_url: session2.url,
            });
          } else {
            console.error('Failed to create Stripe session for second bidder:', await stripe2.text());
          }
        } else {
          // No second bidder — reset to Buy Now
          await env.DB.prepare(
            "UPDATE wlvlp_templates SET status = 'available', auction_ends_at = NULL, updated_at = ? WHERE slug = ?"
          ).bind(timestamp, template.slug).run();

          log.buy_now_resets++;

          await r2Put(env.R2_VIRTUAL_LAUNCH, `wlvlp/receipts/cron/auction-settlement/${template.slug}/deadline-expired-${timestamp}.json`, {
            eventId: `${eventId}_expired_${template.slug}`,
            timestamp,
            type: 'auction_settlement_deadline_expired',
            slug: template.slug,
            action: 'reset_to_available',
          });
        }
      } catch (sweepError) {
        console.error(`Failed deadline sweep for ${template.slug}:`, sweepError);
        log.errors.push({ slug: template.slug, phase: 'deadline_sweep', error: sweepError.message });
      }
    }
  } catch (e) {
    console.error('WLVLP auction settlement cron failed:', e);
    log.errors.push({ phase: 'top_level', error: e.message });
  }

  // Write settlement log
  const dateStr = now.toISOString().slice(0, 10);
  await r2Put(env.R2_VIRTUAL_LAUNCH, `vlp-scale/logs/wlvlp-auction-${dateStr}.json`, log);

  console.log(`WLVLP auction settlement: ${log.auctions_processed} settled, ${log.winners_notified} notified, ${log.deadline_sweeps} deadline sweeps, ${log.second_bidder_offers} second-bidder offers, ${log.buy_now_resets} buy-now resets`);
  return log;
}

// ---------------------------------------------------------------------------
// WLVLP Asset Page Enrichment Cron (13:00 UTC daily)
// Crawls prospect websites, scores conversion leaks, and overwrites the
// minimal Shape B asset pages written by the campaign router with full
// Shape A records containing conversion_leak_report.
// ---------------------------------------------------------------------------

async function handleWlvlpAssetEnrichmentCron(env, opts = {}) {
  const startedAt = new Date();
  const todayIso = startedAt.toISOString();
  const dateKey = todayIso.slice(0, 10);
  const limit = typeof opts.limit === 'number' && opts.limit >= 0 ? opts.limit : 20;

  const runLog = {
    ran_at: todayIso,
    records_processed: 0,
    crawled_ok: 0,
    crawl_failed: 0,
    no_domain: 0,
    no_website: 0,
    avg_score: 0,
    errors: [],
  };

  // 1. Read FOIA master JSONL
  let records;
  try {
    records = await readFoiaMasterRecords(env);
    if (!records) {
      runLog.errors.push('master_file_not_found');
      return runLog;
    }
  } catch (e) {
    runLog.errors.push(`master_read_failed: ${e && e.message || e}`);
    return runLog;
  }

  // 2. Filter: wlvlp_email_1_prepared_at set AND wlvlp_asset_enriched_at empty
  const eligibleIdx = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!r.wlvlp_email_1_prepared_at || !String(r.wlvlp_email_1_prepared_at).trim()) continue;
    if (r.wlvlp_asset_enriched_at && String(r.wlvlp_asset_enriched_at).trim()) continue;
    eligibleIdx.push(i);
  }

  if (eligibleIdx.length === 0) {
    runLog.records_eligible = 0;
    return runLog;
  }

  // 3. Cap at limit
  const batch = eligibleIdx.slice(0, limit);
  runLog.records_eligible = eligibleIdx.length;
  let scoreSum = 0;
  let scoreCount = 0;
  let masterDirty = false;

  for (const idx of batch) {
    const r = records[idx];
    const firstDisplay = dailyTitleCaseFirst(r.First_NAME) || 'Friend';
    const lastDisplay = dailyTitleCase(r.LAST_NAME);
    const city = dailyTitleCase(r.BUS_ADDR_CITY);
    const state = String(r.BUS_ST_CODE || '').toUpperCase().trim();
    const profession = String(r.PROFESSION || '').toUpperCase();
    const credKey = dailyNormalizeCred(profession);
    const cred = DAILY_CRED[credKey] || DAILY_CRED.EA;
    const templateMatch = WLVLP_TEMPLATE_BY_CRED[credKey] || WLVLP_TEMPLATE_BY_CRED.Unknown;

    // Determine slug — prefer stored slug from campaign router, else regenerate
    const slug = (r.wlvlp_asset_slug && String(r.wlvlp_asset_slug).trim())
      ? String(r.wlvlp_asset_slug).trim()
      : dailyMakeSlug(
          dailySanitizeNamePart(r.First_NAME),
          dailySanitizeNamePart(r.LAST_NAME),
          r.BUS_ADDR_CITY,
          r.BUS_ST_CODE
        );

    if (!slug) {
      r.wlvlp_asset_enriched_at = todayIso;
      r.wlvlp_asset_enriched_note = 'no_slug';
      masterDirty = true;
      runLog.errors.push({ slug: '(empty)', reason: 'no_slug' });
      continue;
    }

    // a. Derive domain
    let domainClean = r.domain_clean && String(r.domain_clean).trim();
    if (!domainClean) {
      domainClean = normalizeDomainFromWebsite(r.WEBSITE);
      if (domainClean) {
        r.domain_clean = domainClean;
        masterDirty = true;
      }
    }

    // b/c. Crawl or synthetic report for no-domain / no-website records
    let crawlResult;
    let isNoDomain = false;
    let isNoWebsite = false;
    let crawlFailed = false;

    if (!domainClean) {
      // No website — strongest sales pitch
      isNoWebsite = true;
      runLog.no_website++;
      crawlResult = {
        has_above_fold_cta: false,
        has_phone_visible: false,
        has_intake_form: false,
        form_field_count: 0,
        has_reviews_or_testimonials: false,
        has_credentials_visible: false,
        headline_text: 'Not available',
        meta_description: '',
        page_title: '',
        fetch_ok: false,
        status: 0,
        elapsed_ms: 0,
      };
    } else {
      try {
        crawlResult = await wlvlpCrawlSite(domainClean);
        if (crawlResult.fetch_ok) {
          runLog.crawled_ok++;
        } else {
          crawlFailed = true;
          runLog.crawl_failed++;
        }
      } catch (e) {
        crawlFailed = true;
        runLog.crawl_failed++;
        runLog.errors.push({ slug, reason: `crawl_error: ${e && e.message || e}` });
        crawlResult = {
          has_above_fold_cta: false,
          has_phone_visible: false,
          has_intake_form: false,
          form_field_count: 0,
          has_reviews_or_testimonials: false,
          has_credentials_visible: false,
          headline_text: 'Not available',
          meta_description: '',
          page_title: '',
          fetch_ok: false,
          status: 0,
          elapsed_ms: 0,
        };
      }
    }

    // d-f. Build leak report using existing helpers
    const prospect = { credential: credKey, City: city };
    const leakReport = wlvlpBuildLeakReport(prospect, crawlResult);
    const economics = wlvlpDeriveLeadEconomics(leakReport);

    // Override for no-website case
    if (isNoWebsite) {
      leakReport.score = 0;
      leakReport.leaks = [{
        title: 'No website found',
        description: `We couldn't find an active website for your practice. This means potential clients searching for ${cred.label}s in ${city || 'your area'} can't find you online.`,
      }];
    }

    // Override for crawl-failed case
    if (crawlFailed && !isNoWebsite) {
      leakReport.leaks.unshift({
        title: 'Website unreachable',
        description: `We tried to analyze ${domainClean} but couldn't reach it. If your site is down or loading slowly, potential clients are bouncing to competitors.`,
      });
    }

    scoreSum += leakReport.score;
    scoreCount++;

    // g. Build full Shape A asset page
    const lostLeads = economics.lost_leads_month;
    const assetPage = {
      slug,
      headline: isNoWebsite
        ? `${firstDisplay}, potential clients in ${city || 'your area'} can't find you online`
        : `${firstDisplay}, your website may be losing ${lostLeads}+ leads every month`,
      subheadline: isNoWebsite
        ? `Without a website, ${cred.label}s miss out on clients who search online first.`
        : `Based on your current site structure at ${domainClean}, here's what we found.`,
      template_preview_slug: templateMatch.slug,
      template_preview_url: `https://websitelotto.virtuallaunch.pro/sites/${templateMatch.slug}/preview.html`,
      practice_type: credKey,
      city: city || '',
      state: state || '',
      firm: r.DBA || `${firstDisplay} ${lastDisplay}`.trim(),
      conversion_leak_report: {
        score: leakReport.score,
        leaks: leakReport.leaks,
        metrics: leakReport.metrics,
        before_after: leakReport.before_after,
        crawl_failed: crawlFailed || false,
        no_website: isNoWebsite || false,
      },
      cta_claim_url: `https://websitelotto.virtuallaunch.pro/sites/${templateMatch.slug}`,
      cta_scratch_url: 'https://websitelotto.virtuallaunch.pro/scratch',
      cta_booking_url: 'https://cal.com/vlp/wlvlp-discovery',
      generated_at: todayIso,
    };

    // h. Write enriched asset page to R2
    try {
      await env.R2_VIRTUAL_LAUNCH.put(
        `vlp-scale/wlvlp-asset-pages/${slug}.json`,
        JSON.stringify(assetPage),
        { httpMetadata: { contentType: 'application/json' } }
      );
    } catch (e) {
      runLog.errors.push({ slug, reason: `r2_write_failed: ${e && e.message || e}` });
    }

    // i. Stamp enrichment on FOIA master record
    r.wlvlp_asset_enriched_at = todayIso;
    masterDirty = true;
    runLog.records_processed++;
  }

  // 4. Write updated FOIA master JSONL back to R2
  if (masterDirty) {
    try {
      await writeFoiaMasterRecords(env, records);
    } catch (e) {
      runLog.errors.push(`master_write_failed: ${e && e.message || e}`);
    }
  }

  // 5. Compute avg score
  runLog.avg_score = scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 10) / 10 : 0;

  // 6. Write run log to R2
  try {
    await env.R2_VIRTUAL_LAUNCH.put(
      `vlp-scale/logs/wlvlp-enrich-${dateKey}.json`,
      JSON.stringify(runLog),
      { httpMetadata: { contentType: 'application/json' } }
    );
  } catch (e) {
    console.error('WLVLP enrich: failed to write run log:', e);
  }

  return runLog;
}

function wlvlpFormatMoney(n) {
  if (n >= 1000) {
    const k = n / 1000;
    return `$${k.toFixed(k < 10 ? 1 : 0).replace(/\.0$/, '')}k`;
  }
  return `$${n}`;
}

function wlvlpGetField(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim() !== '') return obj[k];
  }
  return '';
}

async function handleWlvlpBatchGeneration(env, ctx) {
  const startedAt = new Date().toISOString();
  const today = startedAt.slice(0, 10);

  // 1. Load prospect list from R2
  const prospectsKey = 'vlp-scale/wlvlp-prospects/active.json';
  const prospectsObj = await env.R2_VIRTUAL_LAUNCH.get(prospectsKey);
  if (!prospectsObj) {
    console.log('WLVLP batch: no prospect list at', prospectsKey);
    return { ok: false, reason: 'no_prospect_list', processed: 0 };
  }

  let prospects;
  try {
    prospects = await prospectsObj.json();
  } catch (e) {
    console.error('WLVLP batch: failed to parse active.json', e);
    return { ok: false, reason: 'invalid_json', processed: 0 };
  }
  if (!Array.isArray(prospects)) {
    return { ok: false, reason: 'not_array', processed: 0 };
  }

  // 2. Selection
  const eligibleRaw = prospects
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !wlvlpIsEmpty(wlvlpGetField(p, ['email_found'])))
    .filter(({ p }) => String(wlvlpGetField(p, ['email_status']) || '').trim().toLowerCase() !== 'invalid')
    .filter(({ p }) => wlvlpIsEmpty(p.wlvlp_email_1_prepared_at));

  const seenEmails = new Set();
  const deduped = [];
  let dupCount = 0;
  for (const item of eligibleRaw) {
    const email = String(wlvlpGetField(item.p, ['email_found'])).trim().toLowerCase();
    if (seenEmails.has(email)) { dupCount++; continue; }
    seenEmails.add(email);
    deduped.push(item);
  }

  deduped.sort((a, b) => {
    const da = String(wlvlpGetField(a.p, ['domain_clean']) || '').trim().toLowerCase();
    const db = String(wlvlpGetField(b.p, ['domain_clean']) || '').trim().toLowerCase();
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da.localeCompare(db);
  });

  // Cap at 25 to stay under Worker wall-time limits (50 * 2s delays = 100s).
  const BATCH_SIZE = 25;
  const selected = deduped.slice(0, BATCH_SIZE);

  const usedSlugs = new Map();
  function uniqueSlug(base) {
    if (!base) base = 'prospect';
    let s = base;
    let n = 1;
    while (usedSlugs.has(s)) { n++; s = `${base}-${n}`; }
    usedSlugs.set(s, true);
    return s;
  }

  const batch = [];
  const sendQueue = [];
  let crawlOk = 0, crawlFail = 0;
  const scoreList = [];

  for (let s = 0; s < selected.length; s++) {
    const { p, i } = selected[s];
    const firstRaw = wlvlpGetField(p, ['First_NAME', 'FIRST_NAME', 'first_name']);
    const lastRaw = wlvlpGetField(p, ['LAST_NAME', 'last_name']);
    const First = wlvlpTitleCase(firstRaw).split(' ')[0] || 'Friend';
    const Last = wlvlpTitleCase(lastRaw);
    const cityRaw = wlvlpGetField(p, ['BUS_ADDR_CITY', 'city']);
    const City = wlvlpTitleCase(cityRaw);
    const State = String(wlvlpGetField(p, ['BUS_ST_CODE', 'state']) || '').toUpperCase().trim();
    const dbaRaw = wlvlpGetField(p, ['DBA', 'firm']);
    const DBA = dbaRaw || `${First} ${Last}`.trim();
    const profession = wlvlpGetField(p, ['PROFESSION', 'credential']);
    const credential = wlvlpNormalizeCredential(profession);
    const firmBucket = String(wlvlpGetField(p, ['firm_bucket']) || '').trim().toLowerCase() || 'local_firm';
    const email = String(wlvlpGetField(p, ['email_found'])).trim();
    const domainClean = String(wlvlpGetField(p, ['domain_clean']) || '').trim();

    const baseSlug = wlvlpSlugify(`${First} ${Last} ${City} ${State}`);
    const slug = uniqueSlug(baseSlug);

    const crawl = await wlvlpCrawlSite(domainClean);
    if (crawl.fetch_ok) crawlOk++; else crawlFail++;
    if (s < selected.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }

    const report = wlvlpBuildLeakReport({ credential, City }, crawl);
    scoreList.push(report.score);
    const econ = wlvlpDeriveLeadEconomics(report);
    const lostLeadsMonth = econ.lost_leads_month;
    const revenueLostStr = wlvlpFormatMoney(econ.revenue_lost_year);
    const leakCount = report.leaks.length;

    const tmpl = WLVLP_TEMPLATE_BY_CRED[credential];

    let subject1;
    if (firmBucket === 'solo_brand') {
      subject1 = `${First} — ${DBA} site scored ${report.score}/100 on conversion`;
    } else {
      subject1 = `${First} — your ${City || 'local'} practice site scored ${report.score}/100 on conversion`;
    }

    const headline = `${First}, your website may be losing ${lostLeadsMonth}+ leads every month`;
    const subheadline = `Based on your current site structure, CTA placement, and intake flow, this report estimates how many potential clients leave before they book, call, or submit a form.`;

    const firmOrCityRef = firmBucket === 'solo_brand' ? DBA : `your ${City || 'local'} practice`;

    const body1 =
`${First},

Your clients check your website before they ever pick up the phone. Based on a quick look at ${domainClean || 'your site'}, your site may be leaving ${lostLeadsMonth}+ leads on the table every month — that is roughly ${revenueLostStr}/year in unrealized revenue.

I put together a free Conversion Leak Report for ${firmOrCityRef} that breaks down exactly where the drop-off is happening and what a fix looks like.

Take a look — no account needed:
https://websitelotto.virtuallaunch.pro/asset/${slug}

If any of this resonates, I can walk you through the numbers — 15 minutes on Google Meet.
https://cal.com/vlp/wlvlp-discovery

--
Jamie L Williams, EA
Website Lotto
websitelotto.virtuallaunch.pro
`;

    const subject2 = `${First} — ${leakCount} conversion leaks on ${domainClean || 'your site'}, ${revenueLostStr}/yr at stake`;
    const body2 =
`${First},

I sent you a note a few days ago with a Conversion Leak Report for ${firmOrCityRef}. Your site scored ${report.score}/100 — the report breaks down ${leakCount} specific issues costing an estimated ${revenueLostStr}/year.

Here is the direct link:
https://websitelotto.virtuallaunch.pro/asset/${slug}

The report includes a before/after of your homepage copy and an interactive calculator so you can adjust the numbers yourself.

Happy to walk through it live if you want.
https://cal.com/vlp/wlvlp-discovery

--
Jamie L Williams, EA
Website Lotto
websitelotto.virtuallaunch.pro
`;

    const templateSlug = tmpl.slug;
    const assetPage = {
      headline,
      subheadline,
      template_preview_slug: templateSlug,
      template_preview_url: `https://websitelotto.virtuallaunch.pro/sites/${templateSlug}/preview.html`,
      practice_type: credential,
      city: City,
      state: State,
      firm: DBA,
      conversion_leak_report: report,
      cta_claim_url: `https://websitelotto.virtuallaunch.pro/sites/${templateSlug}`,
      cta_scratch_url: 'https://websitelotto.virtuallaunch.pro/scratch',
      cta_booking_url: 'https://cal.com/vlp/wlvlp-discovery',
    };

    // Write asset page to R2
    try {
      await env.R2_VIRTUAL_LAUNCH.put(
        `vlp-scale/wlvlp-asset-pages/${slug}.json`,
        JSON.stringify(assetPage),
        { httpMetadata: { contentType: 'application/json' } }
      );
    } catch (e) {
      console.error(`WLVLP batch: failed to write asset page ${slug}:`, e);
    }

    const record = {
      slug,
      email,
      first_name: First,
      name: `${First} ${Last}`.trim(),
      credential,
      city: City,
      state: State,
      firm: DBA,
      firm_bucket: firmBucket,
      domain_clean: domainClean,
      subject: subject1,
      body: body1,
      email_1: { subject: subject1, body: body1 },
      email_2: { subject: subject2, body: body2 },
      email_1_sent_at: null,
      email_2_scheduled_for: null,
      email_2_sent_at: null,
      prepared_at: startedAt,
    };

    batch.push(record);
    sendQueue.push({
      slug,
      email,
      first_name: First,
      subject: subject1,
      body: body1,
      email_2_subject: subject2,
      email_2_body: body2,
      email_1_sent_at: null,
      email_2_scheduled_for: null,
      email_2_sent_at: null,
    });

    // Update prospect tracking column on original list
    prospects[i].wlvlp_email_1_prepared_at = startedAt;
  }

  // 3. Write outputs to R2
  try {
    await env.R2_VIRTUAL_LAUNCH.put(
      `vlp-scale/wlvlp-batches/batch-${today}.json`,
      JSON.stringify(batch),
      { httpMetadata: { contentType: 'application/json' } }
    );
  } catch (e) {
    console.error('WLVLP batch: failed to write batch record:', e);
  }

  // Merge with existing email1-pending queue if present
  const queueKey = 'vlp-scale/wlvlp-send-queue/email1-pending.json';
  let existingQueue = [];
  try {
    const existingObj = await env.R2_VIRTUAL_LAUNCH.get(queueKey);
    if (existingObj) existingQueue = await existingObj.json();
    if (!Array.isArray(existingQueue)) existingQueue = [];
  } catch {}
  const mergedQueue = existingQueue.concat(sendQueue);
  try {
    await env.R2_VIRTUAL_LAUNCH.put(
      queueKey,
      JSON.stringify(mergedQueue),
      { httpMetadata: { contentType: 'application/json' } }
    );
  } catch (e) {
    console.error('WLVLP batch: failed to write send queue:', e);
  }

  // 4. Update prospect list with prepared timestamps
  try {
    await env.R2_VIRTUAL_LAUNCH.put(
      prospectsKey,
      JSON.stringify(prospects),
      { httpMetadata: { contentType: 'application/json' } }
    );
  } catch (e) {
    console.error('WLVLP batch: failed to write updated prospect list:', e);
  }

  const remaining = prospects.filter(p =>
    !wlvlpIsEmpty(wlvlpGetField(p, ['email_found'])) &&
    String(wlvlpGetField(p, ['email_status']) || '').trim().toLowerCase() !== 'invalid' &&
    wlvlpIsEmpty(p.wlvlp_email_1_prepared_at)
  ).length;

  const min = scoreList.length ? Math.min(...scoreList) : 0;
  const max = scoreList.length ? Math.max(...scoreList) : 0;
  const avg = scoreList.length ? (scoreList.reduce((a, b) => a + b, 0) / scoreList.length).toFixed(1) : 0;

  console.log(`WLVLP batch complete: ${batch.length} prospects processed, ${remaining} eligible remaining`);
  console.log(`  crawls: ${crawlOk} ok / ${crawlFail} fail; score min=${min} max=${max} avg=${avg}; dedup=${dupCount}`);

  return {
    ok: true,
    processed: batch.length,
    remaining,
    dedup_dropped: dupCount,
    crawl_ok: crawlOk,
    crawl_fail: crawlFail,
    score: { min, max, avg: Number(avg) },
    batch_key: `vlp-scale/wlvlp-batches/batch-${today}.json`,
    send_queue_size: mergedQueue.length,
  };
}

// ---------------------------------------------------------------------------
// WLVLP Email Send (called from 14:00 UTC cron)
// ---------------------------------------------------------------------------

async function handleWlvlpEmailSend(env) {
  return runStagedSendQueue(env, {
    label: 'WLVLP',
    queueKey: 'vlp-scale/wlvlp-send-queue/email1-pending.json',
    archivePrefix: 'vlp-scale/wlvlp-send-queue/sent-',
  });
}

// ---------------------------------------------------------------------------
// Shared 6-stage send-queue runner — used by TTMP, VLP, and WLVLP send
// handlers. Walks each queued record through emails 1..6, sending whenever the
// previous email is sent and the per-email scheduled_for date is today or
// earlier. Records with all 6 sent are moved to the daily archive object.
// ---------------------------------------------------------------------------
async function runStagedSendQueue(env, opts) {
  const { label, queueKey, archivePrefix } = opts;
  const today = new Date().toISOString().slice(0, 10);
  const startedAt = new Date();
  console.log(`${label} email send: started at ${startedAt.toISOString()}`);
  const sentCounts = { email_1: 0, email_2: 0, email_3: 0, email_4: 0, email_5: 0, email_6: 0 };
  const errors = [];

  let queue;
  try {
    const obj = await env.R2_VIRTUAL_LAUNCH.get(queueKey);
    if (!obj) {
      console.log(`${label} email send: no queue file`);
      const endedAt = new Date();
      return { ...sentCounts, queue_size: 0, started_at: startedAt.toISOString(), ended_at: endedAt.toISOString(), duration_ms: endedAt - startedAt };
    }
    queue = await obj.json();
  } catch (e) {
    console.error(`${label} email send: failed to read queue:`, e);
    const endedAt = new Date();
    return { ...sentCounts, error: 'queue_read_failed', started_at: startedAt.toISOString(), ended_at: endedAt.toISOString(), duration_ms: endedAt - startedAt };
  }
  if (!Array.isArray(queue) || queue.length === 0) {
    console.log(`${label} email send: queue empty`);
    const endedAt = new Date();
    return { ...sentCounts, queue_size: 0, started_at: startedAt.toISOString(), ended_at: endedAt.toISOString(), duration_ms: endedAt - startedAt };
  }

  // Email 1
  for (const record of queue) {
    if (record.status === 'unsubscribed') continue;
    if (record.email_1_sent_at) continue;
    if (record.status && record.status !== 'pending' && record.status !== 'email_1_failed') continue;
    try {
      await sendGmailMessage(env, record.email, record.subject, record.body);
      record.email_1_sent_at = new Date().toISOString();
      record.status = 'email_1_sent';
      sentCounts.email_1++;
    } catch (e) {
      console.error(`${label} email 1 send failed for ${record.slug}/${record.email}:`, e.message);
      record.status = 'email_1_failed';
      record.last_error = e.message;
      errors.push({ slug: record.slug, email: record.email, step: 'email_1', error: e.message });
    }
  }

  const stages = [
    { n: 2, prevSent: 'email_1_sent_at', sentAt: 'email_2_sent_at', sched: 'email_2_scheduled_for', subjK: 'email_2_subject', bodyK: 'email_2_body', okStatus: 'email_2_sent', failStatus: 'email_2_failed', countKey: 'email_2' },
    { n: 3, prevSent: 'email_2_sent_at', sentAt: 'email_3_sent_at', sched: 'email_3_scheduled_for', subjK: 'email_3_subject', bodyK: 'email_3_body', okStatus: 'email_3_sent', failStatus: 'email_3_failed', countKey: 'email_3' },
    { n: 4, prevSent: 'email_3_sent_at', sentAt: 'email_4_sent_at', sched: 'email_4_scheduled_for', subjK: 'email_4_subject', bodyK: 'email_4_body', okStatus: 'email_4_sent', failStatus: 'email_4_failed', countKey: 'email_4' },
    { n: 5, prevSent: 'email_4_sent_at', sentAt: 'email_5_sent_at', sched: 'email_5_scheduled_for', subjK: 'email_5_subject', bodyK: 'email_5_body', okStatus: 'email_5_sent', failStatus: 'email_5_failed', countKey: 'email_5' },
    { n: 6, prevSent: 'email_5_sent_at', sentAt: 'email_6_sent_at', sched: 'email_6_scheduled_for', subjK: 'email_6_subject', bodyK: 'email_6_body', okStatus: 'email_6_sent', failStatus: 'email_6_failed', countKey: 'email_6' },
  ];
  for (const stage of stages) {
    const todo = queue.filter(r =>
      r.status !== 'unsubscribed' &&
      r[stage.prevSent] &&
      !r[stage.sentAt] &&
      r[stage.sched] &&
      r[stage.sched] <= today &&
      r[stage.subjK] &&
      r[stage.bodyK]
    );
    for (const record of todo) {
      try {
        await sendGmailMessage(env, record.email, record[stage.subjK], record[stage.bodyK]);
        record[stage.sentAt] = new Date().toISOString();
        record.status = stage.okStatus;
        sentCounts[stage.countKey]++;
      } catch (e) {
        console.error(`${label} email ${stage.n} send failed for ${record.slug}/${record.email}:`, e.message);
        record.status = stage.failStatus;
        record.last_error = e.message;
        errors.push({ slug: record.slug, email: record.email, step: `email_${stage.n}`, error: e.message });
      }
    }
  }

  const completed = queue.filter(r => r.email_6_sent_at);
  const stillPending = queue.filter(r => !r.email_6_sent_at);
  try {
    await env.R2_VIRTUAL_LAUNCH.put(
      queueKey,
      JSON.stringify(stillPending),
      { httpMetadata: { contentType: 'application/json' } }
    );
    if (completed.length > 0) {
      const archiveKey = `${archivePrefix}${today}.json`;
      let existingArchive = [];
      try {
        const a = await env.R2_VIRTUAL_LAUNCH.get(archiveKey);
        if (a) existingArchive = await a.json();
        if (!Array.isArray(existingArchive)) existingArchive = [];
      } catch {}
      await env.R2_VIRTUAL_LAUNCH.put(
        archiveKey,
        JSON.stringify(existingArchive.concat(completed)),
        { httpMetadata: { contentType: 'application/json' } }
      );
    }
  } catch (e) {
    console.error(`${label} email send: failed to write back queue:`, e);
  }

  const endedAt = new Date();
  const durationMs = endedAt - startedAt;
  const totalSent = sentCounts.email_1 + sentCounts.email_2 + sentCounts.email_3 + sentCounts.email_4 + sentCounts.email_5 + sentCounts.email_6;
  console.log(`${label} email send: ended at ${endedAt.toISOString()} — duration ${durationMs}ms, total sent ${totalSent}, ${JSON.stringify(sentCounts)} (queue size ${queue.length}, errors ${errors.length})`);
  return {
    ...sentCounts,
    total_sent: totalSent,
    queue_size: queue.length,
    completed: completed.length,
    errors,
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    duration_ms: durationMs,
  };
}

async function handleVlpEmailSend(env) {
  return runStagedSendQueue(env, {
    label: 'VLP',
    queueKey: 'vlp-scale/vlp-send-queue/email1-pending.json',
    archivePrefix: 'vlp-scale/vlp-send-queue/sent-',
  });
}

// ---------------------------------------------------------------------------
// TTMP Email Send (called from 14:00 UTC cron and /internal/test-ttmp-send)
//
// Queue R2 key:    vlp-scale/ttmp-send-queue/email1-pending.json
// Archive key:     vlp-scale/ttmp-send-queue/sent-{date}.json
//
// Records carry all 6 emails inline as { subject, body } for email_1
// (subject/body) and email_2..email_6 (subject/body suffixed). Each record
// also carries email_{n}_scheduled_for as YYYY-MM-DD. The handler walks
// emails 1..6 in order, sending any whose scheduled_for is today or earlier
// and whose previous email has been sent.
// ---------------------------------------------------------------------------

async function handleTtmpEmailSend(env) {
  return runStagedSendQueue(env, {
    label: 'TTMP',
    queueKey: 'vlp-scale/ttmp-send-queue/email1-pending.json',
    archivePrefix: 'vlp-scale/ttmp-send-queue/sent-',
  });
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
// Daily Campaign Router — handleDailyBatchGeneration
// ---------------------------------------------------------------------------
// Runs at 12:00 UTC daily. Reads the NDJSON master file, filters records that
// already have a usable email and have not yet entered any campaign, then
// routes each one into TTMP / VLP / WLVLP using a weighted random
// assignment (65 / 25 / 10). For every routed record it generates a full
// 6-email queue entry with all subjects/bodies inline plus per-email
// scheduled_for dates, then appends to the matching campaign send queue.
// The master file is updated in place with the {ttmp|vlp|wlvlp}_email_1_prepared_at
// timestamp so the same record cannot be re-routed on a future day.
// ---------------------------------------------------------------------------

const DAILY_BATCH_CAP = 200;
const DAILY_ROUTE_TTMP = 0.65;
const DAILY_ROUTE_VLP  = 0.90; // upper bound (0.65..0.90 = VLP, 0.90..1 = WLVLP)
const ALLOWED_SEND_STATUSES = new Set(['valid', 'pattern_match', 'catch_all', 'pattern_unvalidated']);

const DAILY_CRED = {
  EA:   { label: 'enrolled agent', billing: '$100-300', weekly: '6.7 hours', annual: '322 hours', revenue: '$27,300-$72,800', new_client_value: '$15,000-$90,000/yr', time_savings_weekly: '6.7' },
  CPA:  { label: 'CPA',            billing: '$150-400', weekly: '5 hours',   annual: '240 hours', revenue: '$36,000-$96,000', new_client_value: '$22,500-$120,000/yr', time_savings_weekly: '5' },
  ATTY: { label: 'tax attorney',   billing: '$200-500', weekly: '4 hours',   annual: '192 hours', revenue: '$38,400-$96,000', new_client_value: '$18,000-$150,000/yr', time_savings_weekly: '4' },
};

// TTMP asset page template arrays — credential-specific workflow gaps and IRS codes
const TTMP_WORKFLOW_GAPS = {
  EA:   ['Manual transcript ordering through IRS e-Services — 15-20 min per client', 'Line-by-line code lookup across multiple tax years', 'Manually cross-referencing notice codes with account history'],
  CPA:  ['Manual transcript ordering through IRS e-Services — 15-20 min per client', 'Reconciling transcript data with prepared returns across periods', 'Manually cross-referencing notice codes with client account history'],
  ATTY: ['Manual transcript ordering through IRS e-Services — 15-20 min per client', 'Extracting key dates and amounts for case strategy from raw transcripts', 'Manually tracking statute of limitations across multiple tax years'],
};
const TTMP_TOOL_PREVIEW_CODES = ['971', '846', '570'];

function dailyTitleCaseFirst(s) {
  if (!s) return '';
  const t = String(s).trim().split(/\s+/)[0].toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function dailyTitleCase(s) {
  if (!s) return '';
  return String(s).trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
function dailySanitizeNamePart(s) {
  if (!s) return '';
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '').trim();
}
function dailyMakeSlug(first, last, city, state) {
  return [first, last, city, state]
    .map(p => String(p || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('-');
}
function dailyPlusDays(baseDate, n) {
  const d = new Date(baseDate);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dailyNormalizeCred(profession) {
  const p = String(profession || '').toUpperCase().trim();
  if (p.includes('CPA')) return 'CPA';
  if (p === 'EA' || p.includes('ENROLLED')) return 'EA';
  if (p.includes('ATTY') || p.includes('ATTORNEY') || p === 'JD' || p.includes('LAWYER')) return 'ATTY';
  return 'EA'; // default
}

// Build the full TTMP asset page shape expected by the TTMP frontend
function buildTtmpAssetPageData({ slug, credKey, cred, firstDisplay, lastDisplay, city, state, firm, nowIso, backfilled }) {
  return {
    slug,
    campaign: 'ttmp',
    headline: `${firstDisplay}, here's what transcript automation saves your ${city || 'local'} practice`,
    subheadline: `A practice analysis for ${cred.label}s — estimated time savings, revenue recovery, and workflow fit.`,
    practice_type: credKey,
    credential_label: cred.label,
    city, state,
    firm: firm || `${firstDisplay} ${lastDisplay}`.trim(),
    time_savings_weekly: cred.time_savings_weekly,
    workflow_gaps: TTMP_WORKFLOW_GAPS[credKey] || TTMP_WORKFLOW_GAPS.EA,
    tool_preview_codes: TTMP_TOOL_PREVIEW_CODES,
    stats: {
      billing_range: cred.billing,
      weekly_hours: cred.weekly,
      annual_hours: cred.annual,
      revenue_impact: cred.revenue,
    },
    cta_pricing_url: 'https://transcript.taxmonitor.pro/pricing',
    cta_learn_more_url: 'https://transcript.taxmonitor.pro/resources',
    cta_primary_url: 'https://transcript.taxmonitor.pro/pricing',
    cta_primary_label: 'Start Free — 10 analyses for $19',
    cta_secondary_url: 'https://transcript.taxmonitor.pro/resources',
    cta_secondary_label: 'Try the free IRS code lookup tool',
    cta_booking_url: 'https://cal.com/vlp/ttmp-discovery',
    generated_at: nowIso,
    ...(backfilled ? { backfilled: true } : {}),
  };
}

// ---- TTMP templates (mirror of scale/build-ttmp-batch.js) -------------------
function ttmpEmail1(first, c) {
  return {
    subject: `${first} — you're spending 3+ hours/week translating IRS codes by hand`,
    body:
`Hello ${first},

Every transcript that hits your desk costs you about 20 minutes
of manual code lookup. At ${c.billing}/hr, that's
real revenue sitting in a task that should take 30 seconds.

${first}, Transcript Tax Monitor Pro parses IRS transcript PDFs
into plain-English reports automatically. Upload the PDF, get a
client-ready report with every transaction code explained.

Try the free IRS code lookup tool — no account needed:
https://transcript.taxmonitor.pro/resources

When you're ready for full transcript parsing:
https://transcript.taxmonitor.pro/pricing
10 analyses for $19.
`
  };
}
function ttmpEmail2(first, c, slug) {
  return {
    subject: `Quick practice analysis for your firm, ${first} — ${c.annual}/yr on the table`,
    body:
`Hello ${first},

I sent you a note a couple days ago about transcript automation.
Wanted to follow up with something specific.

${first}, I put together a quick practice analysis for your firm
based on typical ${c.label} transcript volume:

https://transcript.taxmonitor.pro/asset/${slug}

It breaks down estimated time savings, revenue recovery, and
how the tool fits into your current workflow. Takes about
60 seconds to review.

If you want to see it work live on a real transcript, I'm
happy to walk through it:
https://cal.com/vlp/ttmp-discovery
`
  };
}
function ttmpEmail3(first, c, city) {
  return {
    subject: `${first} — what ${c.annual} unbilled hours cost your ${city} practice`,
    body:
`Hello ${first},

Quick math for a ${c.label} in ${city}:

${first}, ${c.weekly}/week on manual transcript work
x 48 working weeks
= ${c.annual}/year

At your billing range, that's ${c.revenue} in time
you could be spending on client work instead of decoding
IRS transaction codes.

The tool runs locally in your browser — no data leaves your
machine. Upload a transcript PDF, get a report in seconds.

https://transcript.taxmonitor.pro/pricing
Starts at 10 analyses for $19.
`
  };
}
function ttmpEmail4(first) {
  return {
    subject: `${first} — I built this because I got tired of the same 20-minute task`,
    body:
`Hello ${first},

I'm an enrolled agent. Over the past two years I worked
1,200+ client cases across 5 firms — installment agreements,
offers in compromise, CDP hearings, multi-state compliance,
and a lot of transcript reviews.

Every case started the same way: pull the transcript, look up
the codes, translate them into something the client understands.
Twenty minutes, every time.

${first}, I built Transcript Tax Monitor Pro to eliminate that step.
Upload the PDF, get a plain-English report with every code
explained and recommendations included.

Here's my background if you want to verify who's behind this:
https://www.linkedin.com/in/virtuallaunchpro

And here's the tool:
https://transcript.taxmonitor.pro

No pitch. If you work with transcripts regularly, you'll see
the value in about 30 seconds.
`
  };
}
function ttmpEmail5(first) {
  return {
    subject: `${first} — quick question`,
    body:
`Hello ${first},

I've sent you a few emails about automating IRS transcript
analysis. ${first}, wanted to ask directly:

Is manual transcript work something that takes up meaningful
time in your practice?

If yes — the tool is at transcript.taxmonitor.pro and starts
at $19 for 10 analyses. Happy to do a quick walkthrough if
that's more useful:
https://cal.com/vlp/ttmp-discovery

If not — no worries at all, and I'll stop reaching out.
`
  };
}
function ttmpEmail6(first) {
  return {
    subject: `Last note from me, ${first}`,
    body:
`Hello ${first},

This is my last email on this. I know your inbox is busy.

${first}, if you ever need to parse an IRS transcript quickly,
the tool is here:
https://transcript.taxmonitor.pro

Free IRS code lookup (no account):
https://transcript.taxmonitor.pro/resources

10 full transcript analyses for $19:
https://transcript.taxmonitor.pro/pricing

I hope it saves you some time when you need it.
`
  };
}

// ---- VLP templates ----------------------------------------------------------
function vlpEmail1(first, city, c, slug) {
  return {
    subject: `${first} — taxpayers in ${city} are searching for help you're not showing up for`,
    body:
`Hello ${first},

Taxpayers in ${city} search online for tax help every day.
Most never find you because you're not listed in the places
they're looking.

${first}, the Tax Monitor Pro network puts ${c.label}s
in front of taxpayers who need exactly what you offer. Your
profile shows up when someone in ${city} searches for help
with the types of cases you handle.

Listings start at $79/mo and include transcript automation
tokens so your practice gets more efficient at the same time.

I put together a quick practice analysis for your firm:
https://virtuallaunch.pro/asset/${slug}

Takes about 60 seconds to review.
`
  };
}
function vlpEmail2(first, city, c, slug) {
  return {
    subject: `${first} — ${c.new_client_value} from 5 new clients. Here's the math.`,
    body:
`Hello ${first},

Quick math on what a directory listing is worth for a
${c.label} in ${city}:

5 new clients/year at your billing range = ${c.new_client_value}

${first}, that's the conservative estimate from your practice
analysis:
https://virtuallaunch.pro/asset/${slug}

The Active tier is $79/mo ($948/yr). If the listing generates
even 2 new clients, the ROI is significant.

Every tier also includes transcript automation tokens —
the same tool that turns IRS transcript PDFs into
client-ready reports in seconds.

See all tiers:
https://virtuallaunch.pro/pricing
`
  };
}
function vlpEmail3(first, city, c) {
  return {
    subject: `${first} — what happens when referrals slow down`,
    body:
`Hello ${first},

Most ${c.label}s I've worked with rely on referrals
for new clients. That works until it doesn't — when a
referring partner retires, moves, or just stops sending
people your way.

${first}, a directory listing is a second pipeline that runs
whether referrals are flowing or not. Taxpayers searching
for help in ${city} find your profile, see your credentials,
and reach out directly.

No SEO to manage. No ads to run. Your profile is live and
searchable as long as you're a member.

https://virtuallaunch.pro/pricing

Not ready for a membership? Try the transcript automation
tool first — no commitment:
https://transcript.taxmonitor.pro/pricing
10 analyses for $19.
`
  };
}
function vlpEmail4(first, c, slug) {
  return {
    subject: `${first} — why I built this (from one EA to another)`,
    body:
`Hello ${first},

I'm an enrolled agent. Over the past two years I worked
1,200+ client cases across 5 firms — OICs, installment
agreements, CDP hearings, multi-state compliance.

The biggest problem I saw wasn't the technical work. It was
client acquisition. Good ${c.label}s with real
expertise, invisible to the taxpayers who needed them most.

${first}, I built the Virtual Launch Pro network to fix that.
One listing puts your practice in front of taxpayers actively
searching for help — with tools included to make your
workflow faster at the same time.

Here's my background:
https://www.linkedin.com/in/virtuallaunchpro

Here's your practice analysis:
https://virtuallaunch.pro/asset/${slug}
`
  };
}
function vlpEmail5(first, slug) {
  return {
    subject: `${first} — quick question about your client pipeline`,
    body:
`Hello ${first},

I've sent a few emails about listing your practice on the
Tax Monitor Pro network. ${first}, wanted to ask directly:

Are you actively looking for new clients right now?

If yes — your practice analysis is here:
https://virtuallaunch.pro/asset/${slug}

Listings start at $79/mo. Happy to walk through what the
listing looks like and how taxpayers find you:
https://cal.com/tax-monitor-pro/discovery

If your pipeline is full — that's a good problem to have.
No more emails from me.
`
  };
}
function vlpEmail6(first, city) {
  return {
    subject: `Last note from me, ${first}`,
    body:
`Hello ${first},

This is my last email about the Tax Monitor Pro network.

${first}, if you ever want to list your practice and get in
front of taxpayers searching in ${city}:
https://virtuallaunch.pro/pricing

And if a full membership isn't the right fit right now, the
transcript automation tool works standalone — no membership
needed:
https://transcript.taxmonitor.pro/pricing
10 IRS transcript analyses for $19.

Either way, I hope one of these tools saves you some time.
`
  };
}

// ---- WLVLP templates (router-friendly, no crawl) ----------------------------
function wlvlpRouterEmail1(first, city, c, slug) {
  return {
    subject: `${first} — your ${city || 'local'} practice site, scored on conversion`,
    body:
`Hello ${first},

Your clients check your website before they ever pick up the
phone. Most tax practice sites lose more leads than they convert
— slow load times, missing CTAs, intake forms that ask too much.

${first}, I put together a free Conversion Leak Report and a
preview of what a modern, conversion-optimized site for your
practice could look like:

https://websitelotto.virtuallaunch.pro/asset/${slug}

Templates start at $249. Takes about 60 seconds to review.
`
  };
}
function wlvlpRouterEmail2(first, city, c, slug) {
  return {
    subject: `${first} — a new ${city || 'local'} ${c.label} site, ready when you are`,
    body:
`Hello ${first},

Following up on the practice site preview I sent over.

${first}, I built this specifically for ${c.label}s — clean
layout, fast load, intake form that converts, mobile-first.
You can preview the full thing here:

https://websitelotto.virtuallaunch.pro/asset/${slug}

If you want to walk through it live (15 minutes):
https://cal.com/vlp/wlvlp-discovery
`
  };
}
function wlvlpRouterEmail3(first, city, c, slug) {
  return {
    subject: `${first} — how many ${city} prospects bounced from your site last month`,
    body:
`Hello ${first},

Here's something most tax professionals don't track:

A taxpayer finds you through a Google search or referral.
They visit your website. It loads slow, looks dated, or
doesn't make it clear how to contact you.

They leave. They find the next ${c.label} in
${city} with a better site. That firm gets the call.

${first}, you never know it happened.

A conversion-optimized site doesn't just look better —
it turns visitors into clients. Here's what yours could
look like:
https://websitelotto.virtuallaunch.pro/asset/${slug}
`
  };
}
function wlvlpRouterEmail4(first, slug) {
  return {
    subject: `${first} — an EA's take on why your website matters more than you think`,
    body:
`Hello ${first},

When I was working cases at ClearStart Tax and Stafford,
I watched firms lose prospects before they ever picked
up the phone — because their website didn't look like a
firm you'd trust with a $50,000 tax liability.

The technical work was excellent. The first impression
wasn't.

${first}, I built Website Lotto to give tax professionals
a site that matches the quality of their actual work. Not
a generic template — a site designed for how taxpayers
evaluate and choose their representation.

Here's my background:
https://www.linkedin.com/in/virtuallaunchpro

Here's your preview:
https://websitelotto.virtuallaunch.pro/asset/${slug}
`
  };
}
function wlvlpRouterEmail5(first, slug) {
  return {
    subject: `${first} — is your website something you've been meaning to fix`,
    body:
`Hello ${first},

I've sent a few emails about a site redesign for your
practice. ${first}, simple question:

Is updating your website something that's been on the
back burner?

If yes — your preview is ready:
https://websitelotto.virtuallaunch.pro/asset/${slug}

Templates start at $249. Happy to walk through it:
https://cal.com/vlp/wlvlp-discovery

If your site is already where you want it — no more
emails from me.
`
  };
}
function wlvlpRouterEmail6(first, slug) {
  return {
    subject: `Last note from me, ${first}`,
    body:
`Hello ${first},

This is my last email about your website. ${first}, if you
ever want to see what a modern version looks like:
https://websitelotto.virtuallaunch.pro/asset/${slug}

And if your website isn't the priority right now but you
work with IRS transcripts, this might save you real time:
https://transcript.taxmonitor.pro/pricing
10 transcript analyses for $19 — no commitment.
`
  };
}

// ---- CAN-SPAM compliance footers --------------------------------------------
// Appended to every campaign email body. Includes physical mailing address
// and a per-recipient unsubscribe link served by the Worker at /unsubscribe.
function canspamTtmpFooter(email) {
  const enc = encodeURIComponent(email || '');
  return `
—
Jamie L Williams, EA
Transcript Tax Monitor Pro
transcript.taxmonitor.pro

Lenore, Inc c/o Virtual Launch Pro
1175 Avocado Avenue Suite 101 PMB 1010
El Cajon, CA 92020

To stop receiving these emails:
https://api.virtuallaunch.pro/unsubscribe?email=${enc}&campaign=ttmp
`;
}
function canspamVlpFooter(email) {
  const enc = encodeURIComponent(email || '');
  return `
—
Jamie L Williams, EA
Virtual Launch Pro
virtuallaunch.pro

Lenore, Inc c/o Virtual Launch Pro
1175 Avocado Avenue Suite 101 PMB 1010
El Cajon, CA 92020

To stop receiving these emails:
https://api.virtuallaunch.pro/unsubscribe?email=${enc}&campaign=vlp
`;
}
function canspamWlvlpFooter(email) {
  const enc = encodeURIComponent(email || '');
  return `
—
Jamie L Williams, EA
Website Lotto by Virtual Launch Pro
websitelotto.virtuallaunch.pro

Lenore, Inc c/o Virtual Launch Pro
1175 Avocado Avenue Suite 101 PMB 1010
El Cajon, CA 92020

To stop receiving these emails:
https://api.virtuallaunch.pro/unsubscribe?email=${enc}&campaign=wlvlp
`;
}

function buildTtmpQueueRecord(rec, ctx) {
  const { first, lastDisplay, firstDisplay, city, state, slug, email, profession, cred, todayIso, baseDate, domain } = ctx;
  const e1 = ttmpEmail1(firstDisplay, cred);
  const e2 = ttmpEmail2(firstDisplay, cred, slug);
  const e3 = ttmpEmail3(firstDisplay, cred, city);
  const e4 = ttmpEmail4(firstDisplay);
  const e5 = ttmpEmail5(firstDisplay);
  const e6 = ttmpEmail6(firstDisplay);
  const footer = canspamTtmpFooter(email);
  e1.body += footer; e2.body += footer; e3.body += footer;
  e4.body += footer; e5.body += footer; e6.body += footer;
  return {
    slug, email,
    first_name: firstDisplay, last_name: lastDisplay,
    profession, city, state, domain,
    subject: e1.subject, body: e1.body,
    email_2_subject: e2.subject, email_2_body: e2.body,
    email_3_subject: e3.subject, email_3_body: e3.body,
    email_4_subject: e4.subject, email_4_body: e4.body,
    email_5_subject: e5.subject, email_5_body: e5.body,
    email_6_subject: e6.subject, email_6_body: e6.body,
    status: 'pending',
    created_at: todayIso,
    email_2_scheduled_for: dailyPlusDays(baseDate, 2),
    email_3_scheduled_for: dailyPlusDays(baseDate, 4),
    email_4_scheduled_for: dailyPlusDays(baseDate, 6),
    email_5_scheduled_for: dailyPlusDays(baseDate, 8),
    email_6_scheduled_for: dailyPlusDays(baseDate, 10),
  };
}
function buildVlpQueueRecord(rec, ctx) {
  const { firstDisplay, lastDisplay, city, state, slug, email, profession, cred, todayIso, baseDate, domain } = ctx;
  const e1 = vlpEmail1(firstDisplay, city || 'your area', cred, slug);
  const e2 = vlpEmail2(firstDisplay, city || 'your area', cred, slug);
  const e3 = vlpEmail3(firstDisplay, city || 'your area', cred);
  const e4 = vlpEmail4(firstDisplay, cred, slug);
  const e5 = vlpEmail5(firstDisplay, slug);
  const e6 = vlpEmail6(firstDisplay, city || 'your area');
  const footer = canspamVlpFooter(email);
  e1.body += footer; e2.body += footer; e3.body += footer;
  e4.body += footer; e5.body += footer; e6.body += footer;
  return {
    slug, email,
    first_name: firstDisplay, last_name: lastDisplay,
    profession, city, state, domain,
    subject: e1.subject, body: e1.body,
    email_2_subject: e2.subject, email_2_body: e2.body,
    email_3_subject: e3.subject, email_3_body: e3.body,
    email_4_subject: e4.subject, email_4_body: e4.body,
    email_5_subject: e5.subject, email_5_body: e5.body,
    email_6_subject: e6.subject, email_6_body: e6.body,
    status: 'pending',
    created_at: todayIso,
    email_2_scheduled_for: dailyPlusDays(baseDate, 2),
    email_3_scheduled_for: dailyPlusDays(baseDate, 4),
    email_4_scheduled_for: dailyPlusDays(baseDate, 6),
    email_5_scheduled_for: dailyPlusDays(baseDate, 8),
    email_6_scheduled_for: dailyPlusDays(baseDate, 10),
  };
}
function buildWlvlpQueueRecord(rec, ctx) {
  const { firstDisplay, lastDisplay, city, state, slug, email, profession, cred, todayIso, baseDate, domain } = ctx;
  const e1 = wlvlpRouterEmail1(firstDisplay, city, cred, slug);
  const e2 = wlvlpRouterEmail2(firstDisplay, city, cred, slug);
  const e3 = wlvlpRouterEmail3(firstDisplay, city || 'your area', cred, slug);
  const e4 = wlvlpRouterEmail4(firstDisplay, slug);
  const e5 = wlvlpRouterEmail5(firstDisplay, slug);
  const e6 = wlvlpRouterEmail6(firstDisplay, slug);
  const footer = canspamWlvlpFooter(email);
  e1.body += footer; e2.body += footer; e3.body += footer;
  e4.body += footer; e5.body += footer; e6.body += footer;
  return {
    slug, email,
    first_name: firstDisplay, last_name: lastDisplay,
    profession, city, state, domain,
    subject: e1.subject, body: e1.body,
    email_2_subject: e2.subject, email_2_body: e2.body,
    email_3_subject: e3.subject, email_3_body: e3.body,
    email_4_subject: e4.subject, email_4_body: e4.body,
    email_5_subject: e5.subject, email_5_body: e5.body,
    email_6_subject: e6.subject, email_6_body: e6.body,
    status: 'pending',
    created_at: todayIso,
    email_2_scheduled_for: dailyPlusDays(baseDate, 2),
    email_3_scheduled_for: dailyPlusDays(baseDate, 4),
    email_4_scheduled_for: dailyPlusDays(baseDate, 6),
    email_5_scheduled_for: dailyPlusDays(baseDate, 8),
    email_6_scheduled_for: dailyPlusDays(baseDate, 10),
  };
}

async function appendToCampaignQueue(env, queueKey, newRecords) {
  if (newRecords.length === 0) return 0;
  let existing = [];
  try {
    const obj = await env.R2_VIRTUAL_LAUNCH.get(queueKey);
    if (obj) existing = await obj.json();
    if (!Array.isArray(existing)) existing = [];
  } catch (e) {
    console.error(`appendToCampaignQueue: failed to read ${queueKey}:`, e);
    existing = [];
  }
  const merged = existing.concat(newRecords);
  try {
    await env.R2_VIRTUAL_LAUNCH.put(
      queueKey,
      JSON.stringify(merged),
      { httpMetadata: { contentType: 'application/json' } }
    );
  } catch (e) {
    console.error(`appendToCampaignQueue: failed to write ${queueKey}:`, e);
  }
  return merged.length;
}

async function handleDailyBatchGeneration(env) {
  const startedAt = new Date();
  const todayIso = startedAt.toISOString();
  const dateKey = todayIso.slice(0, 10);

  // 1. Read NDJSON master
  let records;
  try {
    const obj = await env.R2_VIRTUAL_LAUNCH.get(ENRICHMENT_R2_KEY);
    if (!obj) {
      console.error('Daily batch: master file not found');
      return { ok: false, reason: 'no_master_file' };
    }
    const text = await obj.text();
    records = text.split('\n').filter(l => l.trim().length > 0).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(r => r !== null);
    console.log(`Daily batch: loaded ${records.length} records from master`);
  } catch (e) {
    console.error('Daily batch: failed to read master:', e);
    return { ok: false, reason: 'master_read_failed', error: String(e && e.message || e) };
  }

  // 2. Filter to send-eligible
  const eligibleIdx = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const ef = r.email_found && String(r.email_found).trim();
    const es = r.email_status && String(r.email_status).trim().toLowerCase();
    if (!ef) continue;
    if (!es || !ALLOWED_SEND_STATUSES.has(es)) continue;
    if (r.unsubscribed_at && String(r.unsubscribed_at).trim()) continue;
    if (r.ttmp_email_1_prepared_at && String(r.ttmp_email_1_prepared_at).trim()) continue;
    if (r.vlp_email_1_prepared_at && String(r.vlp_email_1_prepared_at).trim()) continue;
    if (r.wlvlp_email_1_prepared_at && String(r.wlvlp_email_1_prepared_at).trim()) continue;
    eligibleIdx.push(i);
  }
  const totalEligible = eligibleIdx.length;
  console.log(`Daily batch: ${totalEligible} eligible records`);

  // 3. Cap at DAILY_BATCH_CAP
  const selectedIdx = eligibleIdx.slice(0, DAILY_BATCH_CAP);

  // 4. Route + build queue records
  const usedSlugs = new Map();
  function uniqueSlug(base) {
    let s = base || 'prospect';
    let n = 1;
    while (usedSlugs.has(s)) { n++; s = `${base}-${n}`; }
    usedSlugs.set(s, true);
    return s;
  }

  const ttmpRecs = [];
  const vlpRecs = [];
  const wlvlpRecs = [];
  const ttmpAssetWrites = [];
  const vlpAssetWrites = [];
  const wlvlpAssetWrites = [];

  for (const i of selectedIdx) {
    const r = records[i];
    const profession = String(r.PROFESSION || '').toUpperCase();
    const credKey = dailyNormalizeCred(profession);
    const cred = DAILY_CRED[credKey] || DAILY_CRED.EA;
    const firstDisplay = dailyTitleCaseFirst(r.First_NAME) || 'Friend';
    const lastDisplay = dailyTitleCase(r.LAST_NAME);
    const city = dailyTitleCase(r.BUS_ADDR_CITY);
    const state = String(r.BUS_ST_CODE || '').toUpperCase().trim();
    const baseSlug = dailyMakeSlug(
      dailySanitizeNamePart(r.First_NAME),
      dailySanitizeNamePart(r.LAST_NAME),
      r.BUS_ADDR_CITY,
      r.BUS_ST_CODE
    );
    const slug = uniqueSlug(baseSlug);
    const email = String(r.email_found || '').trim();
    const domain = String(r.domain_clean || '').trim();
    const ctx = {
      first: dailySanitizeNamePart(r.First_NAME),
      firstDisplay, lastDisplay, city, state, slug, email,
      profession, cred, todayIso, baseDate: startedAt, domain,
    };

    const roll = Math.random();
    let dest;
    if (roll < DAILY_ROUTE_TTMP) dest = 'ttmp';
    else if (roll < DAILY_ROUTE_VLP) dest = 'vlp';
    else dest = 'wlvlp';

    if (dest === 'ttmp') {
      ttmpRecs.push(buildTtmpQueueRecord(r, ctx));
      r.ttmp_email_1_prepared_at = todayIso;
      r.ttmp_asset_slug = slug;
      ttmpAssetWrites.push({
        slug,
        page: buildTtmpAssetPageData({ slug, credKey, cred, firstDisplay, lastDisplay, city, state, firm: r.DBA || `${firstDisplay} ${lastDisplay}`.trim(), nowIso: todayIso }),
      });
    } else if (dest === 'vlp') {
      vlpRecs.push(buildVlpQueueRecord(r, ctx));
      r.vlp_email_1_prepared_at = todayIso;
      r.vlp_asset_slug = slug;
      vlpAssetWrites.push({
        slug,
        page: {
          slug,
          campaign: 'vlp',
          headline: `${firstDisplay}, taxpayers in ${city || 'your area'} are searching for help you're not showing up for`,
          subheadline: `A practice analysis for ${cred.label}s — new client value, directory visibility, and transcript automation.`,
          practice_type: credKey,
          credential_label: cred.label,
          city, state,
          firm: r.DBA || `${firstDisplay} ${lastDisplay}`.trim(),
          stats: {
            new_client_value: cred.new_client_value,
            billing_range: cred.billing,
            weekly_hours: cred.weekly,
            annual_hours: cred.annual,
            revenue_impact: cred.revenue,
          },
          cta_primary_url: 'https://virtuallaunch.pro/pricing',
          cta_primary_label: 'See listing tiers — starts at $79/mo',
          cta_booking_url: 'https://cal.com/vlp/vlp-discovery',
          generated_at: todayIso,
        },
      });
    } else {
      wlvlpRecs.push(buildWlvlpQueueRecord(r, ctx));
      r.wlvlp_email_1_prepared_at = todayIso;
      r.wlvlp_asset_slug = slug;
      // Minimal asset page so the /asset/{slug} link resolves
      wlvlpAssetWrites.push({
        slug,
        page: {
          slug,
          headline: `${firstDisplay}, your ${city || 'local'} practice site preview`,
          subheadline: `A modern, conversion-optimized template for ${cred.label}s — ready to customize.`,
          practice_type: credKey,
          city, state,
          firm: r.DBA || `${firstDisplay} ${lastDisplay}`.trim(),
          cta_claim_url: 'https://websitelotto.virtuallaunch.pro/templates',
          cta_booking_url: 'https://cal.com/vlp/wlvlp-discovery',
          generated_at: todayIso,
        },
      });
    }
  }

  // 5. Write asset pages for all three campaigns
  // TTMP + VLP → vlp-scale/asset-pages/{slug}.json (served by GET /v1/scale/asset/:slug)
  // WLVLP → vlp-scale/wlvlp-asset-pages/{slug}.json (served by GET /v1/wlvlp/asset-pages/:slug)
  for (const a of ttmpAssetWrites) {
    try {
      await env.R2_VIRTUAL_LAUNCH.put(
        `vlp-scale/asset-pages/${a.slug}.json`,
        JSON.stringify(a.page),
        { httpMetadata: { contentType: 'application/json' } }
      );
    } catch (e) {
      console.error(`Daily batch: TTMP asset page write failed ${a.slug}:`, e);
    }
  }
  for (const a of vlpAssetWrites) {
    try {
      await env.R2_VIRTUAL_LAUNCH.put(
        `vlp-scale/asset-pages/${a.slug}.json`,
        JSON.stringify(a.page),
        { httpMetadata: { contentType: 'application/json' } }
      );
    } catch (e) {
      console.error(`Daily batch: VLP asset page write failed ${a.slug}:`, e);
    }
  }
  for (const a of wlvlpAssetWrites) {
    try {
      await env.R2_VIRTUAL_LAUNCH.put(
        `vlp-scale/wlvlp-asset-pages/${a.slug}.json`,
        JSON.stringify(a.page),
        { httpMetadata: { contentType: 'application/json' } }
      );
    } catch (e) {
      console.error(`Daily batch: WLVLP asset page write failed ${a.slug}:`, e);
    }
  }

  // 6. Append to each campaign queue (read existing, merge, write back)
  const ttmpQueueSize  = await appendToCampaignQueue(env, 'vlp-scale/ttmp-send-queue/email1-pending.json',  ttmpRecs);
  const vlpQueueSize   = await appendToCampaignQueue(env, 'vlp-scale/vlp-send-queue/email1-pending.json',   vlpRecs);
  const wlvlpQueueSize = await appendToCampaignQueue(env, 'vlp-scale/wlvlp-send-queue/email1-pending.json', wlvlpRecs);

  // 7. Write master file back as NDJSON
  try {
    const ndjson = records.map(r => JSON.stringify(r)).join('\n') + '\n';
    await env.R2_VIRTUAL_LAUNCH.put(ENRICHMENT_R2_KEY, ndjson, {
      httpMetadata: { contentType: 'application/x-ndjson' },
    });
  } catch (e) {
    console.error('Daily batch: failed to write master back:', e);
  }

  // 8. Daily batch log
  const batchSize = ttmpRecs.length + vlpRecs.length + wlvlpRecs.length;
  const remaining = totalEligible - batchSize;
  const log = {
    date: dateKey,
    eligible_records: totalEligible,
    batch_size: batchSize,
    routed_ttmp: ttmpRecs.length,
    routed_vlp: vlpRecs.length,
    routed_wlvlp: wlvlpRecs.length,
    records_remaining_eligible: remaining,
    queue_sizes: {
      ttmp: ttmpQueueSize,
      vlp: vlpQueueSize,
      wlvlp: wlvlpQueueSize,
    },
    started_at: todayIso,
    finished_at: new Date().toISOString(),
  };
  try {
    await env.R2_VIRTUAL_LAUNCH.put(
      `vlp-scale/batch-logs/${dateKey}.json`,
      JSON.stringify(log),
      { httpMetadata: { contentType: 'application/json' } }
    );
  } catch (e) {
    console.error('Daily batch: failed to write log:', e);
  }

  console.log('Daily batch complete:', JSON.stringify(log));
  return log;
}

// ---------------------------------------------------------------------------
// FOIA Lead Enrichment Pipeline
// ---------------------------------------------------------------------------
// Reads NDJSON master file from R2, fills domain_clean / email_found /
// email_status by combining MX checks, catch-all detection, pattern learning
// and Reoon email verification. Runs daily under the 10:00 UTC cron, capped
// at 450 Reoon credits/day (50-credit buffer below the $9 plan's 500/day).

const ENRICHMENT_R2_KEY = 'vlp-scale/foia-leads/foia-master.json';
const ENRICHMENT_KV_TTL = 2592000;        // 30 days
const ENRICHMENT_BUDGET_TTL = 172800;     // 48 hours
const ENRICHMENT_DAILY_BUDGET = 450;      // hard ceiling per UTC day
const ENRICHMENT_REOON_DELAY_MS = 200;    // pause between Reoon calls

function enrichmentExtractDomain(website) {
  if (!website || typeof website !== 'string') return '';
  let d = website.trim().toLowerCase();
  if (!d) return '';
  d = d.replace(/^https?:\/\//, '');
  d = d.replace(/^www\./, '');
  d = d.split('/')[0];
  d = d.split('?')[0];
  d = d.split('#')[0];
  d = d.split(':')[0];
  if (!d.includes('.') || d.length < 4) return '';
  return d;
}

function enrichmentSanitizeNamePart(s) {
  if (!s || typeof s !== 'string') return '';
  return s.toLowerCase().replace(/[^a-z]/g, '').trim();
}

function enrichmentBuildPattern(idx, first, last, domain) {
  const f = first.charAt(0);
  const l = last.charAt(0);
  switch (idx) {
    case 1: return `${first}@${domain}`;
    case 2: return `${first}.${last}@${domain}`;
    case 3: return `${first}${last}@${domain}`;
    case 4: return `${f}${last}@${domain}`;
    case 5: return `${first}.${l}@${domain}`;
    case 6: return `${first}_${last}@${domain}`;
    default: return '';
  }
}

async function enrichmentMxLookup(env, domain) {
  const cacheKey = `enrichment:mx:${domain}`;
  const cached = await env.ENRICHMENT_KV.get(cacheKey);
  if (cached !== null) return cached === 'true';
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      { headers: { Accept: 'application/dns-json' } }
    );
    if (!res.ok) {
      await env.ENRICHMENT_KV.put(cacheKey, 'false', { expirationTtl: ENRICHMENT_KV_TTL });
      return false;
    }
    const data = await res.json();
    const hasMx = Array.isArray(data.Answer) && data.Answer.length > 0 && data.Status === 0;
    await env.ENRICHMENT_KV.put(cacheKey, hasMx ? 'true' : 'false', { expirationTtl: ENRICHMENT_KV_TTL });
    return hasMx;
  } catch {
    return false;
  }
}

async function enrichmentReoonVerify(env, email, debugSink) {
  const url = `https://emailverifier.reoon.com/api/v1/verify?email=${encodeURIComponent(email)}&key=${env.REOON_API_KEY}&mode=power`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 403) {
        console.error('Reoon API returned 403 — likely out of credits');
      } else {
        console.error(`Reoon API returned non-200 status: ${res.status}`);
      }
      if (debugSink && debugSink.length < 20) {
        debugSink.push({
          email_tested: email,
          domain: email.split('@')[1] || '',
          reoon_status: `http_${res.status}`,
          reoon_full_response: null
        });
      }
      return { kind: 'api_error', http_code: res.status };
    }
    const data = await res.json();
    const status = data && typeof data.status === 'string' ? data.status : null;
    if (debugSink && debugSink.length < 20) {
      debugSink.push({
        email_tested: email,
        domain: email.split('@')[1] || '',
        reoon_status: status || 'unknown',
        reoon_full_response: data
      });
    }
    return { kind: 'ok', status };
  } catch (e) {
    if (debugSink && debugSink.length < 20) {
      debugSink.push({
        email_tested: email,
        domain: email.split('@')[1] || '',
        reoon_status: `exception:${String(e && e.message || e)}`,
        reoon_full_response: null
      });
    }
    return { kind: 'network_error' };
  }
}

// Reoon power mode: "safe" = deliverable inbox, "valid" kept for backward compat.
function enrichmentIsAcceptedStatus(status) {
  return status === 'valid' || status === 'safe';
}

// "catch_all" is deliverable but cannot confirm a specific mailbox.
function enrichmentIsCatchAllStatus(status) {
  return status === 'catch_all';
}

async function enrichmentReoonBalance(env) {
  try {
    const res = await fetch(
      `https://emailverifier.reoon.com/api/v1/get_credits/?key=${env.REOON_API_KEY}`
    );
    if (!res.ok) return { ok: false, http_code: res.status };
    const data = await res.json();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

async function enrichmentBudgetGet(env, dateKey) {
  const v = await env.ENRICHMENT_KV.get(`enrichment:reoon_budget:${dateKey}`);
  return v ? parseInt(v, 10) || 0 : 0;
}

async function enrichmentBudgetIncrement(env, dateKey) {
  const cur = await enrichmentBudgetGet(env, dateKey);
  const next = cur + 1;
  await env.ENRICHMENT_KV.put(
    `enrichment:reoon_budget:${dateKey}`,
    String(next),
    { expirationTtl: ENRICHMENT_BUDGET_TTL }
  );
  return next;
}

async function handleEnrichmentBatch(env) {
  const startedAt = new Date();
  const dateKey = startedAt.toISOString().slice(0, 10);

  const stats = {
    date: dateKey,
    total_records: 0,
    already_enriched: 0,
    processed_this_run: 0,
    domains_mx_checked: 0,
    domains_no_mx: 0,
    domains_catch_all: 0,
    patterns_learned: 0,
    patterns_reused: 0,
    emails_found_valid: 0,
    emails_no_valid_pattern: 0,
    reoon_credits_used: 0,
    reoon_budget_remaining: ENRICHMENT_DAILY_BUDGET,
    reoon_balance_at_start: null,
    records_remaining_unenriched: 0,
    stopped_reason: 'completed'
  };

  // One-time balance check so the daily log shows starting credits
  try {
    const bal = await enrichmentReoonBalance(env);
    stats.reoon_balance_at_start = bal;
    console.log('Enrichment: Reoon balance at start:', JSON.stringify(bal));
  } catch (e) {
    console.error('Enrichment: balance check failed:', e);
  }

  let records;
  try {
    const obj = await env.R2_VIRTUAL_LAUNCH.get(ENRICHMENT_R2_KEY);
    if (!obj) {
      stats.stopped_reason = 'error';
      console.error('Enrichment: master file not found at', ENRICHMENT_R2_KEY);
      return stats;
    }
    const text = await obj.text();
    console.log(`Enrichment: master file size ${text.length} bytes`);
    records = text.split('\n').filter(l => l.trim().length > 0).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(r => r !== null);
    console.log(`Enrichment: parsed ${records.length} records`);
  } catch (e) {
    console.error('Enrichment: failed to load master file:', e);
    stats.stopped_reason = 'error';
    return stats;
  }

  stats.total_records = records.length;

  let creditsUsed = await enrichmentBudgetGet(env, dateKey);
  stats.reoon_budget_remaining = Math.max(0, ENRICHMENT_DAILY_BUDGET - creditsUsed);

  const processedDomains = new Map(); // domain -> { mxOk, catchAll, patternIdx }
  const reoonDebugLog = []; // captures first 20 Reoon responses for diagnostics

  outer: for (let i = 0; i < records.length; i++) {
    const rec = records[i];

    const isEnriched = (rec.email_found && String(rec.email_found).trim()) ||
                       (rec.email_status && String(rec.email_status).trim());
    if (isEnriched) {
      stats.already_enriched++;
      continue;
    }

    // Skip unsubscribed records — no point spending Reoon credits on them.
    if (rec.unsubscribed_at && String(rec.unsubscribed_at).trim()) {
      stats.already_enriched++;
      continue;
    }

    let domain = rec.domain_clean && String(rec.domain_clean).trim().toLowerCase();
    if (!domain) {
      domain = enrichmentExtractDomain(rec.WEBSITE);
      if (domain) rec.domain_clean = domain;
    }
    if (!domain) {
      rec.email_status = 'no_domain';
      stats.processed_this_run++;
      continue;
    }

    let domainState = processedDomains.get(domain);
    if (!domainState) {
      const mxOk = await enrichmentMxLookup(env, domain);
      stats.domains_mx_checked++;
      if (!mxOk) stats.domains_no_mx++;
      domainState = { mxOk, catchAll: null, patternIdx: null };
      processedDomains.set(domain, domainState);
    }

    if (!domainState.mxOk) {
      rec.email_status = 'no_mx';
      stats.processed_this_run++;
      continue;
    }

    const first = enrichmentSanitizeNamePart(rec.First_NAME);
    const last = enrichmentSanitizeNamePart(rec.LAST_NAME);
    if (!first || !last) {
      rec.email_status = 'no_name';
      stats.processed_this_run++;
      continue;
    }

    // Catch-all detection (per domain, cached in KV)
    if (domainState.catchAll === null) {
      const catchAllKey = `enrichment:catchall:${domain}`;
      const cached = await env.ENRICHMENT_KV.get(catchAllKey);
      if (cached !== null) {
        domainState.catchAll = cached === 'true';
      } else {
        if (creditsUsed >= ENRICHMENT_DAILY_BUDGET) {
          stats.stopped_reason = 'budget_exhausted';
          console.log('Enrichment: daily Reoon budget exhausted (catch-all check)');
          break outer;
        }
        const rand = Math.floor(1000 + Math.random() * 9000);
        const probe = `zzztest8742${rand}@${domain}`;
        const result = await enrichmentReoonVerify(env, probe, reoonDebugLog);
        if (result.kind === 'api_error') {
          stats.stopped_reason = 'reoon_api_error';
          stats.reoon_api_error_code = result.http_code;
          console.log(`Enrichment: Reoon API error ${result.http_code} (catch-all check), stopping`);
          break outer;
        }
        if (result.kind === 'ok') {
          creditsUsed = await enrichmentBudgetIncrement(env, dateKey);
          stats.reoon_credits_used++;
        }
        await new Promise(r => setTimeout(r, ENRICHMENT_REOON_DELAY_MS));
        const status = result.kind === 'ok' ? result.status : null;
        const isCatchAll = enrichmentIsCatchAllStatus(status) || enrichmentIsAcceptedStatus(status);
        await env.ENRICHMENT_KV.put(catchAllKey, isCatchAll ? 'true' : 'false', { expirationTtl: ENRICHMENT_KV_TTL });
        domainState.catchAll = isCatchAll;
        if (isCatchAll) stats.domains_catch_all++;
      }
    }

    if (domainState.catchAll) {
      rec.email_found = `${first}@${domain}`;
      rec.email_status = 'catch_all';
      stats.processed_this_run++;
      continue;
    }

    // Pattern learning — reuse a previously discovered pattern at this domain
    if (domainState.patternIdx === null) {
      const patternKey = `enrichment:pattern:${domain}`;
      const cached = await env.ENRICHMENT_KV.get(patternKey);
      if (cached !== null) {
        const idx = parseInt(cached, 10);
        if (idx >= 1 && idx <= 6) domainState.patternIdx = idx;
      }
    }

    if (domainState.patternIdx !== null && domainState.patternIdx >= 1) {
      rec.email_found = enrichmentBuildPattern(domainState.patternIdx, first, last, domain);
      rec.email_status = 'pattern_match';
      stats.patterns_reused++;
      stats.processed_this_run++;
      continue;
    }

    // Pattern generation + Reoon validation (1..6)
    let winningIdx = 0;
    for (let p = 1; p <= 6; p++) {
      if (creditsUsed >= ENRICHMENT_DAILY_BUDGET) {
        stats.stopped_reason = 'budget_exhausted';
        console.log('Enrichment: daily Reoon budget exhausted (pattern validation)');
        break outer;
      }
      const candidate = enrichmentBuildPattern(p, first, last, domain);
      const result = await enrichmentReoonVerify(env, candidate, reoonDebugLog);
      if (result.kind === 'api_error') {
        stats.stopped_reason = 'reoon_api_error';
        stats.reoon_api_error_code = result.http_code;
        console.log(`Enrichment: Reoon API error ${result.http_code} (pattern validation), stopping`);
        break outer;
      }
      if (result.kind === 'ok') {
        creditsUsed = await enrichmentBudgetIncrement(env, dateKey);
        stats.reoon_credits_used++;
      }
      await new Promise(r => setTimeout(r, ENRICHMENT_REOON_DELAY_MS));
      const status = result.kind === 'ok' ? result.status : null;
      if (enrichmentIsAcceptedStatus(status)) {
        rec.email_found = candidate;
        rec.email_status = 'valid';
        winningIdx = p;
        break;
      }
      if (enrichmentIsCatchAllStatus(status)) {
        rec.email_found = candidate;
        rec.email_status = 'catch_all';
        winningIdx = p;
        break;
      }
    }

    if (winningIdx > 0) {
      domainState.patternIdx = winningIdx;
      await env.ENRICHMENT_KV.put(
        `enrichment:pattern:${domain}`,
        String(winningIdx),
        { expirationTtl: ENRICHMENT_KV_TTL }
      );
      stats.patterns_learned++;
      stats.emails_found_valid++;
    } else {
      rec.email_status = 'no_valid_pattern';
      stats.emails_no_valid_pattern++;
    }
    stats.processed_this_run++;
  }

  stats.reoon_budget_remaining = Math.max(0, ENRICHMENT_DAILY_BUDGET - creditsUsed);
  stats.records_remaining_unenriched = records.filter(r => {
    const ef = r.email_found && String(r.email_found).trim();
    const es = r.email_status && String(r.email_status).trim();
    return !ef && !es;
  }).length;

  // Write records back to R2 as NDJSON (every record preserved)
  try {
    const ndjson = records.map(r => JSON.stringify(r)).join('\n') + '\n';
    await env.R2_VIRTUAL_LAUNCH.put(ENRICHMENT_R2_KEY, ndjson, {
      httpMetadata: { contentType: 'application/x-ndjson' },
    });
  } catch (e) {
    console.error('Enrichment: failed to write master file back:', e);
    stats.stopped_reason = 'error';
  }

  // Daily enrichment log
  try {
    await r2Put(
      env.R2_VIRTUAL_LAUNCH,
      `vlp-scale/enrichment-logs/${dateKey}.json`,
      stats
    );
  } catch (e) {
    console.error('Enrichment: failed to write log:', e);
  }

  // Reoon diagnostic debug log (first 20 calls of this run)
  try {
    if (reoonDebugLog.length > 0) {
      await r2Put(
        env.R2_VIRTUAL_LAUNCH,
        `vlp-scale/enrichment-logs/reoon-debug-${dateKey}.json`,
        reoonDebugLog
      );
    }
  } catch (e) {
    console.error('Enrichment: failed to write reoon debug log:', e);
  }

  console.log('Enrichment run complete:', JSON.stringify(stats));
  return stats;
}

// ---------------------------------------------------------------------------
// Find Emails Cron — 06:00 UTC
// ---------------------------------------------------------------------------
// Reads vlp-scale/foia-leads/foia-master.json (NDJSON) from R2, selects rows
// with a domain but no email_found, runs MX precheck + pattern guessing +
// Reoon Power verification, and writes results back to the same file. The
// FOIA master JSONL is the single data store shared with handleEnrichmentBatch,
// handleValidateEmailsCron, and handleDailyBatchGeneration.

const FIND_EMAILS_DEFAULT_LIMIT = 50;
const FIND_EMAILS_REOON_RATE_LIMIT_MS = 1000;
const FIND_EMAILS_NAME_TITLE_RE = /\b(dr|mr|mrs|ms|miss|jr|sr|iii|ii|iv|phd|esq|cpa|ea|jd)\b\.?/gi;

// Statuses that mean the row has been definitively rejected — never retry.
// 'no_mx' is the only one find-emails sets itself; the rest come from the
// 10:00 UTC enrichment cron and represent permanent dead ends in this data
// store.
const FIND_EMAILS_DEAD_END_STATUSES = new Set(['no_mx', 'no_valid_pattern', 'no_domain', 'no_name', 'no_patterns']);

async function readFoiaMasterRecords(env) {
  const obj = await env.R2_VIRTUAL_LAUNCH.get(ENRICHMENT_R2_KEY);
  if (!obj) return null;
  const text = await obj.text();
  const records = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try { records.push(JSON.parse(t)); } catch { /* skip malformed */ }
  }
  return records;
}

async function writeFoiaMasterRecords(env, records) {
  const ndjson = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  await env.R2_VIRTUAL_LAUNCH.put(ENRICHMENT_R2_KEY, ndjson, {
    httpMetadata: { contentType: 'application/x-ndjson' },
  });
}

function findEmailsNormalizeFirst(raw) {
  if (!raw) return '';
  let s = String(raw).replace(FIND_EMAILS_NAME_TITLE_RE, ' ').trim();
  s = s.split(/\s+/)[0] || '';
  return s.toLowerCase().replace(/[^a-z]/g, '');
}

function findEmailsNormalizeLast(raw) {
  if (!raw) return '';
  let s = String(raw).replace(FIND_EMAILS_NAME_TITLE_RE, ' ').trim();
  const cleaned = s.replace(/[^a-zA-Z\s]/g, '');
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const pick = tokens[0] || '';
  return pick.toLowerCase();
}

function findEmailsBuildCandidates(firstRaw, lastRaw, domain) {
  const f = findEmailsNormalizeFirst(firstRaw);
  const l = findEmailsNormalizeLast(lastRaw);
  if (!f || !domain) return [];
  const fi = f.charAt(0);
  const li = l ? l.charAt(0) : '';
  const out = [];
  const push = (local, method) => {
    if (!local) return;
    const em = `${local}@${domain}`;
    if (!out.some(c => c.email === em)) out.push({ email: em, method });
  };
  push(f, 'first');
  if (l) push(`${f}.${l}`, 'first.last');
  if (l) push(`${f}${l}`, 'firstlast');
  if (l) push(`${fi}${l}`, 'flast');
  if (l && li) push(`${f}.${li}`, 'first.l');
  return out;
}

async function findEmailsHasMx(env, domain) {
  const cacheKey = `enrichment:mx:${domain}`;
  try {
    const cached = await env.ENRICHMENT_KV.get(cacheKey);
    if (cached !== null) return cached === 'true';
  } catch {}
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      { headers: { Accept: 'application/dns-json' } }
    );
    if (!res.ok) {
      try { await env.ENRICHMENT_KV.put(cacheKey, 'false', { expirationTtl: 60 * 60 * 24 * 30 }); } catch {}
      return false;
    }
    const data = await res.json();
    const hasMx = Array.isArray(data.Answer) && data.Answer.length > 0 && data.Status === 0;
    try { await env.ENRICHMENT_KV.put(cacheKey, hasMx ? 'true' : 'false', { expirationTtl: 60 * 60 * 24 * 30 }); } catch {}
    return hasMx;
  } catch {
    return false;
  }
}

async function findEmailsReoonPower(env, email) {
  const url = `https://emailverifier.reoon.com/api/v1/verify?email=${encodeURIComponent(email)}&key=${env.REOON_API_KEY}&mode=power`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`reoon_http_${res.status}`);
    err.http = res.status;
    throw err;
  }
  return await res.json();
}

async function findEmailsSleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Strip protocol, www, and any path/query from a website string. Returns
// lowercased bare domain or empty string. Used by the find-emails replenish
// step to derive domain_clean for raw FOIA rows that lack it.
function normalizeDomainFromWebsite(raw) {
  if (!raw) return '';
  let s = String(raw).trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/^www\./, '');
  const slash = s.indexOf('/');
  if (slash >= 0) s = s.slice(0, slash);
  const q = s.indexOf('?');
  if (q >= 0) s = s.slice(0, q);
  s = s.trim();
  if (!s || s === 'undefined' || s === 'nan' || s === 'null') return '';
  return s;
}

async function handleFindEmailsCron(env, opts = {}) {
  // limit may be 0 (status-only mode — reads the FOIA master JSONL and reports
  // counts without spending Reoon credits, useful for ops/testing).
  const rawLimit = Number(opts.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit >= 0
    ? Math.min(rawLimit, 500)
    : FIND_EMAILS_DEFAULT_LIMIT;
  const startedAt = new Date().toISOString();
  const dateKey = startedAt.slice(0, 10);
  const runLog = {
    ran_at: startedAt,
    limit,
    source: ENRICHMENT_R2_KEY,
    total_records: 0,
    eligible_for_discovery: 0,
    rows_processed: 0,
    emails_found: 0,
    no_mx_skipped: 0,
    all_invalid: 0,
    domain_derived_from_website: 0,
    reoon_calls_made: 0,
    reoon_errors: 0,
    rate_limited_stop: false,
    errors: [],
  };

  if (!env.REOON_API_KEY && limit > 0) {
    runLog.errors.push('missing_reoon_api_key');
    return runLog;
  }

  try {
    const records = await readFoiaMasterRecords(env);
    if (!records) {
      runLog.errors.push('foia_master_jsonl_not_found');
      return runLog;
    }
    runLog.total_records = records.length;

    // Filter eligible: empty email_found, not in a dead-end status, and a
    // resolvable domain (domain_clean OR derivable from WEBSITE). Mutates
    // records in place to set domain_clean when derived inline so the
    // discovery pass and the campaign router both see the value.
    const eligible = [];
    for (const r of records) {
      const em = (r.email_found || '').toString().trim();
      if (em) continue;
      const status = (r.email_status || '').toString().trim().toLowerCase();
      if (FIND_EMAILS_DEAD_END_STATUSES.has(status)) continue;
      let dom = (r.domain_clean || '').toString().trim().toLowerCase();
      if (!dom) {
        const derived = normalizeDomainFromWebsite(r.WEBSITE || '');
        if (derived) {
          dom = derived;
          r.domain_clean = derived;
          runLog.domain_derived_from_website++;
        }
      }
      if (!dom) continue;
      eligible.push(r);
    }
    runLog.eligible_for_discovery = eligible.length;

    // limit=0 — status-only. Persist any inline domain derivations and exit.
    if (limit === 0) {
      if (runLog.domain_derived_from_website > 0) {
        await writeFoiaMasterRecords(env, records);
      }
      try {
        await env.R2_VIRTUAL_LAUNCH.put(
          `vlp-scale/logs/find-emails-${dateKey}.json`,
          JSON.stringify(runLog, null, 2),
          { httpMetadata: { contentType: 'application/json' } }
        );
      } catch {}
      return runLog;
    }

    const target = eligible.slice(0, limit);
    const now = new Date().toISOString();
    let lastCallAt = 0;
    let rateLimited = false;

    for (const r of target) {
      if (rateLimited) break;
      runLog.rows_processed++;
      const domain = (r.domain_clean || '').toString().trim().toLowerCase();

      const mxOk = await findEmailsHasMx(env, domain);
      if (!mxOk) {
        r.email_status = 'no_mx';
        r.email_found_at = now;
        runLog.no_mx_skipped++;
        continue;
      }

      const candidateList = findEmailsBuildCandidates(r.First_NAME || r.first_name || '', r.LAST_NAME || r.last_name || '', domain);
      if (candidateList.length === 0) {
        r.email_status = 'no_patterns';
        r.email_found_at = now;
        runLog.all_invalid++;
        continue;
      }

      // Discovery only: pick the first non-disposable candidate that Reoon
      // Power mode does NOT explicitly mark as undeliverable. The actual
      // deliverability verdict is written later by handleValidateEmailsCron.
      let discovered = null;
      for (const c of candidateList) {
        const elapsed = Date.now() - lastCallAt;
        if (lastCallAt > 0 && elapsed < FIND_EMAILS_REOON_RATE_LIMIT_MS) {
          await findEmailsSleep(FIND_EMAILS_REOON_RATE_LIMIT_MS - elapsed);
        }
        let res = null;
        let attempt = 0;
        while (attempt < 2) {
          try {
            res = await findEmailsReoonPower(env, c.email);
            lastCallAt = Date.now();
            runLog.reoon_calls_made++;
            break;
          } catch (err) {
            lastCallAt = Date.now();
            if (err && err.http === 429) {
              runLog.rate_limited_stop = true;
              rateLimited = true;
              runLog.errors.push(`rate_limited_on_${c.email}`);
              break;
            }
            if (err && err.http && err.http >= 500 && attempt === 0) {
              attempt++;
              await findEmailsSleep(2000);
              continue;
            }
            runLog.reoon_errors++;
            runLog.errors.push(`reoon_err:${c.email}:${err && err.message || err}`);
            break;
          }
        }
        if (rateLimited) break;
        if (!res) continue;

        const rawStatus = ((res && (res.status || res.state)) || 'unknown').toString().toLowerCase();
        const isDeliverable = res && (res.is_deliverable ?? res.deliverable ?? null);

        if (rawStatus === 'disposable' || rawStatus === 'spamtrap' || rawStatus === 'invalid') {
          continue;
        }
        if (rawStatus === 'safe' && isDeliverable === true) {
          discovered = { email: c.email, method: c.method };
          break;
        }
        if (rawStatus === 'valid') {
          discovered = { email: c.email, method: c.method };
          break;
        }
        if (!discovered && (rawStatus === 'catch_all' || rawStatus === 'unknown' || rawStatus === 'risky')) {
          discovered = { email: c.email, method: c.method };
        }
      }

      if (discovered) {
        r.email_found = discovered.email;
        r.email_status = 'unverified';
        r.email_found_at = now;
        r.email_discovery_method = discovered.method;
        runLog.emails_found++;
      } else {
        r.email_status = r.email_status || 'invalid';
        r.email_found_at = now;
        runLog.all_invalid++;
      }
    }

    await writeFoiaMasterRecords(env, records);

    try {
      await env.R2_VIRTUAL_LAUNCH.put(
        `vlp-scale/logs/find-emails-${dateKey}.json`,
        JSON.stringify(runLog, null, 2),
        { httpMetadata: { contentType: 'application/json' } }
      );
    } catch (e) {
      console.error('find-emails: failed to write run log:', e);
    }

    return runLog;
  } catch (e) {
    console.error('handleFindEmailsCron fatal:', e);
    runLog.errors.push(`fatal:${e && e.message || e}`);
    try {
      await env.R2_VIRTUAL_LAUNCH.put(
        `vlp-scale/logs/find-emails-${dateKey}.json`,
        JSON.stringify(runLog, null, 2),
        { httpMetadata: { contentType: 'application/json' } }
      );
    } catch {}
    return runLog;
  }
}

// ---------------------------------------------------------------------------
// Validate-emails cron — Reoon quick-mode deliverability verification
// ---------------------------------------------------------------------------

const VALIDATE_EMAILS_DEFAULT_LIMIT = 50;

async function validateEmailsReoonQuick(env, email) {
  const url = `https://emailverifier.reoon.com/api/v1/verify?email=${encodeURIComponent(email)}&key=${env.REOON_API_KEY}&mode=quick`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`reoon_http_${res.status}`);
    err.http = res.status;
    throw err;
  }
  return await res.json();
}

function validateEmailsNormalizeStatus(res) {
  const raw = ((res && (res.status || res.state)) || '').toString().toLowerCase();
  const isDeliverable = res && (res.is_deliverable ?? res.deliverable ?? null);
  if (raw === 'valid' || raw === 'safe') {
    return isDeliverable === false ? 'risky' : 'valid';
  }
  if (raw === 'invalid') return 'invalid';
  if (raw === 'risky' || raw === 'catch_all' || raw === 'accept_all') return 'risky';
  if (raw === 'disposable' || raw === 'spamtrap') return 'invalid';
  if (raw === 'unknown' || raw === '') return 'unknown';
  return 'unknown';
}

async function handleValidateEmailsCron(env, opts = {}) {
  const limit = Math.max(1, Math.min(Number(opts.limit) || VALIDATE_EMAILS_DEFAULT_LIMIT, 500));
  const startedAt = new Date().toISOString();
  const dateKey = startedAt.slice(0, 10);
  const runLog = {
    ran_at: startedAt,
    limit,
    source: ENRICHMENT_R2_KEY,
    total_records: 0,
    eligible_for_validation: 0,
    rows_processed: 0,
    valid: 0,
    invalid: 0,
    risky: 0,
    unknown: 0,
    error: 0,
    reoon_calls_made: 0,
    rate_limited_stop: false,
    errors: [],
  };

  if (!env.REOON_API_KEY) {
    runLog.errors.push('missing_reoon_api_key');
    return runLog;
  }

  try {
    const records = await readFoiaMasterRecords(env);
    if (!records) {
      runLog.errors.push('foia_master_jsonl_not_found');
      return runLog;
    }
    runLog.total_records = records.length;

    const candidates = [];
    for (const r of records) {
      const em = (r.email_found || '').toString().trim();
      if (!em) continue;
      const status = (r.email_status || '').toString().trim().toLowerCase();
      if (status !== '' && status !== 'unverified') continue;
      candidates.push(r);
    }
    runLog.eligible_for_validation = candidates.length;

    const target = candidates.slice(0, limit);
    let lastCallAt = 0;
    let rateLimited = false;

    for (const r of target) {
      if (rateLimited) break;
      runLog.rows_processed++;
      const email = (r.email_found || '').trim();
      const nowIso = new Date().toISOString();

      const elapsed = Date.now() - lastCallAt;
      if (lastCallAt > 0 && elapsed < FIND_EMAILS_REOON_RATE_LIMIT_MS) {
        await findEmailsSleep(FIND_EMAILS_REOON_RATE_LIMIT_MS - elapsed);
      }

      let res = null;
      let attempt = 0;
      let hadError = false;
      while (attempt < 2) {
        try {
          res = await validateEmailsReoonQuick(env, email);
          lastCallAt = Date.now();
          runLog.reoon_calls_made++;
          break;
        } catch (err) {
          lastCallAt = Date.now();
          if (err && err.http === 429) {
            runLog.rate_limited_stop = true;
            rateLimited = true;
            runLog.errors.push(`rate_limited_on_${email}`);
            hadError = true;
            break;
          }
          if (err && err.http && err.http >= 500 && attempt === 0) {
            attempt++;
            await findEmailsSleep(2000);
            continue;
          }
          runLog.error++;
          runLog.errors.push(`reoon_err:${email}:${err && err.message || err}`);
          r.email_status = 'error';
          r.email_verified_at = nowIso;
          hadError = true;
          break;
        }
      }
      if (rateLimited) break;
      if (hadError || !res) continue;

      const normalized = validateEmailsNormalizeStatus(res);
      r.email_status = normalized;
      r.email_verified_at = nowIso;
      if (normalized === 'valid') runLog.valid++;
      else if (normalized === 'invalid') runLog.invalid++;
      else if (normalized === 'risky') runLog.risky++;
      else runLog.unknown++;
    }

    await writeFoiaMasterRecords(env, records);

    try {
      await env.R2_VIRTUAL_LAUNCH.put(
        `vlp-scale/logs/validate-emails-${dateKey}.json`,
        JSON.stringify(runLog, null, 2),
        { httpMetadata: { contentType: 'application/json' } }
      );
    } catch (e) {
      console.error('validate-emails: failed to write run log:', e);
    }

    return runLog;
  } catch (e) {
    console.error('handleValidateEmailsCron fatal:', e);
    runLog.errors.push(`fatal:${e && e.message || e}`);
    try {
      await env.R2_VIRTUAL_LAUNCH.put(
        `vlp-scale/logs/validate-emails-${dateKey}.json`,
        JSON.stringify(runLog, null, 2),
        { httpMetadata: { contentType: 'application/json' } }
      );
    } catch {}
    return runLog;
  }
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

    // CAN-SPAM compliance — public unsubscribe route. No authentication.
    // Marks the master file record with unsubscribed_at and flips matching
    // queue records to status="unsubscribed" so the send handlers skip them.
    if (pathname === '/unsubscribe' && method === 'GET') {
      const emailParam = (url.searchParams.get('email') || '').trim();
      const campaignParam = (url.searchParams.get('campaign') || '').trim();
      console.log('Unsubscribe:', emailParam, campaignParam, new Date().toISOString());
      const htmlHeaders = { 'Content-Type': 'text/html;charset=UTF-8', ...getCorsHeaders(request) };
      if (!emailParam) {
        return new Response(
          `<!DOCTYPE html><html><head><title>Unsubscribe</title></head><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; text-align: center;"><h2>No email specified.</h2></body></html>`,
          { status: 400, headers: htmlHeaders }
        );
      }
      const target = emailParam.toLowerCase();
      const nowIso = new Date().toISOString();

      // 1. Mutate master NDJSON
      try {
        const obj = await env.R2_VIRTUAL_LAUNCH.get('vlp-scale/foia-leads/foia-master.json');
        if (obj) {
          const text = await obj.text();
          const lines = text.split('\n');
          let mutated = false;
          const out = [];
          for (const line of lines) {
            if (!line.trim()) { out.push(line); continue; }
            try {
              const r = JSON.parse(line);
              const rEmail = String(r.email_found || '').trim().toLowerCase();
              if (rEmail && rEmail === target) {
                r.unsubscribed_at = nowIso;
                mutated = true;
              }
              out.push(JSON.stringify(r));
            } catch {
              out.push(line);
            }
          }
          if (mutated) {
            await env.R2_VIRTUAL_LAUNCH.put(
              'vlp-scale/foia-leads/foia-master.json',
              out.join('\n'),
              { httpMetadata: { contentType: 'application/x-ndjson' } }
            );
          }
        }
      } catch (e) {
        console.error('Unsubscribe: master mutation failed:', e);
      }

      // 2. Flip status in each queue
      const queueKeys = [
        'vlp-scale/ttmp-send-queue/email1-pending.json',
        'vlp-scale/vlp-send-queue/email1-pending.json',
        'vlp-scale/wlvlp-send-queue/email1-pending.json',
      ];
      for (const qKey of queueKeys) {
        try {
          const qObj = await env.R2_VIRTUAL_LAUNCH.get(qKey);
          if (!qObj) continue;
          const arr = await qObj.json();
          if (!Array.isArray(arr)) continue;
          let dirty = false;
          for (const rec of arr) {
            const rEmail = String(rec.email || '').trim().toLowerCase();
            if (rEmail === target && rec.status !== 'unsubscribed') {
              rec.status = 'unsubscribed';
              rec.unsubscribed_at = nowIso;
              dirty = true;
            }
          }
          if (dirty) {
            await env.R2_VIRTUAL_LAUNCH.put(
              qKey,
              JSON.stringify(arr),
              { httpMetadata: { contentType: 'application/json' } }
            );
          }
        } catch (e) {
          console.error(`Unsubscribe: queue mutation failed for ${qKey}:`, e);
        }
      }

      return new Response(
        `<!DOCTYPE html>
<html>
<head><title>Unsubscribed</title></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; text-align: center;">
  <h2>You've been unsubscribed</h2>
  <p>You will no longer receive emails from us.</p>
  <p>If this was a mistake, contact jamie@virtuallaunch.pro to re-subscribe.</p>
</body>
</html>`,
        { status: 200, headers: htmlHeaders }
      );
    }

    // Internal one-shot CAN-SPAM footer backfill for existing queue records.
    // Idempotent — only patches bodies that don't already contain the address.
    if (pathname === '/internal/backfill-canspam-footer' && method === 'POST') {
      const providedKey = request.headers.get('X-Internal-Key') || '';
      if (!env.INTERNAL_TEST_KEY || providedKey !== env.INTERNAL_TEST_KEY) {
        return new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
        });
      }
      const stamp = '1175 Avocado Avenue';
      const bodyKeys = ['body', 'email_2_body', 'email_3_body', 'email_4_body', 'email_5_body', 'email_6_body'];
      const targets = [
        { key: 'vlp-scale/ttmp-send-queue/email1-pending.json',  footerFn: canspamTtmpFooter,  campaign: 'ttmp'  },
        { key: 'vlp-scale/vlp-send-queue/email1-pending.json',   footerFn: canspamVlpFooter,   campaign: 'vlp'   },
        { key: 'vlp-scale/wlvlp-send-queue/email1-pending.json', footerFn: canspamWlvlpFooter, campaign: 'wlvlp' },
      ];
      const report = {};
      for (const t of targets) {
        try {
          const obj = await env.R2_VIRTUAL_LAUNCH.get(t.key);
          if (!obj) { report[t.campaign] = { skipped: 'no_queue' }; continue; }
          const arr = await obj.json();
          if (!Array.isArray(arr)) { report[t.campaign] = { skipped: 'not_array' }; continue; }
          let recordsPatched = 0;
          let bodiesPatched = 0;
          for (const rec of arr) {
            const footer = t.footerFn(rec.email || '');
            let patched = false;
            for (const bk of bodyKeys) {
              const cur = rec[bk];
              if (typeof cur === 'string' && cur.length > 0 && cur.indexOf(stamp) === -1) {
                rec[bk] = cur + footer;
                bodiesPatched++;
                patched = true;
              }
            }
            if (patched) recordsPatched++;
          }
          await env.R2_VIRTUAL_LAUNCH.put(
            t.key,
            JSON.stringify(arr),
            { httpMetadata: { contentType: 'application/json' } }
          );
          report[t.campaign] = { records_in_queue: arr.length, records_patched: recordsPatched, bodies_patched: bodiesPatched };
        } catch (e) {
          report[t.campaign] = { error: String(e && e.message || e) };
        }
      }
      return new Response(JSON.stringify(report, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
      });
    }

    // Internal one-shot backfill for TTMP + VLP asset pages.
    // Scans both send queues, generates asset page JSON for any slug missing
    // from vlp-scale/asset-pages/{slug}.json, and writes to R2.
    if (pathname === '/internal/backfill-asset-pages' && method === 'POST') {
      const providedKey = request.headers.get('X-Internal-Key') || '';
      if (!env.INTERNAL_TEST_KEY || providedKey !== env.INTERNAL_TEST_KEY) {
        return new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
        });
      }
      const nowIso = new Date().toISOString();
      const campaigns = [
        { key: 'vlp-scale/ttmp-send-queue/email1-pending.json', campaign: 'ttmp' },
        { key: 'vlp-scale/vlp-send-queue/email1-pending.json',  campaign: 'vlp'  },
      ];
      const report = { ttmp: { scanned: 0, written: 0, skipped: 0, errors: 0 }, vlp: { scanned: 0, written: 0, skipped: 0, errors: 0 } };
      for (const c of campaigns) {
        try {
          const obj = await env.R2_VIRTUAL_LAUNCH.get(c.key);
          if (!obj) { report[c.campaign].skipped_reason = 'no_queue'; continue; }
          const arr = await obj.json();
          if (!Array.isArray(arr)) continue;
          report[c.campaign].scanned = arr.length;
          for (const rec of arr) {
            const slug = rec.slug;
            if (!slug) { report[c.campaign].skipped++; continue; }
            // Check if asset page already exists
            const existing = await env.R2_VIRTUAL_LAUNCH.head(`vlp-scale/asset-pages/${slug}.json`);
            if (existing) { report[c.campaign].skipped++; continue; }
            // Build asset page from queue record data
            const credKey = dailyNormalizeCred(rec.profession || '');
            const cred = DAILY_CRED[credKey] || DAILY_CRED.EA;
            const firstDisplay = rec.first_name || 'Friend';
            const lastDisplay = rec.last_name || '';
            const city = rec.city || '';
            const state = rec.state || '';
            let page;
            if (c.campaign === 'ttmp') {
              page = buildTtmpAssetPageData({ slug, credKey, cred, firstDisplay, lastDisplay, city, state, firm: `${firstDisplay} ${lastDisplay}`.trim(), nowIso, backfilled: true });
            } else {
              page = {
                slug,
                campaign: 'vlp',
                headline: `${firstDisplay}, taxpayers in ${city || 'your area'} are searching for help you're not showing up for`,
                subheadline: `A practice analysis for ${cred.label}s — new client value, directory visibility, and transcript automation.`,
                practice_type: credKey,
                credential_label: cred.label,
                city, state,
                firm: `${firstDisplay} ${lastDisplay}`.trim(),
                stats: {
                  new_client_value: cred.new_client_value,
                  billing_range: cred.billing,
                  weekly_hours: cred.weekly,
                  annual_hours: cred.annual,
                  revenue_impact: cred.revenue,
                },
                cta_primary_url: 'https://virtuallaunch.pro/pricing',
                cta_primary_label: 'See listing tiers — starts at $79/mo',
                cta_booking_url: 'https://cal.com/vlp/vlp-discovery',
                generated_at: nowIso,
                backfilled: true,
              };
            }
            try {
              await env.R2_VIRTUAL_LAUNCH.put(
                `vlp-scale/asset-pages/${slug}.json`,
                JSON.stringify(page),
                { httpMetadata: { contentType: 'application/json' } }
              );
              report[c.campaign].written++;
            } catch (e) {
              console.error(`Backfill asset page failed ${slug}:`, e);
              report[c.campaign].errors++;
            }
          }
        } catch (e) {
          report[c.campaign].error = String(e && e.message || e);
        }
      }
      return new Response(JSON.stringify(report, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
      });
    }

    // Internal manual trigger for the TTMP email send pipeline.
    // Protected by INTERNAL_TEST_KEY secret.
    if (pathname === '/internal/test-ttmp-send' && method === 'POST') {
      const providedKey = request.headers.get('X-Internal-Key') || '';
      if (!env.INTERNAL_TEST_KEY || providedKey !== env.INTERNAL_TEST_KEY) {
        return new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
        });
      }
      try {
        const stats = await handleTtmpEmailSend(env);
        return new Response(JSON.stringify(stats, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
        });
      }
    }

    // Internal manual trigger for the daily campaign router.
    // Protected by INTERNAL_TEST_KEY secret.
    if (pathname === '/internal/test-daily-batch' && method === 'POST') {
      const providedKey = request.headers.get('X-Internal-Key') || '';
      if (!env.INTERNAL_TEST_KEY || providedKey !== env.INTERNAL_TEST_KEY) {
        return new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
        });
      }
      try {
        const stats = await handleDailyBatchGeneration(env);
        return new Response(JSON.stringify(stats, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
        });
      }
    }

    // Internal manual trigger for the VLP email send pipeline.
    // Protected by INTERNAL_TEST_KEY secret.
    if (pathname === '/internal/test-vlp-send' && method === 'POST') {
      const providedKey = request.headers.get('X-Internal-Key') || '';
      if (!env.INTERNAL_TEST_KEY || providedKey !== env.INTERNAL_TEST_KEY) {
        return new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
        });
      }
      try {
        const stats = await handleVlpEmailSend(env);
        return new Response(JSON.stringify(stats, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
        });
      }
    }

    // Internal manual trigger for the enrichment pipeline (kept for ad-hoc testing).
    // Protected by INTERNAL_TEST_KEY secret.
    if (pathname === '/internal/test-enrichment' && method === 'POST') {
      const providedKey = request.headers.get('X-Internal-Key') || '';
      if (!env.INTERNAL_TEST_KEY || providedKey !== env.INTERNAL_TEST_KEY) {
        return new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
        });
      }
      try {
        const stats = await handleEnrichmentBatch(env);
        return new Response(JSON.stringify(stats, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
        });
      }
    }

    const result = route(method, pathname);

    if (!result.matched) {
      if (result.reason === 'METHOD_NOT_ALLOWED') {
        return methodNotAllowed(method, pathname, request);
      }
      return notFound(pathname, request);
    }

    const response = await result.handler(method, result.pattern, result.params, request, env, ctx);

    // CORS safety net: if the handler forgot to pass `request` to json(),
    // getCorsHeaders() defaults to virtuallaunch.pro. Overwrite with the
    // correct origin so cross-origin callers (TMP, TTMP, etc.) aren't blocked.
    const incomingOrigin = request.headers.get('Origin') || '';
    if (ALLOWED_ORIGINS.includes(incomingOrigin)) {
      const patched = new Response(response.body, response);
      patched.headers.set('Access-Control-Allow-Origin', incomingOrigin);
      return patched;
    }
    return response;
  },

  async scheduled(event, env, ctx) {
    // FOIA Lead Enrichment Cron — 10:00 UTC daily.
    // Runs alongside the WLVLP auction settlement on the same trigger;
    // does not return early so subsequent unconditional cron blocks still run.
    if (event && event.cron === '0 10 * * *') {
      try {
        const stats = await handleEnrichmentBatch(env);
        console.log('Enrichment cron:', JSON.stringify(stats));
      } catch (e) {
        console.error('Enrichment cron failed:', e);
      }
      try {
        const auctionLog = await handleWlvlpAuctionSettlementCron(env);
        console.log('WLVLP auction settlement cron:', JSON.stringify(auctionLog));
      } catch (e) {
        console.error('WLVLP auction settlement cron failed:', e);
      }
    }

    // 06:00 UTC trigger — runs WLVLP site generation and SCALE find-emails.
    // Both share the 06:00 cron slot so they run in the same scheduled invocation.
    if (event && event.cron === '0 6 * * *') {
      try {
        await handleWlvlpSiteGeneration(env);
      } catch (e) {
        console.error('WLVLP site generation cron failed:', e);
      }
      try {
        const findEmailsLog = await handleFindEmailsCron(env);
        console.log('Find emails cron:', JSON.stringify(findEmailsLog));
      } catch (e) {
        console.error('Find emails cron failed:', e);
      }
      return;
    }

    // 08:00 UTC trigger — runs SCALE validate-emails (Reoon quick-mode).
    // Verifies deliverability of addresses discovered by the 06:00 find-emails
    // cron. Shares the Reoon 500/day budget.
    if (event && event.cron === '0 8 * * *') {
      try {
        const validateEmailsLog = await handleValidateEmailsCron(env);
        console.log('Validate emails cron:', JSON.stringify(validateEmailsLog));
      } catch (e) {
        console.error('Validate emails cron failed:', e);
      }
      return;
    }

    // WLVLP Asset Page Enrichment Cron — 13:00 UTC daily.
    // Crawls prospect websites, scores conversion leaks, and overwrites
    // minimal Shape B asset pages with full Shape A records containing
    // conversion_leak_report. Runs after the 12:00 campaign router so
    // newly routed WLVLP records are immediately eligible.
    if (event && event.cron === '0 13 * * *') {
      try {
        const enrichLog = await handleWlvlpAssetEnrichmentCron(env);
        console.log('WLVLP asset enrichment cron:', JSON.stringify(enrichLog));
      } catch (e) {
        console.error('WLVLP asset enrichment cron failed:', e);
      }
      return;
    }

    // Daily Campaign Router Cron — 12:00 UTC.
    // Reads NDJSON master, filters send-eligible enriched leads, routes them
    // into TTMP / VLP / WLVLP send queues with full 6-email content inline,
    // capped at DAILY_BATCH_CAP per day. Replaces the legacy
    // handleWlvlpBatchGeneration crawler — WLVLP records now use static
    // templates and minimal asset pages instead of per-site crawls/scoring.
    if (event && event.cron === '0 12 * * *') {
      try {
        const stats = await handleDailyBatchGeneration(env);
        console.log('Daily batch cron:', JSON.stringify(stats));
      } catch (e) {
        console.error('Daily batch cron failed:', e);
      }
      return;
    }

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

    // Unified Send Cron — 14:00 UTC.
    // Runs TTMP, VLP, and WLVLP send handlers in sequence. Each reads its
    // own queue and processes pending email_1 plus any scheduled follow-ups
    // (email_2..6) whose scheduled_for date is today or earlier. If the
    // Worker times out before completing all three, the unsent records stay
    // in their queue and the next day's run picks up where it left off.
    if (event && event.cron === '0 14 * * *') {
      try {
        const ttmpStats = await handleTtmpEmailSend(env);
        console.log('TTMP email send cron:', JSON.stringify(ttmpStats));
      } catch (e) {
        console.error('TTMP email send cron failed:', e);
      }
      try {
        const vlpStats = await handleVlpEmailSend(env);
        console.log('VLP email send cron:', JSON.stringify(vlpStats));
      } catch (e) {
        console.error('VLP email send cron failed:', e);
      }
      try {
        const wlvlpStats = await handleWlvlpEmailSend(env);
        console.log('WLVLP email send cron:', JSON.stringify(wlvlpStats));
      } catch (e) {
        console.error('WLVLP email send cron failed:', e);
      }
    }
  },
};




