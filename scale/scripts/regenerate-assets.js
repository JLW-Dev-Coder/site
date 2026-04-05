#!/usr/bin/env node

/**
 * Temporarily clears vlp_email_1_prepared_at timestamps in vlp-master.csv
 * so the batch generator will re-process all 33 prospects.
 *
 * After running the generator, restore timestamps with:
 *   node scale/scripts/restore-timestamps.js
 */

const fs = require('fs');
const path = require('path');

const masterPath = path.join(__dirname, '..', 'prospects', 'vlp-master.csv');

if (!fs.existsSync(masterPath)) {
  console.error(`Master CSV not found: ${masterPath}`);
  process.exit(1);
}

const csv = fs.readFileSync(masterPath, 'utf8');
const lines = csv.split('\n');
const header = lines[0];
const headerCols = header.split(',');
const tsCol = headerCols.indexOf('vlp_email_1_prepared_at');

if (tsCol === -1) {
  console.error('Column vlp_email_1_prepared_at not found in CSV header');
  process.exit(1);
}

// Save original timestamps
const originals = [];
const cleared = [header];

for (let i = 1; i < lines.length; i++) {
  if (!lines[i].trim()) continue;
  // Use simple split — vlp_email_1_prepared_at won't be quoted
  const cols = lines[i].split(',');
  originals.push(cols[tsCol] || '');
  cols[tsCol] = '';
  cleared.push(cols.join(','));
}

fs.writeFileSync(masterPath, cleared.join('\n') + '\n');

// Save originals for restore
const backupPath = path.join(__dirname, '.ts-backup.json');
fs.writeFileSync(backupPath, JSON.stringify(originals));

console.log(`Cleared ${originals.filter(t => t.trim()).length} timestamps from ${originals.length} rows.`);
console.log('Run the generator now, then: node scale/scripts/restore-timestamps.js');
