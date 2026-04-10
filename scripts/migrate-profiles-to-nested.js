#!/usr/bin/env node
/**
 * migrate-profiles-to-nested.js
 *
 * Reads all existing flat-format profiles from R2 (via wrangler CLI)
 * and rewrites them in the nested format defined by
 * contracts/vlp/vlp.profile.public.v1.json.
 *
 * Usage:
 *   node scripts/migrate-profiles-to-nested.js --dry-run   # preview only
 *   node scripts/migrate-profiles-to-nested.js              # write to R2
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const BUCKET = 'virtuallaunch-pro';
const D1_DB = 'virtuallaunch-pro';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
}

function getProfileIdsFromD1() {
  const raw = run(
    `wrangler d1 execute ${D1_DB} --remote --command "SELECT professional_id FROM profiles ORDER BY created_at" --json`
  );
  const parsed = JSON.parse(raw);
  return parsed[0].results.map(r => r.professional_id);
}

function fetchProfileFromR2(id) {
  const raw = run(
    `wrangler r2 object get ${BUCKET}/profiles/${id}.json --remote --pipe`
  );
  return JSON.parse(raw);
}

function writeProfileToR2(id, data) {
  const tmpFile = path.join(__dirname, `_tmp_profile_${id}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
  try {
    run(`wrangler r2 object put ${BUCKET}/profiles/${id}.json --remote --file "${tmpFile}" --content-type application/json`);
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

// ---------------------------------------------------------------------------
// Profession mapping (flat → contract enum)
// ---------------------------------------------------------------------------

const PROFESSION_MAP = {
  'EA (Enrolled Agent)': 'Enrolled Agent',
  'Enrolled Agent': 'Enrolled Agent',
  'EA': 'Enrolled Agent',
  'CPA': 'CPA',
  'CPA (Certified Public Accountant)': 'CPA',
  'Attorney': 'Attorney',
  'Attorney / JD': 'Attorney',
  'JD': 'Attorney',
  'Enrolled Actuary': 'Enrolled Actuary',
  'ERPA': 'ERPA',
};

const VALID_PROFESSIONS = ['Attorney', 'CPA', 'Enrolled Actuary', 'Enrolled Agent', 'ERPA'];

function mapProfessions(flatProfessions) {
  if (!Array.isArray(flatProfessions)) return ['Enrolled Agent'];
  const mapped = [];
  for (const p of flatProfessions) {
    const m = PROFESSION_MAP[p];
    if (m && !mapped.includes(m)) mapped.push(m);
  }
  return mapped.length > 0 ? mapped : ['Enrolled Agent'];
}

// ---------------------------------------------------------------------------
// Credential badge style mapping
// ---------------------------------------------------------------------------

function credentialStyleKey(label) {
  const l = label.toLowerCase().trim();
  if (l === 'ea' || l === 'enrolled agent') return 'ea';
  if (l === 'cpa') return 'cpa';
  if (l === 'attorney' || l === 'jd' || l === 'esq') return 'attorney';
  return 'custom';
}

// ---------------------------------------------------------------------------
// Service icon mapping
// ---------------------------------------------------------------------------

const SERVICE_ICON_MAP = {
  'Appeals': 'gavel',
  'Audit Defense': 'shield-check',
  'Business Tax Advisory': 'briefcase',
  'Compliance': 'file-check',
  'Consulting': 'users',
  'Estate & Trust Tax': 'book-open',
  'Expert Witness': 'gavel',
  'Foreign Reporting (FBAR/FATCA)': 'globe',
  'IRS Collections Defense': 'shield-check',
  'Offer in Compromise': 'scale-3',
  'Payroll Tax Defense': 'calculator',
  'Penalty Abatement': 'scale-3',
  'Tax Litigation': 'gavel',
  'Tax Monitoring': 'target',
  'Tax Planning': 'calculator',
  'Tax Preparation': 'file-check',
  'Tax Resolution': 'shield-check',
  'Trust Fund Recovery Defense': 'shield-check',
};

const VALID_SERVICES = Object.keys(SERVICE_ICON_MAP);

// ---------------------------------------------------------------------------
// Weekly availability mapping (flat { Mon: {...} } → nested array)
// ---------------------------------------------------------------------------

const DAY_FULL = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

function mapWeeklyAvailability(flat) {
  if (!flat || typeof flat !== 'object') {
    return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(d => ({
      day: d, enabled: false, start_time: null, end_time: null
    }));
  }
  return Object.entries(DAY_FULL).map(([short, full]) => {
    const entry = flat[short];
    if (!entry) return { day: full, enabled: false, start_time: null, end_time: null };
    return {
      day: full,
      enabled: !!entry.enabled,
      start_time: entry.start || null,
      end_time: entry.end || null,
    };
  });
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

function mapStatus(flatStatus) {
  if (flatStatus === 'active') return 'standard';
  if (flatStatus === 'featured') return 'featured';
  if (flatStatus === 'hidden' || flatStatus === 'draft') return 'hidden';
  return 'standard';
}

function mapStatusBadge(nestedStatus) {
  if (nestedStatus === 'featured') return 'Featured';
  if (nestedStatus === 'hidden') return 'Hidden';
  return 'Standard';
}

// ---------------------------------------------------------------------------
// Core: flat → nested transformer
// ---------------------------------------------------------------------------

function transformProfile(flat) {
  const professions = mapProfessions(flat.professions);
  const yearsExp = parseInt(flat.yearsExperience, 10) || 0;
  const nestedStatus = mapStatus(flat.status);

  // Merge credentials into array
  const credentials = [];
  if (flat.primaryCredential) credentials.push(flat.primaryCredential.trim());
  if (flat.additionalCredentials) {
    const extras = typeof flat.additionalCredentials === 'string'
      ? flat.additionalCredentials.split(',').map(s => s.trim()).filter(Boolean)
      : Array.isArray(flat.additionalCredentials) ? flat.additionalCredentials : [];
    for (const c of extras) {
      if (!credentials.includes(c)) credentials.push(c);
    }
  }

  // Merge services into items (deduped, only valid enum values)
  const serviceSet = new Set();
  const serviceItems = [];
  const allServices = [flat.primaryService, ...(flat.additionalServices || [])].filter(Boolean);
  for (const s of allServices) {
    if (!serviceSet.has(s) && VALID_SERVICES.includes(s)) {
      serviceSet.add(s);
      serviceItems.push({ title: s, description: '', icon: SERVICE_ICON_MAP[s] || 'briefcase' });
    }
  }
  // If no valid services found, add a fallback
  if (serviceItems.length === 0) {
    serviceItems.push({ title: 'Tax Preparation', description: '', icon: 'file-check' });
  }

  // Bio paragraphs (filter empty)
  const bioParagraphs = [flat.bio1, flat.bio2, flat.bio3].filter(b => b && b.trim().length > 0);
  if (bioParagraphs.length === 0) bioParagraphs.push(flat.bioShort || 'Professional profile.');

  // Credential badges for hero
  const credentialBadges = credentials.slice(0, 6).map(c => ({
    label: c,
    style_key: credentialStyleKey(c),
  }));

  // Derive hero fields
  const professionLabel = professions[0] || 'Tax Professional';
  const cityState = [flat.city, flat.state].filter(Boolean).join(', ');
  const headline = flat.displayName || flat.fullName || 'Tax Professional';
  const locationLabel = cityState || 'United States';
  const yearsLabel = yearsExp > 0 ? `${yearsExp}+ Years Experience` : '';

  // Schedule button
  const hasBookingUrl = !!(flat.calBookingUrl && flat.calBookingUrl.trim().length > 0);
  const bookingUrl = hasBookingUrl ? flat.calBookingUrl.trim() : null;
  const scheduleMode = hasBookingUrl
    ? (bookingUrl.includes('cal.com') ? 'cal_com' : 'custom_booking_link')
    : 'none';

  // Contact button
  const hasEmail = !!(flat.email && flat.email.trim().length > 0);

  // Build nested structure
  const nested = {
    // Preserve backward-compat fields at top level
    professionalId: flat.professionalId,
    accountId: flat.accountId,
    createdAt: flat.createdAt,
    updatedAt: new Date().toISOString(),
    _migrated_from: 'flat',
    _migrated_at: new Date().toISOString(),

    // Nested profile sections
    profile: {
      name: flat.displayName || flat.fullName || '',
      slug: flat.professionalId,
      status: nestedStatus,
      status_badge_label: mapStatusBadge(nestedStatus),
      profile_type: 'live',
      initials: flat.initials || '',
      avatar: {
        upload_type: 'initials_only',
        initials_fallback: true,
        display_dimensions: { width: 96, height: 96 },
        file: null,
      },
    },

    professional: {
      profession: professions,
      credentials: credentials,
      firm_name: flat.firmName || null,
      years_experience: yearsExp,
    },

    hero: {
      headline: headline,
      location_label: locationLabel,
      rating_label: 'No reviews yet',
      years_experience_label: yearsLabel,
      credential_badges: credentialBadges,
    },

    location: {
      city: flat.city || '',
      state: flat.state || '',
      country: flat.country || 'United States',
      zip: flat.zip || null,
    },

    bio: {
      bio_short: flat.bioShort || '',
      bio_full_paragraphs: bioParagraphs,
    },

    contact: {
      contact_email: flat.email || null,
      phone: flat.phone || null,
      website: flat.website || null,
      availability_display: flat.availabilityText || null,
      timezone: flat.timezone || null,
      languages: Array.isArray(flat.languages) ? flat.languages : [],
      weekly_availability: mapWeeklyAvailability(flat.weeklyAvailability),
    },

    services_offered: {
      items: serviceItems,
    },

    specializations: {
      client_types: [],
    },

    credentials_experience: {
      licenses_certifications: [],
      background_items: [],
    },

    quick_stats: yearsExp > 0
      ? [
          { label: 'Years Experience', value: `${yearsExp}+` },
          { label: 'Services Offered', value: `${serviceItems.length}` },
          { label: 'Credentials', value: `${credentials.length}` },
        ]
      : [],

    reviews: {
      enabled: false,
      allow_submission: false,
      summary: { average_rating: 0, review_count: 0 },
      items: [],
    },

    buttons: {
      schedule_button: {
        show: hasBookingUrl,
        active: hasBookingUrl,
        label: 'Schedule Consultation',
        mode: scheduleMode,
        url: bookingUrl,
        provider_label: scheduleMode === 'cal_com' ? 'Cal.com' : scheduleMode === 'custom_booking_link' ? 'Custom' : 'None',
        behavior_phrase: hasBookingUrl
          ? (scheduleMode === 'cal_com'
            ? 'Yes, I have created/connected my Cal.com account, use my Cal.com link'
            : 'Yes, I have connected my own booking link, use my booking link')
          : 'No, I have not connected Cal.com or my own booking link, keep button inactive',
        description: null,
        description_mode: 'derived',
        event_type_label: null,
        event_type_duration_minutes: null,
      },
      contact_button: {
        show: hasEmail,
        active: hasEmail,
        label: 'Contact Now',
        mode: hasEmail ? 'email' : 'inactive',
        url: hasEmail ? `mailto:${flat.email}` : null,
      },
      review_button: {
        show: false,
        active: false,
        label: 'Add Your Review',
        mode: 'inactive',
        url: null,
      },
    },
  };

  return nested;
}

// ---------------------------------------------------------------------------
// Field-count comparison
// ---------------------------------------------------------------------------

function countFields(obj, prefix = '') {
  let count = 0;
  for (const [key, val] of Object.entries(obj)) {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      count += countFields(val, `${prefix}${key}.`);
    } else {
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Field mapping report
// ---------------------------------------------------------------------------

function printMappingTable() {
  const mappings = [
    ['displayName / fullName', 'profile.name', 'mapped'],
    ['professionalId', 'profile.slug', 'mapped'],
    ['initials', 'profile.initials', 'mapped'],
    ['status ("active")', 'profile.status ("standard")', 'mapped'],
    ['(none)', 'profile.avatar', 'defaulted — initials_only'],
    ['(none)', 'profile.profile_type', 'defaulted — "live"'],
    ['(none)', 'profile.status_badge_label', 'derived from status'],
    ['bio1, bio2, bio3', 'bio.bio_full_paragraphs', 'mapped (filtered empty)'],
    ['bioShort', 'bio.bio_short', 'mapped'],
    ['city', 'location.city', 'mapped'],
    ['state', 'location.state', 'mapped'],
    ['(none)', 'location.country', 'defaulted — "United States"'],
    ['(none)', 'location.zip', 'defaulted — null'],
    ['firmName', 'professional.firm_name', 'mapped'],
    ['professions', 'professional.profession', 'mapped (enum-filtered)'],
    ['yearsExperience (string)', 'professional.years_experience (number)', 'mapped (parseInt)'],
    ['primaryCredential + additionalCredentials', 'professional.credentials', 'mapped (merged array)'],
    ['primaryService + additionalServices', 'services_offered.items', 'mapped (deduped, with icons)'],
    ['email', 'contact.contact_email', 'mapped'],
    ['phone', 'contact.phone', 'mapped'],
    ['(none)', 'contact.website', 'defaulted — null'],
    ['languages', 'contact.languages', 'mapped'],
    ['availabilityText', 'contact.availability_display', 'mapped'],
    ['weeklyAvailability {Mon:{...}}', 'contact.weekly_availability [{day,enabled,...}]', 'mapped (restructured)'],
    ['(none)', 'contact.timezone', 'defaulted — null'],
    ['calBookingUrl', 'buttons.schedule_button.url/mode/active', 'mapped'],
    ['(none)', 'buttons.contact_button', 'derived from email'],
    ['(none)', 'buttons.review_button', 'defaulted — inactive'],
    ['displayName + professions', 'hero.headline', 'derived'],
    ['city + state', 'hero.location_label', 'derived'],
    ['(none)', 'hero.rating_label', 'defaulted — "No reviews yet"'],
    ['yearsExperience', 'hero.years_experience_label', 'derived'],
    ['credentials', 'hero.credential_badges', 'derived (with style_key)'],
    ['yearsExperience + services count', 'quick_stats', 'derived'],
    ['(none)', 'reviews', 'defaulted — empty, disabled'],
    ['(none)', 'specializations.client_types', 'defaulted — empty array'],
    ['(none)', 'credentials_experience', 'defaulted — empty arrays'],
  ];

  console.log('\n┌──────────────────────────────────────────┬──────────────────────────────────────────────┬──────────────────────────────┐');
  console.log('│ Flat Field                               │ Nested Field                                 │ Strategy                     │');
  console.log('├──────────────────────────────────────────┼──────────────────────────────────────────────┼──────────────────────────────┤');
  for (const [from, to, strategy] of mappings) {
    console.log(`│ ${from.padEnd(40)} │ ${to.padEnd(44)} │ ${strategy.padEnd(28)} │`);
  }
  console.log('└──────────────────────────────────────────┴──────────────────────────────────────────────┴──────────────────────────────┘');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n=== Profile Migration: Flat → Nested ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (writing to R2)'}\n`);

  // Step 1: Get all profile IDs from D1
  console.log('Fetching profile IDs from D1...');
  const ids = getProfileIdsFromD1();
  console.log(`Found ${ids.length} profile(s): ${ids.join(', ')}\n`);

  if (ids.length === 0) {
    console.log('No profiles to migrate.');
    return;
  }

  // Print field mapping table
  printMappingTable();

  // Step 2: Process each profile
  for (const id of ids) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Processing: ${id}`);
    console.log(`${'─'.repeat(70)}`);

    // Fetch flat profile
    console.log('  Fetching from R2...');
    const flat = fetchProfileFromR2(id);
    const flatFieldCount = countFields(flat);
    console.log(`  Flat profile: ${flatFieldCount} fields`);

    // Check if already migrated
    if (flat._migrated_from === 'flat' || flat.profile?.name) {
      console.log('  ⚠ Profile appears to already be in nested format. Skipping.');
      continue;
    }

    // Transform
    console.log('  Transforming flat → nested...');
    const nested = transformProfile(flat);
    const nestedFieldCount = countFields(nested);
    console.log(`  Nested profile: ${nestedFieldCount} fields`);
    console.log(`  Field expansion: ${flatFieldCount} → ${nestedFieldCount} (+${nestedFieldCount - flatFieldCount})`);

    // Show key mappings for this profile
    console.log('\n  Key values:');
    console.log(`    profile.name:              ${nested.profile.name}`);
    console.log(`    profile.slug:              ${nested.profile.slug}`);
    console.log(`    profile.status:            ${nested.profile.status} (was: ${flat.status})`);
    console.log(`    professional.profession:   ${JSON.stringify(nested.professional.profession)}`);
    console.log(`    professional.credentials:  ${JSON.stringify(nested.professional.credentials)}`);
    console.log(`    professional.years_exp:    ${nested.professional.years_experience}`);
    console.log(`    professional.firm_name:    ${nested.professional.firm_name}`);
    console.log(`    location:                  ${nested.hero.location_label}`);
    console.log(`    bio.bio_short:             ${nested.bio.bio_short.substring(0, 60)}...`);
    console.log(`    bio.paragraphs:            ${nested.bio.bio_full_paragraphs.length} paragraphs`);
    console.log(`    services_offered:          ${nested.services_offered.items.length} services`);
    console.log(`    contact.email:             ${nested.contact.contact_email}`);
    console.log(`    contact.phone:             ${nested.contact.phone}`);
    console.log(`    contact.languages:         ${JSON.stringify(nested.contact.languages)}`);
    console.log(`    weekly_availability:       ${nested.contact.weekly_availability.filter(d => d.enabled).length}/7 days enabled`);
    console.log(`    schedule_button.active:    ${nested.buttons.schedule_button.active}`);
    console.log(`    contact_button.active:     ${nested.buttons.contact_button.active}`);
    console.log(`    quick_stats:               ${nested.quick_stats.length} stats`);
    console.log(`    hero.credential_badges:    ${nested.hero.credential_badges.length} badges`);

    if (DRY_RUN) {
      console.log('\n  === DRY RUN: Full nested output ===');
      console.log(JSON.stringify(nested, null, 2));
      console.log('  === END DRY RUN OUTPUT ===');
    } else {
      console.log('\n  Writing nested profile to R2...');
      writeProfileToR2(id, nested);
      console.log(`  ✓ Written to profiles/${id}.json`);
    }
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`Migration ${DRY_RUN ? 'preview' : 'complete'}: ${ids.length} profile(s) processed`);
  console.log(`${'═'.repeat(70)}\n`);
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
