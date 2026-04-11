#!/usr/bin/env node
// Uploads tools/2848/template/f2848.pdf to R2 at key `tools/2848/f2848.pdf`.
// The Worker's /v1/tools/2848/generate route fetches this template at runtime
// and caches it in memory per isolate. Re-run this script only if the IRS
// reissues the form (also bump F2848_BUILD_ID in workers/src/index.js).
//
// Usage:
//   node scripts/upload-2848-template.js
//
// Requires:
//   CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN env vars
//   (token must have R2 write permission for the virtuallaunch-pro bucket)
//
// Alternative (requires wrangler auth):
//   wrangler r2 object put virtuallaunch-pro/tools/2848/f2848.pdf \
//     --file tools/2848/template/f2848.pdf \
//     --content-type application/pdf \
//     --remote

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const TEMPLATE_PATH = resolve(REPO_ROOT, 'tools/2848/template/f2848.pdf');
const BUCKET = 'virtuallaunch-pro';
const R2_KEY = 'tools/2848/f2848.pdf';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN');
  console.error('');
  console.error('Set them in your shell, or use wrangler instead:');
  console.error('  wrangler r2 object put virtuallaunch-pro/tools/2848/f2848.pdf \\');
  console.error('    --file tools/2848/template/f2848.pdf \\');
  console.error('    --content-type application/pdf --remote');
  process.exit(1);
}

const bytes = await readFile(TEMPLATE_PATH);
console.log(`Read ${TEMPLATE_PATH} (${bytes.length} bytes)`);

const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${R2_KEY}`;
const res = await fetch(url, {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${API_TOKEN}`,
    'Content-Type': 'application/pdf',
  },
  body: bytes,
});

if (!res.ok) {
  const body = await res.text();
  console.error(`Upload failed: HTTP ${res.status}`);
  console.error(body);
  process.exit(1);
}

console.log(`Uploaded to R2: ${BUCKET}/${R2_KEY}`);
