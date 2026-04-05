#!/usr/bin/env node

/**
 * push-vlp-asset-pages.js
 *
 * Reads a VLP batch JSON file and writes each prospect's asset page data
 * to R2 at key: vlp-scale/asset-pages/{slug}.json
 *
 * Usage:
 *   node scale/push-vlp-asset-pages.js scale/batches/vlp-batch-2026-04-05.json
 *
 * This script outputs wrangler commands to upload each asset page to R2.
 * Pipe to bash to execute, or run with --exec to execute directly.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const execMode = args.includes('--exec');
const batchFile = args.find(a => !a.startsWith('--'));

if (!batchFile) {
  console.error('Usage: node scale/push-vlp-asset-pages.js <batch-file.json> [--exec]');
  console.error('');
  console.error('Options:');
  console.error('  --exec    Execute wrangler commands directly (default: print commands)');
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

const tmpDir = path.join(path.dirname(batchPath), '.tmp-asset-pages');

if (execMode && !fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

let pushed = 0;
let skipped = 0;
let errors = 0;

for (const prospect of batch) {
  const { slug, asset_page } = prospect;

  if (!slug || !asset_page) {
    console.error(`Skipping prospect: missing slug or asset_page`);
    skipped++;
    continue;
  }

  const r2Key = `vlp-scale/asset-pages/${slug}.json`;
  const payload = JSON.stringify(prospect, null, 2);

  if (execMode) {
    const tmpFile = path.join(tmpDir, `${slug}.json`);
    try {
      fs.writeFileSync(tmpFile, payload, 'utf-8');
      execSync(
        `wrangler r2 object put virtuallaunch-pro/${r2Key} --file "${tmpFile}"`,
        { stdio: 'inherit' }
      );
      pushed++;
    } catch (err) {
      console.error(`Failed to push ${slug}: ${err.message}`);
      errors++;
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  } else {
    // Print mode: output wrangler commands
    const tmpFile = path.join(tmpDir, `${slug}.json`);
    console.log(`# ${prospect.name} (${slug})`);
    console.log(`echo '${payload.replace(/'/g, "'\\''")}' > "${tmpFile}"`);
    console.log(`wrangler r2 object put virtuallaunch-pro/${r2Key} --file "${tmpFile}"`);
    console.log(`del "${tmpFile}" 2>/dev/null; rm -f "${tmpFile}" 2>/dev/null`);
    console.log('');
    pushed++;
  }
}

// Clean up tmp dir in exec mode
if (execMode && fs.existsSync(tmpDir)) {
  try { fs.rmdirSync(tmpDir); } catch { /* may not be empty */ }
}

console.error('');
console.error(`Asset page push complete:`);
console.error(`  Pushed: ${pushed}`);
console.error(`  Skipped: ${skipped}`);
if (errors > 0) console.error(`  Errors: ${errors}`);
console.error(`  R2 prefix: vlp-scale/asset-pages/`);
