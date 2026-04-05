#!/usr/bin/env node

/**
 * Restores vlp_email_1_prepared_at timestamps cleared by regenerate-assets.js.
 */

const fs = require('fs');
const path = require('path');

const masterPath = path.join(__dirname, '..', 'prospects', 'vlp-master.csv');
const backupPath = path.join(__dirname, '.ts-backup.json');

if (!fs.existsSync(backupPath)) {
  console.error('No timestamp backup found. Run regenerate-assets.js first.');
  process.exit(1);
}

const originals = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
const csv = fs.readFileSync(masterPath, 'utf8');
const lines = csv.split('\n');
const header = lines[0];
const headerCols = header.split(',');
const tsCol = headerCols.indexOf('vlp_email_1_prepared_at');

if (tsCol === -1) {
  console.error('Column vlp_email_1_prepared_at not found in CSV header');
  process.exit(1);
}

const restored = [header];
let j = 0;

for (let i = 1; i < lines.length; i++) {
  if (!lines[i].trim()) continue;
  const cols = lines[i].split(',');
  cols[tsCol] = originals[j] || cols[tsCol];
  j++;
  restored.push(cols.join(','));
}

fs.writeFileSync(masterPath, restored.join('\n') + '\n');
fs.unlinkSync(backupPath);

console.log(`Restored ${j} timestamps. Backup removed.`);
