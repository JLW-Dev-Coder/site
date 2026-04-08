#!/usr/bin/env node

/**
 * push-wlvlp-email1-queue.mjs
 *
 * Reads a Gmail-formatted CSV (email,first_name,subject,body) and uploads it
 * as a JSON array to R2 at:
 *   vlp-scale/wlvlp-send-queue/email1-pending.json
 *
 * The VLP Worker cron reads this queue and sends each message.
 *
 * Usage:
 *   node scale/push-wlvlp-email1-queue.mjs <path-to-gmail-csv>
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const csvFile = process.argv[2];

if (!csvFile) {
  console.error('Usage: node scale/push-wlvlp-email1-queue.mjs <path-to-gmail-csv>');
  process.exit(1);
}

const csvPath = path.resolve(csvFile);
if (!fs.existsSync(csvPath)) {
  console.error(`CSV file not found: ${csvPath}`);
  process.exit(1);
}

// RFC-4180 CSV parser (handles quoted fields with commas, newlines, escaped quotes)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }

    if (c === '\r') {
      i++;
      continue;
    }

    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }

    field += c;
    i++;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

const raw = fs.readFileSync(csvPath, 'utf-8');
const rows = parseCsv(raw).filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));

if (rows.length < 2) {
  console.error('CSV has no data rows');
  process.exit(1);
}

const header = rows[0].map((h) => h.trim());
const required = ['email', 'first_name', 'subject', 'body'];
for (const col of required) {
  if (!header.includes(col)) {
    console.error(`CSV missing required column: ${col}`);
    process.exit(1);
  }
}

const idx = Object.fromEntries(header.map((h, i) => [h, i]));

const records = [];
for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  if (row.every((c) => c === '')) continue;
  records.push({
    email: row[idx.email] || '',
    first_name: row[idx.first_name] || '',
    subject: row[idx.subject] || '',
    body: row[idx.body] || '',
  });
}

if (records.length === 0) {
  console.error('No records parsed from CSV');
  process.exit(1);
}

const r2Key = 'vlp-scale/wlvlp-send-queue/email1-pending.json';
const payload = JSON.stringify(records, null, 2);
const tmpFile = path.join(path.dirname(csvPath), '.tmp-email1-pending.json');

try {
  fs.writeFileSync(tmpFile, payload, 'utf-8');
  const bytes = Buffer.byteLength(payload, 'utf-8');
  execSync(
    `wrangler r2 object put virtuallaunch-pro/${r2Key} --file "${tmpFile}" --remote --content-type application/json`,
    { stdio: ['ignore', 'inherit', 'inherit'] }
  );
  console.log('');
  console.log(`Pushed ${records.length} records to R2`);
  console.log(`Key: ${r2Key}`);
  console.log(`Size: ${bytes} bytes`);
} catch (err) {
  console.error(`Upload failed: ${err.message}`);
  process.exit(1);
} finally {
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
}
