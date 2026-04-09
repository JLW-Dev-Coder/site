#!/usr/bin/env node
/**
 * One-off cleanup: cancel all unpaid Stripe Payment Intents across the
 * VLP and TMP Stripe accounts. Skips PIs already in `succeeded` or
 * `canceled`. Reads keys from env vars only — never hardcoded.
 *
 * Usage:
 *   STRIPE_SECRET_KEY_VLP=sk_live_... STRIPE_SECRET_KEY=sk_live_... \
 *     node scripts/cleanup-test-stripe.js
 */

const ACCOUNTS = [
  { name: 'VLP', envVar: 'STRIPE_SECRET_KEY_VLP' },
  { name: 'TMP', envVar: 'STRIPE_SECRET_KEY' },
];

function usage(msg) {
  if (msg) console.error(`ERROR: ${msg}\n`);
  console.error('Usage:');
  console.error('  STRIPE_SECRET_KEY_VLP=sk_live_... STRIPE_SECRET_KEY=sk_live_... \\');
  console.error('    node scripts/cleanup-test-stripe.js');
  process.exit(1);
}

async function stripeGet(key, path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function stripePost(key, path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function processAccount({ name, envVar }) {
  const key = process.env[envVar];
  if (!key) {
    console.error(`[${name}] ${envVar} not set — skipping`);
    return 0;
  }

  let canceled = 0;
  let starting_after = null;
  let page = 0;

  while (true) {
    page += 1;
    const qs = new URLSearchParams({ limit: '100' });
    if (starting_after) qs.set('starting_after', starting_after);
    const data = await stripeGet(key, `payment_intents?${qs.toString()}`);
    const items = data.data || [];
    if (items.length === 0) break;

    for (const pi of items) {
      if (pi.status === 'succeeded' || pi.status === 'canceled') continue;
      try {
        const result = await stripePost(key, `payment_intents/${pi.id}/cancel`);
        canceled += 1;
        const amt = (result.amount / 100).toFixed(2);
        console.log(`Canceled ${result.id} — $${amt} ${result.currency} — ${result.status} — ${name}`);
      } catch (err) {
        console.error(`Failed to cancel ${pi.id} (${name}): ${err.message}`);
      }
    }

    if (!data.has_more) break;
    starting_after = items[items.length - 1].id;
    if (page > 50) break; // hard safety cap (5000 PIs)
  }

  return canceled;
}

(async () => {
  if (!process.env.STRIPE_SECRET_KEY_VLP && !process.env.STRIPE_SECRET_KEY) {
    usage('Both STRIPE_SECRET_KEY_VLP and STRIPE_SECRET_KEY are missing.');
  }

  const results = {};
  for (const acct of ACCOUNTS) {
    try {
      results[acct.name] = await processAccount(acct);
    } catch (err) {
      console.error(`[${acct.name}] fatal: ${err.message}`);
      results[acct.name] = 0;
    }
  }

  console.log('---');
  console.log(`Canceled ${results.VLP || 0} VLP, ${results.TMP || 0} TMP Payment Intents`);
})();
