#!/usr/bin/env node
// csv-to-r2.mjs — convert a WLVLP prospect CSV to JSON and upload to R2.
//
// Usage:
//   node scale/csv-to-r2.mjs <path/to/prospects.csv>
//
// Writes to R2 at: vlp-scale/wlvlp-prospects/active.json
// This is the single manual step in the WLVLP SCALE pipeline. After upload,
// the VLP Worker cron at 12:00 UTC handles crawling, scoring, email copy
// generation, asset page writes, and send queue population automatically.

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node scale/csv-to-r2.mjs <prospects.csv>');
  process.exit(1);
}

const abs = resolve(csvPath);
const raw = readFileSync(abs, 'utf8');
const rows = parseCSV(raw);
if (rows.length < 2) {
  console.error('CSV has no data rows.');
  process.exit(1);
}

const headers = rows[0].map(h => h.trim());
const dataRows = rows.slice(1).filter(r => r.length > 0 && r.some(c => c !== ''));
const prospects = dataRows.map(row => {
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    obj[headers[i]] = row[i] ?? '';
  }
  return obj;
});

const tmpPath = resolve('scale', `active-prospects-${Date.now()}.json`);
writeFileSync(tmpPath, JSON.stringify(prospects), 'utf8');

console.log(`Parsed ${prospects.length} prospects from ${csvPath}`);
console.log(`Uploading to R2: vlp-scale/wlvlp-prospects/active.json`);

const isWindows = process.platform === 'win32';
const result = spawnSync(
  isWindows ? 'cmd.exe' : 'npx',
  isWindows
    ? ['/c', 'npx', 'wrangler', 'r2', 'object', 'put', 'virtuallaunch-pro/vlp-scale/wlvlp-prospects/active.json', '--file', tmpPath, '--content-type', 'application/json', '--remote']
    : ['wrangler', 'r2', 'object', 'put', 'virtuallaunch-pro/vlp-scale/wlvlp-prospects/active.json', '--file', tmpPath, '--content-type', 'application/json', '--remote'],
  { stdio: 'inherit' }
);

try { unlinkSync(tmpPath); } catch {}

if (result.status !== 0) {
  console.error(`wrangler exited with code ${result.status}`);
  process.exit(result.status || 1);
}

console.log(`Uploaded ${prospects.length} prospects to R2.`);
