#!/usr/bin/env node

/**
 * VLP SCALE Batch Generator
 *
 * Usage: node scale/generate-vlp-batch.js path/to/prospects.csv
 *
 * Implements SKILL.md sections 4-6 exactly.
 * Generates batch JSON and Hunter.io CSV from prospect CSV.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

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
  const { First_NAME, BUS_ADDR_CITY, firm_bucket, DBA } = prospect;

  // Headline personalization by firm_bucket
  let headline;
  if (firm_bucket === 'solo_brand' && DBA) {
    headline = `${First_NAME}, here's what your ${DBA} practice is leaving on the table`;
  } else {
    headline = `${First_NAME}, here's what your ${BUS_ADDR_CITY} practice is leaving on the table`;
  }

  return {
    headline,
    subheadline: `A practice analysis for ${credentialConfig.label} who want more qualified clients`,
    client_gap_analysis: [
      "No searchable directory listing — taxpayers can't find you",
      "No online intake workflow — prospects drop off before engaging",
      "No automated client matching — you wait for referrals instead of earning leads"
    ],
    new_client_value: `${credentialConfig.annual_value}/yr from 5 additional clients`,
    tier_comparison: {
      active: { price: "$79/mo", value: "Directory listing + 2 transcript tokens + 5 game tokens" },
      featured: { price: "$199/mo", value: "Sponsored placement + 5 transcript tokens + 15 game tokens" },
      premier: { price: "$399/mo", value: "Placement on 3 platforms + 10 transcript + 40 game tokens" }
    },
    ttmp_crosssell: {
      pitch: "Not ready for a membership? Try transcript automation first.",
      url: "https://transcript.taxmonitor.pro/pricing",
      price: "10 analyses for $19 — no commitment"
    },
    cta_pricing_url: "https://virtuallaunch.pro/pricing",
    cta_directory_url: "https://taxmonitor.pro/directory",
    cta_booking_url: "https://cal.com/vlp/discovery"
  };
}

function generateEmailSubject(prospect, credentialConfig) {
  const { First_NAME, PROFESSION, DBA, BUS_ADDR_CITY, firm_bucket } = prospect;

  if (firm_bucket === 'solo_brand' && DBA) {
    return `${First_NAME} — ${PROFESSION}s running ${DBA} are invisible to taxpayers searching online`;
  } else if (firm_bucket === 'local_firm') {
    return `${First_NAME} — taxpayers in ${BUS_ADDR_CITY} are searching for help you're not showing up for`;
  } else {
    // national_firm or fallback
    return `${First_NAME} — your next 5 clients are searching online right now`;
  }
}

function generateEmailBody(prospect, credentialConfig, slug) {
  const { First_NAME, BUS_ADDR_CITY, firm_bucket, DBA } = prospect;

  let firmOrCityPractice;
  if (firm_bucket === 'solo_brand' && DBA) {
    firmOrCityPractice = DBA;
  } else {
    firmOrCityPractice = `your ${BUS_ADDR_CITY} practice`;
  }

  const credentialLabel = credentialConfig.label.toLowerCase();

  return `${First_NAME},

Taxpayers in ${BUS_ADDR_CITY} search online for tax help every day. Most never find you because you're not in the places they're looking.

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
  const { First_NAME } = prospect;
  const { annual_value } = credentialConfig;

  return {
    subject: `Your practice analysis is ready, ${First_NAME} — ${annual_value} on the table`,
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

function isEligibleRecord(record) {
  // Section 4: Selection Logic

  // 1. Filter: email_found not empty, not "undefined", not NaN
  if (!isValidEmail(record.email_found)) {
    return false;
  }

  // 2. Filter: email_status not "invalid"
  if (record.email_status === 'invalid') {
    return false;
  }

  // 3. Filter: vlp_email_1_prepared_at is empty
  if (record.vlp_email_1_prepared_at && record.vlp_email_1_prepared_at.trim() !== '') {
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

  if (args.length !== 1) {
    console.error('Usage: node scale/generate-vlp-batch.js path/to/prospects.csv');
    process.exit(1);
  }

  const csvPath = args[0];

  if (!fs.existsSync(csvPath)) {
    console.error(`Error: File ${csvPath} does not exist`);
    process.exit(1);
  }

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

  // Filter eligible records (Section 4)
  const eligible = records.filter(record => {
    if (!isEligibleRecord(record)) {
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

    const prospectData = {
      slug,
      email: prospect.email_found,
      name: `${prospect.First_NAME} ${prospect.LAST_NAME}`,
      credential,
      city: prospect.BUS_ADDR_CITY,
      state: prospect.BUS_ST_CODE,
      firm: prospect.DBA || '',
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

    // Hunter.io CSV data
    hunterData.push({
      email: prospect.email_found,
      first_name: prospect.First_NAME,
      last_name: prospect.LAST_NAME,
      company: prospect.DBA || `${prospect.First_NAME} ${prospect.LAST_NAME} Tax Services`,
      subject: emailSubject,
      body: emailBody
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
  const hunterHeaders = ['email', 'first_name', 'last_name', 'company', 'subject', 'body'];
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