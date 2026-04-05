#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PROSPECTS_DIR = path.join(__dirname, '..', 'prospects');
const LOCKFILE = path.join(PROSPECTS_DIR, '.batch-in-progress');
const INTAKE_PATH = path.join(PROSPECTS_DIR, 'new-prospects.csv');
const MASTER_PATH = path.join(PROSPECTS_DIR, 'vlp-master.csv');
const ARCHIVE_DIR = path.join(PROSPECTS_DIR, 'archive');

const MASTER_HEADERS = [
  'LAST_NAME', 'First_NAME', 'DBA', 'BUS_ADDR_CITY', 'BUS_ST_CODE',
  'WEBSITE', 'BUS_PHNE_NBR', 'PROFESSION', 'domain_clean', 'email_found',
  'email_status', 'firm_bucket', 'clay_workbook_ref',
  'vlp_email_1_prepared_at', 'vlp_email_2_prepared_at', 'vlp_email_3_prepared_at'
];

// --- CSV helpers (no external deps) ---

function parseCSVRow(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

function escapeCSVField(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function rowToCSV(headers, obj) {
  return headers.map(h => escapeCSVField(obj[h] || '')).join(',');
}

// --- Read CSV file into { headers: string[], rows: object[] } ---

function readCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCSVRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVRow(lines[i]);
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = fields[j] !== undefined ? fields[j] : '';
    }
    rows.push(obj);
  }
  return { headers, rows };
}

// --- Validation ---

function validateRow(row, index) {
  const email = (row.email_found || '').trim();
  if (!email || email === 'undefined' || email === 'NaN' || email.toLowerCase() === 'nan') {
    return `Row ${index + 1}: empty or invalid email_found`;
  }

  if (!(row.LAST_NAME || '').trim()) return `Row ${index + 1}: missing LAST_NAME`;
  if (!(row.First_NAME || '').trim()) return `Row ${index + 1}: missing First_NAME`;
  if (!(row.BUS_ADDR_CITY || '').trim()) return `Row ${index + 1}: missing BUS_ADDR_CITY`;

  const state = (row.BUS_ST_CODE || '').trim();
  if (!state || state.length !== 2) return `Row ${index + 1}: missing or invalid BUS_ST_CODE (need 2 letters)`;

  if (!(row.PROFESSION || '').trim()) return `Row ${index + 1}: missing PROFESSION`;
  if (!(row.firm_bucket || '').trim()) return `Row ${index + 1}: missing firm_bucket`;

  return null; // valid
}

// --- Main ---

function main() {
  // 1. Check lockfile
  if (fs.existsSync(LOCKFILE)) {
    console.error('ERROR: Lockfile exists at scale/prospects/.batch-in-progress');
    console.error('A batch generation is in progress. Wait for it to finish and try again.');
    process.exit(1);
  }

  // 2. Read intake file
  if (!fs.existsSync(INTAKE_PATH)) {
    console.error('ERROR: No intake file found at scale/prospects/new-prospects.csv');
    process.exit(1);
  }
  const intakeContent = fs.readFileSync(INTAKE_PATH, 'utf-8').trim();
  const intakeLines = intakeContent.split(/\r?\n/).filter(l => l.trim() !== '');
  if (intakeLines.length <= 1) {
    console.error('ERROR: Intake file is empty (headers only).');
    process.exit(1);
  }
  const intake = readCSV(INTAKE_PATH);
  console.log(`Read ${intake.rows.length} rows from new-prospects.csv`);

  // 3. Read or create master CSV
  let master;
  if (fs.existsSync(MASTER_PATH)) {
    master = readCSV(MASTER_PATH);
    console.log(`Existing master CSV: ${master.rows.length} rows`);
  } else {
    master = { headers: MASTER_HEADERS, rows: [] };
    console.log('No master CSV found — creating new one');
  }

  // Build set of existing emails in master (lowercase)
  const masterEmails = new Set();
  for (const row of master.rows) {
    const email = (row.email_found || '').trim().toLowerCase();
    if (email) masterEmails.add(email);
  }

  // 4. Validate and deduplicate intake rows
  const stats = {
    total: intake.rows.length,
    appended: 0,
    duplicates: 0,
    invalid: 0,
  };

  const validRows = [];
  const seenIntakeEmails = new Set();

  for (let i = 0; i < intake.rows.length; i++) {
    const row = intake.rows[i];

    // Validate
    const error = validateRow(row, i);
    if (error) {
      console.log(`  SKIP (invalid): ${error}`);
      stats.invalid++;
      continue;
    }

    const emailLower = row.email_found.trim().toLowerCase();

    // Dedup against master
    if (masterEmails.has(emailLower)) {
      stats.duplicates++;
      continue;
    }

    // Dedup within intake
    if (seenIntakeEmails.has(emailLower)) {
      stats.duplicates++;
      continue;
    }
    seenIntakeEmails.add(emailLower);

    validRows.push(row);
  }

  stats.appended = validRows.length;

  // 5. Build master rows from valid intake (drop FULL_NAME, add tracking columns)
  const newMasterRows = validRows.map(row => {
    const masterRow = {};
    for (const col of MASTER_HEADERS) {
      if (['vlp_email_1_prepared_at', 'vlp_email_2_prepared_at', 'vlp_email_3_prepared_at'].includes(col)) {
        masterRow[col] = row[col] || '';
      } else {
        masterRow[col] = row[col] !== undefined ? row[col] : '';
      }
    }
    return masterRow;
  });

  // 6. Append to master
  if (!fs.existsSync(MASTER_PATH)) {
    // Create new master with headers + rows
    const lines = [MASTER_HEADERS.join(',')];
    for (const row of newMasterRows) {
      lines.push(rowToCSV(MASTER_HEADERS, row));
    }
    fs.writeFileSync(MASTER_PATH, lines.join('\n') + '\n');
  } else if (newMasterRows.length > 0) {
    const masterContent = fs.readFileSync(MASTER_PATH, 'utf-8');
    const separator = masterContent.endsWith('\n') ? '' : '\n';
    const appendLines = newMasterRows.map(row => rowToCSV(MASTER_HEADERS, row));
    fs.appendFileSync(MASTER_PATH, separator + appendLines.join('\n') + '\n');
  }

  // 7. Archive intake file
  if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  }
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  let archiveName = `intake-${timestamp}.csv`;
  let archivePath = path.join(ARCHIVE_DIR, archiveName);
  let suffix = 2;
  while (fs.existsSync(archivePath)) {
    archiveName = `intake-${timestamp}-${suffix}.csv`;
    archivePath = path.join(ARCHIVE_DIR, archiveName);
    suffix++;
  }
  fs.copyFileSync(INTAKE_PATH, archivePath);

  // 8. Truncate intake to headers only
  const intakeHeader = intakeLines[0];
  fs.writeFileSync(INTAKE_PATH, intakeHeader + '\n');

  // 9. Recount master
  const updatedMaster = readCSV(MASTER_PATH);
  const masterTotal = updatedMaster.rows.length;

  // 10. Print summary
  console.log('');
  console.log('Merge complete');
  console.log(`Rows in intake: ${stats.total}`);
  console.log(`Valid rows appended: ${stats.appended}`);
  console.log(`Duplicates skipped: ${stats.duplicates}`);
  console.log(`Invalid rows skipped: ${stats.invalid}`);
  console.log(`Master CSV total rows: ${masterTotal}`);
  console.log(`Archived to: scale/prospects/archive/${archiveName}`);
}

main();
