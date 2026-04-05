#!/usr/bin/env node

/**
 * VLP SCALE Batch Generator
 *
 * Usage:
 *   node scale/generate-vlp-batch.js                         (reads vlp-master.csv)
 *   node scale/generate-vlp-batch.js path/to/prospects.csv   (explicit override)
 *
 * Creates a lockfile at scale/prospects/.batch-in-progress during execution.
 * Writes vlp_email_1_prepared_at timestamps back to the source CSV.
 * Generates batch JSON and Hunter.io CSV from prospect CSV.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// --- Name normalization helpers ---

const UPPERCASE_WORDS = new Set([
  'CPA', 'LLC', 'LLP', 'PC', 'PA', 'PS', 'PLC', 'PLLC', 'INC', 'DBA', 'EA', 'JD', 'II', 'III', 'IV'
]);

function titleCase(str) {
  if (!str) return '';
  return str.trim().toLowerCase().replace(/\b\w+/g, word => {
    const upper = word.toUpperCase();
    // Preserve known business/credential abbreviations
    if (UPPERCASE_WORDS.has(upper)) return upper;
    // Handle P.C., L.L.C. etc — strip dots and check
    const stripped = upper.replace(/\./g, '');
    if (UPPERCASE_WORDS.has(stripped)) return word.toUpperCase();
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
}

const CITY_ABBREVS = {
  'VLY': 'Valley', 'MT': 'Mount', 'FT': 'Fort', 'ST': 'Saint',
  'PT': 'Point', 'CTR': 'Center', 'HTS': 'Heights', 'SPG': 'Spring',
  'SPGS': 'Springs', 'JCT': 'Junction', 'PKY': 'Parkway', 'BLF': 'Bluff',
  'CRK': 'Creek', 'HBR': 'Harbor', 'MDW': 'Meadow', 'MDWS': 'Meadows',
  'PLN': 'Plain', 'PLNS': 'Plains', 'VLG': 'Village', 'BCH': 'Beach',
  'BRG': 'Bridge', 'EST': 'Estate', 'FLS': 'Falls', 'FRK': 'Fork',
  'GRV': 'Grove', 'HVN': 'Haven', 'ISL': 'Island', 'LK': 'Lake',
  'LKS': 'Lakes', 'LDG': 'Lodge', 'MNR': 'Manor', 'ML': 'Mill',
  'MLS': 'Mills', 'PKS': 'Parks', 'RDG': 'Ridge', 'SHR': 'Shore',
  'SHRS': 'Shores', 'STA': 'Station', 'VW': 'View', 'VIS': 'Vista'
};

function normalizeCity(city) {
  if (!city) return '';
  return city.trim().split(/\s+/).map(word => {
    const upper = word.toUpperCase();
    if (CITY_ABBREVS[upper]) return CITY_ABBREVS[upper];
    return titleCase(word);
  }).join(' ');
}

function normalizeState(state) {
  if (!state) return '';
  return state.trim().toUpperCase();
}

function normalizeFirstName(name) {
  if (!name) return '';
  return titleCase(name.split(/\s+/)[0]);
}

function normalizeFullName(first, last) {
  return `${normalizeFirstName(first)} ${titleCase(last)}`.trim();
}

function normalizeFirm(dba, city) {
  if (!dba || dba.trim() === '') return `${city} practice`;
  const trimmed = dba.trim();
  // Detect truncation: IRS FOIA fixed-width fields are 40 chars;
  // if >=39 chars and doesn't end with a natural terminator, it's clipped
  if (trimmed.length >= 39 && !trimmed.match(/[.\s,)']$/)) {
    return `${city} practice`;
  }
  return titleCase(trimmed);
}

function normalizeCredentialLabel(profession) {
  const map = {
    'EA': 'Enrolled Agent',
    'CPA': 'Certified Public Accountant',
    'ATTY': 'Tax Attorney',
    'JD': 'Tax Attorney',
    'ATTORNEY': 'Tax Attorney'
  };
  return map[profession?.trim()?.toUpperCase()] || 'Tax Professional';
}

// Credential mappings for tier values and labels
const CREDENTIAL_CONFIG = {
  'EA': {
    label: 'Enrolled Agents',
    billing_rate: '$100-300/hr',
    client_volume: '50-200/yr',
    annual_value: '$15,000-$90,000'
  },
  'CPA': {
    label: 'CPAs',
    billing_rate: '$150-400/hr',
    client_volume: '100-500/yr',
    annual_value: '$22,500-$120,000'
  },
  'JD': {
    label: 'Tax Attorneys',
    billing_rate: '$200-500/hr',
    client_volume: '30-100/yr',
    annual_value: '$18,000-$150,000'
  },
  'Attorney': {
    label: 'Tax Attorneys',
    billing_rate: '$200-500/hr',
    client_volume: '30-100/yr',
    annual_value: '$18,000-$150,000'
  }
};

// Helper functions
function cleanName(name) {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/\b(dr|mr|mrs|ms|jr|sr)\.?\b/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .trim('-');
}

function generateSlug(firstName, lastName, city, state, existingSlugs = new Set()) {
  const baseSlug = [
    cleanName(firstName),
    cleanName(lastName),
    cleanName(city),
    state.toLowerCase()
  ].filter(part => part).join('-');

  if (!existingSlugs.has(baseSlug)) {
    existingSlugs.add(baseSlug);
    return baseSlug;
  }

  // Deduplicate with -2, -3, etc.
  let counter = 2;
  let uniqueSlug = `${baseSlug}-${counter}`;
  while (existingSlugs.has(uniqueSlug)) {
    counter++;
    uniqueSlug = `${baseSlug}-${counter}`;
  }

  existingSlugs.add(uniqueSlug);
  return uniqueSlug;
}

function generateAssetPage(prospect, credentialConfig) {
  const { First_NAME, LAST_NAME, BUS_ADDR_CITY, BUS_ST_CODE, PROFESSION } = prospect;

  const firstName = normalizeFirstName(First_NAME);
  const fullName = normalizeFullName(First_NAME, LAST_NAME);
  const city = normalizeCity(BUS_ADDR_CITY);
  const state = normalizeState(BUS_ST_CODE);
  const credLabel = normalizeCredentialLabel(PROFESSION);

  return {
    headline: `${firstName}, how much is your ${city} practice leaving on the table?`,
    subheadline: `Answer three quick questions. We'll show you the revenue gap — and how to close it.`,
    credential_line: `${credLabel} · ${city}, ${state}`,
    calculator: {
      enabled: true,
      fields: [
        { id: 'newClients', label: 'How many new clients could you take on per month?', type: 'range', min: 1, max: 250, default: 5 },
        { id: 'engValue', label: 'Average value per new client engagement', type: 'range', min: 200, max: 5000, default: 1500, step: 100 }
      ],
      result_template: `That's what {newClients} new clients per month at \${engValue} each could add to your practice — if they could find you.`
    },
    qualifying_questions: [
      {
        text: 'A structured client workflow for intake through case completion',
        detail: 'Stop losing prospects between first contact and engagement. Our intake flow handles agreement, payment, and onboarding automatically.'
      },
      {
        text: 'More online visibility beyond word-of-mouth referrals',
        detail: 'Get placed in front of taxpayers actively searching for help through our directory, ecosystem placements, and partner platforms.'
      },
      {
        text: 'Faster transcript analysis so your team can handle more volume',
        detail: 'Every VLP membership includes transcript automation tokens. Turn a 20-minute manual review into a 30-second report.'
      }
    ],
    tiers: [
      { name: 'Active', price: '$79/mo', pitch: 'Get listed in the directory. Start receiving inquiries from taxpayers in your area.', recommended: false },
      { name: 'Featured', price: '$199/mo', pitch: 'Sponsored placement puts you ahead. Priority matching to incoming taxpayer inquiries.', recommended: true },
      { name: 'Premier', price: '$399/mo', pitch: 'Maximum visibility across three platforms. Early case access. Priority everything.', recommended: false }
    ],
    crosssell: {
      heading: 'Just want to try the transcript tool?',
      body: 'No membership needed. Analyze 10 IRS transcripts for $19. See how much time it saves before you commit to anything.',
      url: 'https://transcript.taxmonitor.pro/pricing',
      button_text: 'Try transcript automation'
    },
    about: {
      heading: 'About Virtual Launch Pro',
      subheading: 'The practice growth hub built for tax professionals.',
      paragraphs: [
        'Virtual Launch Pro connects tax professionals with the clients, tools, and visibility they need to grow. One membership gives you a searchable listing in the Tax Monitor Pro directory, automated IRS transcript analysis through Transcript Tax Monitor Pro, interactive tax education tools, and a structured client intake workflow — from first inquiry through case completion.',
        'Instead of cobbling together separate tools for visibility, client management, and transcript work, VLP puts them under one account with one token wallet. Your membership tier determines how visible you are and how many tools you can use each month.'
      ],
      stats: [
        { value: '750,000+', label: 'U.S. tax professionals' },
        { value: '8', label: 'Connected platforms' },
        { value: '$79', label: 'Starting monthly' }
      ]
    },
    ctas: {
      primary: { text: 'See all membership tiers', url: 'https://virtuallaunch.pro/pricing' },
      secondary: { text: 'Browse the professional directory', url: 'https://taxmonitor.pro/directory' }
    },
    footer: `Prepared for ${fullName} · ${city}, ${state} · virtuallaunch.pro`
  };
}

function generateEmailSubject(prospect, credentialConfig) {
  const { First_NAME, DBA, BUS_ADDR_CITY, firm_bucket } = prospect;

  const firstName = normalizeFirstName(First_NAME);
  const city = normalizeCity(BUS_ADDR_CITY);
  const firm = normalizeFirm(DBA, city);

  if (firm_bucket === 'solo_brand' && DBA && firm !== `${city} practice`) {
    return `${firstName} — taxpayers can't find ${firm} when they search online`;
  } else if (firm_bucket === 'local_firm') {
    return `${firstName} — taxpayers in ${city} are searching for help you're not showing up for`;
  } else {
    return `${firstName} — your next 5 clients are searching online right now`;
  }
}

function generateEmailBody(prospect, credentialConfig, slug) {
  const { First_NAME, BUS_ADDR_CITY, firm_bucket, DBA } = prospect;

  const firstName = normalizeFirstName(First_NAME);
  const city = normalizeCity(BUS_ADDR_CITY);

  const firm = normalizeFirm(DBA, city);
  let firmOrCityPractice;
  if (firm_bucket === 'solo_brand' && DBA && firm !== `${city} practice`) {
    firmOrCityPractice = firm;
  } else {
    firmOrCityPractice = `your ${city} practice`;
  }

  const credentialLabel = credentialConfig.label;

  return `Hello ${firstName},

Taxpayers in ${city} search online for tax help every day. Most never find you because you're not in the places they're looking.

The Tax Monitor Pro network puts your profile in front of taxpayers who need exactly what you offer — ${credentialLabel} with experience in general tax preparation. Listings start at $79/mo and include transcript automation tokens so your practice gets more efficient at the same time.

Here's a quick practice analysis I put together for ${firmOrCityPractice}:
https://virtuallaunch.pro/asset/${slug}

And if you just want to try the transcript tool first, no membership needed:
https://transcript.taxmonitor.pro/pricing
10 analyses for $19 — takes 30 seconds per transcript.

See all membership tiers here:
https://virtuallaunch.pro/pricing

—
Jamie L Williams
Virtual Launch Pro
virtuallaunch.pro`;
}

function generateEmail2(prospect, credentialConfig) {
  const firstName = normalizeFirstName(prospect.First_NAME);
  const { annual_value } = credentialConfig;

  return {
    subject: `Your practice analysis is ready, ${firstName} — ${annual_value} on the table`,
    timing: "3 days after Email 1",
    note: "References prior email + asset page, leads with asset page URL, includes pricing + TTMP cross-sell CTAs"
  };
}

function isValidEmail(email) {
  return email &&
         typeof email === 'string' &&
         email !== 'undefined' &&
         email !== '' &&
         !Number.isNaN(email) &&
         email.includes('@');
}

function isEligibleRecord(record, force = false) {
  // Section 4: Selection Logic

  // 1. Filter: email_found not empty, not "undefined", not NaN
  if (!isValidEmail(record.email_found)) {
    return false;
  }

  // 2. Filter: email_status not "invalid"
  if (record.email_status === 'invalid') {
    return false;
  }

  // 3. Filter: vlp_email_1_prepared_at is empty (skip in --force mode)
  if (!force && record.vlp_email_1_prepared_at && record.vlp_email_1_prepared_at.trim() !== '') {
    return false;
  }

  // 4. Filter: email_1_prepared_at is empty (exclude TTMP pipeline)
  if (record.email_1_prepared_at && record.email_1_prepared_at.trim() !== '') {
    return false;
  }

  return true;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

function formatCSVValue(value) {
  if (!value) return '';
  const str = String(value);

  // Quote if contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }

  return str;
}

async function main() {
  const args = process.argv.slice(2);
  const DEFAULT_MASTER = path.join(__dirname, 'prospects', 'vlp-master.csv');
  const LOCKFILE = path.join(__dirname, 'prospects', '.batch-in-progress');

  const forceMode = args.includes('--force');
  const csvPath = args.find(a => !a.startsWith('--')) || DEFAULT_MASTER;

  if (!fs.existsSync(csvPath)) {
    console.error(`Error: File ${csvPath} does not exist`);
    process.exit(1);
  }

  // Create lockfile
  fs.writeFileSync(LOCKFILE, JSON.stringify({ started_at: new Date().toISOString(), pid: process.pid }));
  console.log('Lockfile created: scale/prospects/.batch-in-progress');

  // Ensure lockfile is removed on exit
  const removeLock = () => {
    try { fs.unlinkSync(LOCKFILE); } catch (_) {}
  };
  process.on('exit', removeLock);
  process.on('SIGINT', () => { removeLock(); process.exit(1); });
  process.on('SIGTERM', () => { removeLock(); process.exit(1); });

  console.log(`Reading prospect CSV: ${csvPath}`);

  // Parse CSV
  const fileStream = fs.createReadStream(csvPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let headers = null;
  const records = [];

  for await (const line of rl) {
    if (!line.trim()) continue;

    const values = parseCSVLine(line);

    if (!headers) {
      headers = values;
      continue;
    }

    const record = {};
    for (let i = 0; i < headers.length; i++) {
      record[headers[i]] = values[i] || '';
    }

    records.push(record);
  }

  console.log(`Loaded ${records.length} records from CSV`);

  if (forceMode) {
    console.log('--force mode: ignoring vlp_email_1_prepared_at timestamps');
  }

  // Filter eligible records (Section 4)
  const eligible = records.filter(record => {
    if (!isEligibleRecord(record, forceMode)) {
      return false;
    }

    // Check required fields
    const required = ['LAST_NAME', 'First_NAME', 'BUS_ADDR_CITY', 'BUS_ST_CODE', 'PROFESSION', 'email_found', 'email_status', 'firm_bucket'];
    for (const field of required) {
      if (!record[field] || record[field].trim() === '') {
        console.log(`Skipping record: missing required field ${field}`);
        return false;
      }
    }

    return true;
  });

  console.log(`${eligible.length} eligible records found`);

  // Sort by domain_clean (nulls last)
  eligible.sort((a, b) => {
    const aDomain = a.domain_clean || 'zzz';
    const bDomain = b.domain_clean || 'zzz';
    return aDomain.localeCompare(bDomain);
  });

  // Select first 50
  const selected = eligible.slice(0, 50);
  console.log(`Processing ${selected.length} prospects for batch`);

  if (selected.length === 0) {
    console.log('No eligible prospects found. Exiting.');
    return;
  }

  // Generate batch data
  const batchData = [];
  const hunterData = [];
  const existingSlugs = new Set();
  const timestamp = new Date().toISOString();
  const dateString = new Date().toISOString().split('T')[0];

  for (const prospect of selected) {
    const credential = prospect.PROFESSION.toUpperCase();
    const credentialConfig = CREDENTIAL_CONFIG[credential] || CREDENTIAL_CONFIG['EA'];

    const slug = generateSlug(prospect.First_NAME, prospect.LAST_NAME, prospect.BUS_ADDR_CITY, prospect.BUS_ST_CODE, existingSlugs);
    const assetPage = generateAssetPage(prospect, credentialConfig);
    const emailSubject = generateEmailSubject(prospect, credentialConfig);
    const emailBody = generateEmailBody(prospect, credentialConfig, slug);
    const email2 = generateEmail2(prospect, credentialConfig);

    const firstName = normalizeFirstName(prospect.First_NAME);
    const lastName = titleCase(prospect.LAST_NAME);
    const city = normalizeCity(prospect.BUS_ADDR_CITY);
    const state = normalizeState(prospect.BUS_ST_CODE);

    const prospectData = {
      slug,
      email: prospect.email_found,
      name: `${firstName} ${lastName}`,
      credential,
      credential_label: normalizeCredentialLabel(prospect.PROFESSION),
      city,
      state,
      firm: normalizeFirm(prospect.DBA, city),
      firm_bucket: prospect.firm_bucket,
      domain_clean: prospect.domain_clean || '',
      asset_page: assetPage,
      email_1: {
        subject: emailSubject,
        body: emailBody
      },
      email_2: email2
    };

    batchData.push(prospectData);

    // Hunter.io CSV data — individual merge fields for Hunter template
    hunterData.push({
      email: prospect.email_found,
      first_name: firstName,
      last_name: lastName,
      company: (prospect.DBA && normalizeFirm(prospect.DBA, city) !== `${city} practice`) ? normalizeFirm(prospect.DBA, city) : `${firstName} ${lastName} Tax Services`,
      subject: emailSubject,
      city,
      credential_label: credentialConfig.label,
      firm_display: (prospect.firm_bucket === 'solo_brand' && prospect.DBA && normalizeFirm(prospect.DBA, city) !== `${city} practice`) ? normalizeFirm(prospect.DBA, city) : `your ${city} practice`,
      asset_url: `https://virtuallaunch.pro/asset/${slug}`,
      slug
    });

    // Update source record with timestamp
    prospect.vlp_email_1_prepared_at = timestamp;
  }

  // Write batch JSON
  const batchPath = `scale/batches/vlp-batch-${dateString}.json`;
  fs.writeFileSync(batchPath, JSON.stringify(batchData, null, 2));
  console.log(`Batch JSON written to: ${batchPath}`);

  // Write Hunter CSV
  const hunterPath = `scale/hunter/vlp-email1-${dateString}.csv`;
  const hunterHeaders = ['email', 'first_name', 'last_name', 'company', 'subject', 'city', 'credential_label', 'firm_display', 'asset_url', 'slug'];
  const hunterCSV = [
    hunterHeaders.join(','),
    ...hunterData.map(row =>
      hunterHeaders.map(col => formatCSVValue(row[col])).join(',')
    )
  ].join('\n');

  fs.writeFileSync(hunterPath, hunterCSV);
  console.log(`Hunter CSV written to: ${hunterPath}`);

  // Update source CSV
  const updatedHeaders = headers.includes('vlp_email_1_prepared_at') ? headers : [...headers, 'vlp_email_1_prepared_at'];
  const updatedCSV = [
    updatedHeaders.join(','),
    ...records.map(record =>
      updatedHeaders.map(col => formatCSVValue(record[col] || '')).join(',')
    )
  ].join('\n');

  fs.writeFileSync(csvPath, updatedCSV);
  console.log(`Updated source CSV with vlp_email_1_prepared_at timestamps`);

  // Summary
  console.log('\n--- SUMMARY ---');
  console.log(`Prospects processed: ${selected.length}`);
  console.log(`Remaining eligible: ${eligible.length - selected.length}`);
  console.log(`Hunter CSV: ${hunterPath}`);
  console.log(`Batch JSON: ${batchPath}`);

  if (selected.length > 0) {
    console.log(`\nSample subject line: ${hunterData[0].subject}`);
  }
}

if (require.main === module) {
  main().catch(console.error);
}