#!/usr/bin/env node
// Upload WLVLP preview.html templates from the WLVLP repo to R2 so the
// VLP Worker's WLVLP site generation cron can read them at runtime.
//
// Usage:
//   node scale/upload-wlvlp-templates.mjs <path-to-wlvlp-repo>
//
// Example:
//   node scale/upload-wlvlp-templates.mjs ../websitelotto.virtuallaunch.pro
//
// Templates land at: vlp-scale/wlvlp-templates/{slug}.html
//
// Keep this map in sync with WLVLP_TEMPLATE_MAP in workers/src/index.js.

import { existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const WLVLP_TEMPLATE_MAP = {
  CPA:     'clear-ledger-bookkeeping',
  EA:      'tax-preparation-now',
  ATTY:    'tax-attorney-services',
  DEFAULT: 'tax-command-advisory',
};

const wlvlpRepoArg = process.argv[2];
if (!wlvlpRepoArg) {
  console.error('Usage: node scale/upload-wlvlp-templates.mjs <path-to-wlvlp-repo>');
  process.exit(1);
}

const wlvlpRepo = resolve(wlvlpRepoArg);
const sitesDir = join(wlvlpRepo, 'public', 'sites');
if (!existsSync(sitesDir)) {
  console.error(`WLVLP sites directory not found: ${sitesDir}`);
  process.exit(1);
}

const slugs = Array.from(new Set(Object.values(WLVLP_TEMPLATE_MAP)));
const results = [];

for (const slug of slugs) {
  const previewPath = join(sitesDir, slug, 'preview.html');
  if (!existsSync(previewPath)) {
    console.error(`MISSING: ${previewPath}`);
    results.push({ slug, ok: false, reason: 'missing' });
    continue;
  }
  const size = statSync(previewPath).size;
  const r2Key = `vlp-scale/wlvlp-templates/${slug}.html`;
  console.log(`Uploading ${slug} (${size} bytes) → r2://virtuallaunch-pro/${r2Key}`);

  const res = spawnSync(
    'wrangler',
    [
      'r2',
      'object',
      'put',
      `virtuallaunch-pro/${r2Key}`,
      '--file',
      previewPath,
      '--content-type',
      'text/html; charset=utf-8',
      '--remote',
    ],
    { stdio: 'inherit', shell: true }
  );

  if (res.status === 0) {
    results.push({ slug, ok: true, size, key: r2Key });
  } else {
    console.error(`Upload failed for ${slug} (exit ${res.status})`);
    results.push({ slug, ok: false, reason: `wrangler exit ${res.status}` });
  }
}

console.log('\n--- Summary ---');
for (const r of results) {
  if (r.ok) {
    console.log(`OK   ${r.slug}  ${r.key}  (${r.size} bytes)`);
  } else {
    console.log(`FAIL ${r.slug}  ${r.reason}`);
  }
}
const failed = results.filter((r) => !r.ok).length;
process.exit(failed === 0 ? 0 : 2);
