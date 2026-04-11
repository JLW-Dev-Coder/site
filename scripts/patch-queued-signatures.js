#!/usr/bin/env node
/**
 * patch-queued-signatures.js
 *
 * One-shot R2 patch: strips duplicate signature blocks from every pending
 * send-queue record across TTMP, VLP, and WLVLP. Each email body previously
 * contained two copies of the signature — one from the template, one from
 * the CAN-SPAM footer appended by buildXQueueRecord. The template copy has
 * been removed at source, but records already queued in R2 still carry the
 * duplicate.
 *
 * Usage:
 *   node scripts/patch-queued-signatures.js            # dry-run (default)
 *   node scripts/patch-queued-signatures.js --exec     # write patched files back to R2
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXEC = process.argv.includes('--exec');
const BUCKET = 'virtuallaunch-pro';

const QUEUES = [
  { platform: 'ttmp',  key: 'vlp-scale/ttmp-send-queue/email1-pending.json' },
  { platform: 'vlp',   key: 'vlp-scale/vlp-send-queue/email1-pending.json' },
  { platform: 'wlvlp', key: 'vlp-scale/wlvlp-send-queue/email1-pending.json' },
];

const SIG_BLOCKS = {
  ttmp:  '\n—\nJamie L Williams, EA\nTranscript Tax Monitor Pro\ntranscript.taxmonitor.pro\n',
  vlp:   '\n—\nJamie L Williams, EA\nVirtual Launch Pro\nvirtuallaunch.pro\n',
  wlvlp: '\n—\nJamie L Williams, EA\nWebsite Lotto by Virtual Launch Pro\nwebsitelotto.virtuallaunch.pro\n',
};

const BODY_FIELDS = ['body', 'email_2_body', 'email_3_body', 'email_4_body', 'email_5_body', 'email_6_body'];

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }).trim();
}

function fetchR2Json(key) {
  try {
    const raw = run(`wrangler r2 object get ${BUCKET}/${key} --remote --pipe`);
    return JSON.parse(raw);
  } catch (e) {
    if (/not found|NoSuchKey|404/i.test(String(e.message || e))) return null;
    throw e;
  }
}

function writeR2Json(key, data) {
  const tmpFile = path.join(__dirname, `_tmp_${key.replace(/[\/]/g, '_')}`);
  fs.writeFileSync(tmpFile, JSON.stringify(data), 'utf8');
  try {
    run(`wrangler r2 object put ${BUCKET}/${key} --remote --file "${tmpFile}" --content-type application/json`);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// Remove the first of two consecutive identical signature blocks.
// Leaves the signature in the CAN-SPAM footer (the second occurrence) intact.
// Returns { body, changed }.
function stripDuplicateSignature(body, sig) {
  if (typeof body !== 'string' || !body.includes(sig)) return { body, changed: false };
  const first = body.indexOf(sig);
  const second = body.indexOf(sig, first + sig.length);
  if (second === -1) return { body, changed: false };
  return {
    body: body.slice(0, first) + body.slice(first + sig.length),
    changed: true,
  };
}

function patchRecord(record, sig) {
  let changedFields = 0;
  for (const field of BODY_FIELDS) {
    if (!record[field]) continue;
    const { body, changed } = stripDuplicateSignature(record[field], sig);
    if (changed) {
      record[field] = body;
      changedFields++;
    }
  }
  return changedFields;
}

async function main() {
  console.log(`Mode: ${EXEC ? 'EXEC (will write to R2)' : 'DRY RUN (no writes — pass --exec to commit)'}`);
  console.log('');

  const totals = { queues: 0, records: 0, patchedRecords: 0, patchedFields: 0, byPlatform: {} };

  for (const { platform, key } of QUEUES) {
    console.log(`== ${platform.toUpperCase()} :: ${key}`);
    const queue = fetchR2Json(key);
    if (!queue) {
      console.log('  (not found — skipping)');
      totals.byPlatform[platform] = { records: 0, patched: 0, found: false };
      continue;
    }
    if (!Array.isArray(queue)) {
      console.log(`  (unexpected shape — expected array, got ${typeof queue})`);
      totals.byPlatform[platform] = { records: 0, patched: 0, found: false };
      continue;
    }
    totals.queues++;
    const sig = SIG_BLOCKS[platform];
    let patchedRecords = 0;
    let patchedFieldsInQueue = 0;
    for (const record of queue) {
      const n = patchRecord(record, sig);
      if (n > 0) {
        patchedRecords++;
        patchedFieldsInQueue += n;
      }
    }
    totals.records += queue.length;
    totals.patchedRecords += patchedRecords;
    totals.patchedFields += patchedFieldsInQueue;
    totals.byPlatform[platform] = { records: queue.length, patched: patchedRecords, found: true };
    console.log(`  records: ${queue.length}`);
    console.log(`  records with duplicated signatures: ${patchedRecords}`);
    console.log(`  body fields patched: ${patchedFieldsInQueue}`);

    if (patchedRecords > 0 && EXEC) {
      writeR2Json(key, queue);
      console.log('  ✓ written back to R2');
    } else if (patchedRecords > 0) {
      console.log('  (dry-run — not written)');
    }
    console.log('');
  }

  const platformsTouched = Object.entries(totals.byPlatform)
    .filter(([, v]) => v.patched > 0)
    .map(([p]) => p);
  console.log('='.repeat(60));
  console.log(`Patched ${totals.patchedRecords} records across ${platformsTouched.length ? platformsTouched.join(', ') : 'no'} platforms`);
  console.log(`(${totals.patchedFields} body fields across ${totals.records} total records in ${totals.queues} queues)`);
  if (!EXEC && totals.patchedRecords > 0) {
    console.log('');
    console.log('Dry run — re-run with --exec to commit.');
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
