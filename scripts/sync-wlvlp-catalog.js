#!/usr/bin/env node
/**
 * sync-wlvlp-catalog.js
 *
 * Reads wlvlp-catalog.json from the WLVLP repo and upserts every template
 * into the D1 `wlvlp_templates` table via `wrangler d1 execute`.
 *
 * Usage:
 *   node scripts/sync-wlvlp-catalog.js [--catalog <path>] [--dry-run]
 *
 * Defaults:
 *   --catalog  ../websitelotto.virtuallaunch.pro/wlvlp-catalog.json
 *              (looks relative to this script's parent dir, or the sibling repo)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const catalogIdx = args.indexOf('--catalog');

// Resolve catalog path
const repoRoot = path.resolve(__dirname, '..');
const defaultPaths = [
  path.join(repoRoot, '..', 'websitelotto.virtuallaunch.pro', 'wlvlp-catalog.json'),
  'C:\\Users\\eimaj\\websitelotto.virtuallaunch.pro\\wlvlp-catalog.json',
];
let catalogPath = catalogIdx !== -1 ? args[catalogIdx + 1] : null;
if (!catalogPath) {
  catalogPath = defaultPaths.find(p => fs.existsSync(p));
}
if (!catalogPath || !fs.existsSync(catalogPath)) {
  console.error('ERROR: wlvlp-catalog.json not found. Pass --catalog <path>');
  process.exit(1);
}

// Category mapping (same as WLVLP frontend lib/api.ts)
const CATEGORY_MAP = {
  'Tax and Finance': 'finance',
  'Legal': 'legal',
  'Food and Beverage': 'food/bev',
  'Sports and Fitness': 'health',
  'Services': 'services',
  'Beauty and Fashion': 'creative',
  'Entertainment': 'creative',
  'Real Estate and Home': 'services',
  'Tech and Digital': 'services',
  'Lifestyle and Hobby': 'other',
  'Travel and Adventure': 'other',
  'Uncategorized': 'other',
};

// Load catalog
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const sites = catalog.sites.filter(s => s.slug && s.slug !== 'index');
console.log(`Loaded ${sites.length} templates from catalog`);

// Build SQL statements in batches (D1 has a statement size limit)
const BATCH_SIZE = 25;
const now = new Date().toISOString();
let synced = 0;
let errors = 0;

function escSql(s) {
  if (s == null) return 'NULL';
  return "'" + String(s).replace(/'/g, "''") + "'";
}

const batches = [];
for (let i = 0; i < sites.length; i += BATCH_SIZE) {
  const chunk = sites.slice(i, i + BATCH_SIZE);
  const stmts = chunk.map(s => {
    const primary = s.categories?.[0] ?? 'Uncategorized';
    const category = CATEGORY_MAP[primary] ?? 'other';
    const title = s.title || s.slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const status = s.status || 'available';
    // INSERT OR IGNORE preserves existing rows (keeps vote_count, auction state, etc.)
    return `INSERT INTO wlvlp_templates (slug, title, category, status, vote_count, bid_start_price, buy_now_price, created_at, updated_at) VALUES (${escSql(s.slug)}, ${escSql(title)}, ${escSql(category)}, ${escSql(status)}, 0, 29, 99, ${escSql(now)}, ${escSql(now)}) ON CONFLICT(slug) DO UPDATE SET title = ${escSql(title)}, category = ${escSql(category)}, updated_at = ${escSql(now)} WHERE title IS NULL OR title = slug;`;
  });
  batches.push(stmts);
}

console.log(`Processing ${batches.length} batches (${BATCH_SIZE} templates each)...`);

for (let i = 0; i < batches.length; i++) {
  const stmts = batches[i];
  const sql = stmts.join('\n');

  if (dryRun) {
    console.log(`[DRY RUN] Batch ${i + 1}: ${stmts.length} templates`);
    synced += stmts.length;
    continue;
  }

  try {
    // Write SQL to temp file to avoid shell quoting issues
    const tmpFile = path.join(repoRoot, `.tmp-sync-batch-${i}.sql`);
    fs.writeFileSync(tmpFile, sql, 'utf8');
    execSync(`wrangler d1 execute virtuallaunch-pro --remote --file="${tmpFile}"`, {
      cwd: repoRoot,
      stdio: 'pipe',
      timeout: 30000,
    });
    fs.unlinkSync(tmpFile);
    synced += stmts.length;
    process.stdout.write(`  Batch ${i + 1}/${batches.length}: ${stmts.length} templates ✓\n`);
  } catch (e) {
    errors++;
    console.error(`  Batch ${i + 1} FAILED:`, e.stderr?.toString().slice(0, 200) || e.message);
    // Clean up temp file
    const tmpFile = path.join(repoRoot, `.tmp-sync-batch-${i}.sql`);
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

console.log(`\nDone. Synced: ${synced}, Errors: ${errors}`);
if (dryRun) console.log('(dry run — no changes written)');
