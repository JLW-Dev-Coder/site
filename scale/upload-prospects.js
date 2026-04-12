#!/usr/bin/env node

/**
 * VLP SCALE — Master Prospect CSV Uploader
 *
 * Uploads a local master prospect CSV to R2 at `vlp-scale/prospects/master.csv`
 * via the authenticated VLP Worker route `PUT /v1/scale/prospects/upload`.
 *
 * Usage:
 *   node scale/upload-prospects.js --file <path> [--dry-run] [--api-key <value>] [--api <url>]
 *
 * Auth:
 *   Set SCALE_API_KEY in .env / environment, OR pass --api-key <value>.
 *   Sent as `Authorization: Bearer <key>` header. Matches the Worker secret
 *   `SCALE_API_KEY` bound on the VLP Worker.
 *
 * Example:
 *   node scale/upload-prospects.js --file ../transcript.taxmonitor.pro/scale/prospects/IRS_FOIA_SORTED_-_results-20260401-195853.csv
 */

const fs = require('fs');
const path = require('path');

const REQUIRED_COLUMNS = [
  'LAST_NAME',
  'First_NAME',
  'DBA',
  'BUS_ADDR_CITY',
  'BUS_ST_CODE',
  'PROFESSION',
  'domain_clean',
];

const DEFAULT_API_BASE = 'https://api.virtuallaunch.pro';
const UPLOAD_PATH = '/v1/scale/prospects/upload';

// --- CLI arg parsing ---

function parseArgs(argv) {
  const args = { file: null, dryRun: false, apiKey: null, api: DEFAULT_API_BASE };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') { args.file = argv[++i]; continue; }
    if (a === '--dry-run') { args.dryRun = true; continue; }
    if (a === '--api-key') { args.apiKey = argv[++i]; continue; }
    if (a === '--api') { args.api = argv[++i]; continue; }
    if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
  }
  return args;
}

function printUsage() {
  console.log('Usage: node scale/upload-prospects.js --file <path> [--dry-run] [--api-key <value>] [--api <url>]');
}

// --- .env loader (minimal, no dependency) ---

function loadDotEnvKey(keyName) {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return null;
  try {
    const text = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      if (key !== keyName) continue;
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      return val || null;
    }
  } catch {}
  return null;
}

// --- CSV streaming (only for validation — we upload raw bytes) ---

function parseCsvLine(line) {
  const out = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; continue; }
        inQuotes = false;
        continue;
      }
      field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { out.push(field); field = ''; continue; }
    field += c;
  }
  out.push(field);
  return out;
}

function validateAndCountCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const firstNewline = stripped.indexOf('\n');
  if (firstNewline < 0) throw new Error('CSV has no rows');

  const headerLine = stripped.slice(0, firstNewline).replace(/\r$/, '');
  const headers = parseCsvLine(headerLine).map(h => h.trim());
  const headerIdx = Object.create(null);
  headers.forEach((h, i) => { headerIdx[h] = i; });

  const missing = REQUIRED_COLUMNS.filter(c => !(c in headerIdx));
  if (missing.length > 0) {
    throw new Error(`CSV missing required columns: ${missing.join(', ')}`);
  }

  const emailFoundIdx = headerIdx.email_found;
  const emailStatusIdx = headerIdx.email_status;
  const email1PreparedIdx = headerIdx.email_1_prepared_at;

  let totalRows = 0;
  let rowsWithEmailFound = 0;
  let rowsValidEmail = 0;
  let rowsEligibleEmail1 = 0;

  // Iterate data rows. Use a streaming approach over the remaining buffer.
  let cursor = firstNewline + 1;
  const buf = stripped;
  const len = buf.length;
  let inQuotes = false;
  let lineStart = cursor;

  while (cursor <= len) {
    const c = cursor < len ? buf[cursor] : '\n';
    if (c === '"') { inQuotes = !inQuotes; cursor++; continue; }
    if ((c === '\n' || cursor === len) && !inQuotes) {
      let line = buf.slice(lineStart, cursor);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.length > 0) {
        const cols = parseCsvLine(line);
        totalRows++;
        const emailFound = emailFoundIdx != null ? (cols[emailFoundIdx] || '').trim() : '';
        const emailStatus = emailStatusIdx != null ? (cols[emailStatusIdx] || '').trim() : '';
        const email1Prepared = email1PreparedIdx != null ? (cols[email1PreparedIdx] || '').trim() : '';
        if (emailFound) rowsWithEmailFound++;
        if (emailStatus === 'valid') rowsValidEmail++;
        if (!email1Prepared) rowsEligibleEmail1++;
      }
      cursor++;
      lineStart = cursor;
      continue;
    }
    cursor++;
  }

  if (totalRows === 0) throw new Error('CSV has no data rows');

  return {
    headers,
    totalRows,
    rowsWithEmailFound,
    rowsValidEmail,
    rowsEligibleEmail1,
    fileSizeBytes: Buffer.byteLength(raw, 'utf8'),
  };
}

// --- Main ---

async function main() {
  const args = parseArgs(process.argv);

  if (!args.file) {
    console.error('error: --file is required');
    printUsage();
    process.exit(1);
  }

  const absFile = path.resolve(args.file);
  if (!fs.existsSync(absFile)) {
    console.error(`error: file not found: ${absFile}`);
    process.exit(1);
  }

  console.log(`Reading ${absFile} ...`);
  let stats;
  try {
    stats = validateAndCountCsv(absFile);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }

  const sourceFilename = path.basename(absFile);

  console.log('');
  console.log('CSV validation OK');
  console.log(`  source file:              ${sourceFilename}`);
  console.log(`  file size:                ${stats.fileSizeBytes.toLocaleString()} bytes`);
  console.log(`  total rows:               ${stats.totalRows.toLocaleString()}`);
  console.log(`  rows with email_found:    ${stats.rowsWithEmailFound.toLocaleString()}`);
  console.log(`  rows email_status=valid:  ${stats.rowsValidEmail.toLocaleString()}`);
  console.log(`  rows eligible Email 1:    ${stats.rowsEligibleEmail1.toLocaleString()}`);
  console.log('');

  if (args.dryRun) {
    console.log('[dry-run] Would upload to:');
    console.log(`  ${args.api}${UPLOAD_PATH}`);
    console.log('  R2 key: vlp-scale/prospects/master.csv');
    console.log('[dry-run] No network call made.');
    return;
  }

  const apiKey = args.apiKey || process.env.SCALE_API_KEY || loadDotEnvKey('SCALE_API_KEY');
  if (!apiKey) {
    console.error('error: no SCALE_API_KEY provided. Pass --api-key <value> or set SCALE_API_KEY in .env / environment.');
    process.exit(1);
  }

  const url = `${args.api}${UPLOAD_PATH}?source_filename=${encodeURIComponent(sourceFilename)}`;
  console.log(`Uploading to ${url} ...`);

  const body = fs.readFileSync(absFile);

  let res;
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/csv',
        'Authorization': `Bearer ${apiKey}`,
      },
      body,
    });
  } catch (err) {
    console.error(`error: network failure: ${err.message}`);
    process.exit(1);
  }

  const resText = await res.text();
  if (!res.ok) {
    console.error(`error: upload failed — HTTP ${res.status}`);
    console.error(resText);
    process.exit(1);
  }

  let parsed;
  try { parsed = JSON.parse(resText); } catch { parsed = { raw: resText }; }

  console.log('');
  console.log('Upload OK');
  console.log(JSON.stringify(parsed, null, 2));
}

main().catch(err => {
  console.error(`error: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
