#!/usr/bin/env node
/**
 * One-shot CAN-SPAM footer backfill for the three existing send queues.
 *
 * Idempotent — only patches body fields that don't already contain
 * "1175 Avocado Avenue". Downloads each queue from R2 via wrangler,
 * appends the per-campaign footer to email_1..6 bodies in-place, and
 * uploads back to R2.
 *
 * Usage:
 *   node scale/scripts/patch-canspam-footer.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const STAMP = '1175 Avocado Avenue';
const BUCKET = 'virtuallaunch-pro';

const TARGETS = [
  { campaign: 'ttmp',  key: 'vlp-scale/ttmp-send-queue/email1-pending.json'  },
  { campaign: 'vlp',   key: 'vlp-scale/vlp-send-queue/email1-pending.json'   },
  { campaign: 'wlvlp', key: 'vlp-scale/wlvlp-send-queue/email1-pending.json' },
];

function footer(campaign, email) {
  const enc = encodeURIComponent(email || '');
  if (campaign === 'ttmp') {
    return `
—
Jamie L Williams, EA
Transcript Tax Monitor Pro
transcript.taxmonitor.pro

Lenore, Inc c/o Virtual Launch Pro
1175 Avocado Avenue Suite 101 PMB 1010
El Cajon, CA 92020

To stop receiving these emails:
https://api.virtuallaunch.pro/unsubscribe?email=${enc}&campaign=ttmp
`;
  }
  if (campaign === 'vlp') {
    return `
—
Jamie L Williams, EA
Virtual Launch Pro
virtuallaunch.pro

Lenore, Inc c/o Virtual Launch Pro
1175 Avocado Avenue Suite 101 PMB 1010
El Cajon, CA 92020

To stop receiving these emails:
https://api.virtuallaunch.pro/unsubscribe?email=${enc}&campaign=vlp
`;
  }
  return `
—
Jamie L Williams, EA
Website Lotto by Virtual Launch Pro
websitelotto.virtuallaunch.pro

Lenore, Inc c/o Virtual Launch Pro
1175 Avocado Avenue Suite 101 PMB 1010
El Cajon, CA 92020

To stop receiving these emails:
https://api.virtuallaunch.pro/unsubscribe?email=${enc}&campaign=wlvlp
`;
}

const BODY_KEYS = ['body', 'email_2_body', 'email_3_body', 'email_4_body', 'email_5_body', 'email_6_body'];

function patchFile(target) {
  const tmp = path.join(os.tmpdir(), `canspam-${target.campaign}-${Date.now()}.json`);
  console.log(`\n=== ${target.campaign.toUpperCase()} ===`);
  console.log(`Downloading ${target.key} → ${tmp}`);
  try {
    execSync(`wrangler r2 object get ${BUCKET}/${target.key} --file "${tmp}" --remote`, { stdio: 'inherit' });
  } catch (e) {
    console.error(`Download failed for ${target.key}:`, e.message);
    return;
  }
  const raw = fs.readFileSync(tmp, 'utf8');
  let arr;
  try { arr = JSON.parse(raw); } catch (e) { console.error('Parse failed:', e.message); return; }
  if (!Array.isArray(arr)) { console.error('Not an array, skipping'); return; }
  let recordsPatched = 0;
  let bodiesPatched = 0;
  for (const rec of arr) {
    const f = footer(target.campaign, rec.email || '');
    let touched = false;
    for (const bk of BODY_KEYS) {
      const cur = rec[bk];
      if (typeof cur === 'string' && cur.length > 0 && cur.indexOf(STAMP) === -1) {
        rec[bk] = cur + f;
        bodiesPatched++;
        touched = true;
      }
    }
    if (touched) recordsPatched++;
  }
  console.log(`Records in queue: ${arr.length}, records patched: ${recordsPatched}, bodies patched: ${bodiesPatched}`);
  fs.writeFileSync(tmp, JSON.stringify(arr));
  console.log(`Uploading patched queue back to R2`);
  execSync(
    `wrangler r2 object put ${BUCKET}/${target.key} --file "${tmp}" --content-type application/json --remote`,
    { stdio: 'inherit' }
  );
  fs.unlinkSync(tmp);
}

for (const t of TARGETS) {
  patchFile(t);
}
console.log('\nDone.');
