#!/usr/bin/env node

/**
 * push-wlvlp-asset-pages.mjs
 *
 * Reads a WLVLP batch JSON file and uploads each prospect's full record
 * to R2 at key: vlp-scale/wlvlp-asset-pages/{slug}.json
 *
 * Usage:
 *   node scale/push-wlvlp-asset-pages.mjs <path-to-batch-json>
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const batchFile = process.argv[2];

if (!batchFile) {
  console.error('Usage: node scale/push-wlvlp-asset-pages.mjs <path-to-batch-json>');
  process.exit(1);
}

const batchPath = path.resolve(batchFile);
if (!fs.existsSync(batchPath)) {
  console.error(`Batch file not found: ${batchPath}`);
  process.exit(1);
}

const batch = JSON.parse(fs.readFileSync(batchPath, 'utf-8'));

if (!Array.isArray(batch) || batch.length === 0) {
  console.error('Batch file is empty or not an array');
  process.exit(1);
}

const tmpDir = path.join(path.dirname(batchPath), '.tmp-wlvlp-asset-pages');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

let pushed = 0;
let skipped = 0;
let errors = 0;

for (const prospect of batch) {
  const { slug } = prospect;

  if (!slug) {
    console.error('Skipping prospect: missing slug');
    skipped++;
    continue;
  }

  const r2Key = `vlp-scale/wlvlp-asset-pages/${slug}.json`;
  const payload = JSON.stringify(prospect, null, 2);
  const tmpFile = path.join(tmpDir, `${slug}.json`);

  try {
    fs.writeFileSync(tmpFile, payload, 'utf-8');
    const bytes = Buffer.byteLength(payload, 'utf-8');
    execSync(
      `wrangler r2 object put virtuallaunch-pro/${r2Key} --file "${tmpFile}" --remote`,
      { stdio: ['ignore', 'ignore', 'inherit'] }
    );
    console.log(`Uploaded: ${slug} (${bytes} bytes)`);
    pushed++;
  } catch (err) {
    console.error(`Failed to push ${slug}: ${err.message}`);
    errors++;
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

if (fs.existsSync(tmpDir)) {
  try { fs.rmdirSync(tmpDir); } catch { /* may not be empty */ }
}

console.log('');
console.log(`Pushed ${pushed} asset pages to R2`);
if (skipped > 0) console.log(`Skipped: ${skipped}`);
if (errors > 0) console.log(`Errors: ${errors}`);
