#!/usr/bin/env node
/**
 * TTMP First-Batch Builder
 *
 * Selects 50 unenriched leads from the FOIA master, generates pattern emails
 * (first.last@domain), builds the 6-email TTMP send queue, and updates the
 * master in place.
 *
 * Inputs (local files written by `wrangler r2 object get`):
 *   scale/foia-master.json
 *
 * Outputs (local files; uploaded back to R2 by build-ttmp-batch-upload.sh):
 *   scale/ttmp-email1-pending.json
 *   scale/foia-master.updated.json
 *
 * Usage:
 *   node scale/build-ttmp-batch.js
 */

const fs = require('fs');
const path = require('path');

const MASTER_PATH = path.join(__dirname, 'foia-master.json');
const QUEUE_OUT   = path.join(__dirname, 'ttmp-email1-pending.json');
const MASTER_OUT  = path.join(__dirname, 'foia-master.updated.json');

const FREEMAIL = new Set([
  'gmail.com', 'yahoo.com', 'aol.com', 'hotmail.com', 'outlook.com',
  'icloud.com', 'me.com', 'mail.com', 'msn.com', 'live.com',
  'comcast.net', 'att.net', 'sbcglobal.net', 'verizon.net', 'cox.net',
  'charter.net'
]);

const ALLOWED_PROFESSIONS = new Set(['CPA', 'EA', 'ATTY']);
const TARGET_COUNT = 50;
const TODAY = new Date();
const TODAY_ISO = TODAY.toISOString();

function extractDomain(website) {
  if (!website) return '';
  let d = String(website).trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '');
  d = d.replace(/^www\./, '');
  d = d.split('/')[0];
  d = d.split('?')[0];
  d = d.split('#')[0];
  d = d.replace(/[^a-z0-9.\-]/g, '');
  return d;
}

function sanitizeNamePart(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '')
    .trim();
}

function titleCaseFirst(s) {
  if (!s) return '';
  const t = String(s).trim().split(/\s+/)[0].toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function titleCase(s) {
  if (!s) return '';
  return String(s).trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function makeSlug(first, last, city, state) {
  const parts = [first, last, city, state].map(p =>
    String(p || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  ).filter(Boolean);
  return parts.join('-');
}

function plusDays(n) {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---- Personalization tables --------------------------------------------------

const CRED = {
  EA:   { label: 'Enrolled Agent', billing: '$100-300', weekly: '6.7 hours', annual: '322 hours', revenue: '$27,300-$72,800' },
  CPA:  { label: 'CPA',            billing: '$150-400', weekly: '5 hours',   annual: '240 hours', revenue: '$36,000-$96,000' },
  ATTY: { label: 'Tax Attorney',   billing: '$200-500', weekly: '4 hours',   annual: '192 hours', revenue: '$38,400-$96,000' },
};

// ---- Email templates ---------------------------------------------------------

function email1(first, c) {
  const subject = `${first} — you're spending 3+ hours/week translating IRS codes by hand`;
  const body =
`Hello ${first},

Every transcript that hits your desk costs you about 20 minutes
of manual code lookup. At ${c.billing}/hr, that's
real revenue sitting in a task that should take 30 seconds.

${first}, Transcript Tax Monitor Pro parses IRS transcript PDFs
into plain-English reports automatically. Upload the PDF, get a
client-ready report with every transaction code explained.

Try the free IRS code lookup tool — no account needed:
https://transcript.taxmonitor.pro/resources

When you're ready for full transcript parsing:
https://transcript.taxmonitor.pro/pricing
10 analyses for $19.

—
Jamie L Williams, EA
Transcript Tax Monitor Pro
transcript.taxmonitor.pro
`;
  return { subject, body };
}

function email2(first, c, slug) {
  const subject = `Quick practice analysis for your firm, ${first} — ${c.annual}/yr on the table`;
  const body =
`Hello ${first},

I sent you a note a couple days ago about transcript automation.
Wanted to follow up with something specific.

${first}, I put together a quick practice analysis for your firm
based on typical ${c.label} transcript volume:

https://transcript.taxmonitor.pro/asset/${slug}

It breaks down estimated time savings, revenue recovery, and
how the tool fits into your current workflow. Takes about
60 seconds to review.

If you want to see it work live on a real transcript, I'm
happy to walk through it:
https://cal.com/vlp/ttmp-discovery

—
Jamie L Williams, EA
Transcript Tax Monitor Pro
transcript.taxmonitor.pro
`;
  return { subject, body };
}

function email3(first, c, city) {
  const subject = `${first} — what ${c.annual} unbilled hours cost your ${city} practice`;
  const body =
`Hello ${first},

Quick math for a ${c.label} in ${city}:

${first}, ${c.weekly}/week on manual transcript work
x 48 working weeks
= ${c.annual}/year

At your billing range, that's ${c.revenue} in time
you could be spending on client work instead of decoding
IRS transaction codes.

The tool runs locally in your browser — no data leaves your
machine. Upload a transcript PDF, get a report in seconds.

https://transcript.taxmonitor.pro/pricing
Starts at 10 analyses for $19.

—
Jamie L Williams, EA
Transcript Tax Monitor Pro
transcript.taxmonitor.pro
`;
  return { subject, body };
}

function email4(first) {
  const subject = `${first} — I built this because I got tired of the same 20-minute task`;
  const body =
`Hello ${first},

I'm an enrolled agent. Over the past two years I worked
1,200+ client cases across 5 firms — installment agreements,
offers in compromise, CDP hearings, multi-state compliance,
and a lot of transcript reviews.

Every case started the same way: pull the transcript, look up
the codes, translate them into something the client understands.
Twenty minutes, every time.

${first}, I built Transcript Tax Monitor Pro to eliminate that step.
Upload the PDF, get a plain-English report with every code
explained and recommendations included.

Here's my background if you want to verify who's behind this:
https://www.linkedin.com/in/virtuallaunchpro

And here's the tool:
https://transcript.taxmonitor.pro

No pitch. If you work with transcripts regularly, you'll see
the value in about 30 seconds.

—
Jamie L Williams, EA
Transcript Tax Monitor Pro
transcript.taxmonitor.pro
`;
  return { subject, body };
}

function email5(first) {
  const subject = `${first} — quick question`;
  const body =
`Hello ${first},

I've sent you a few emails about automating IRS transcript
analysis. ${first}, wanted to ask directly:

Is manual transcript work something that takes up meaningful
time in your practice?

If yes — the tool is at transcript.taxmonitor.pro and starts
at $19 for 10 analyses. Happy to do a quick walkthrough if
that's more useful:
https://cal.com/vlp/ttmp-discovery

If not — no worries at all, and I'll stop reaching out.

—
Jamie L Williams, EA
Transcript Tax Monitor Pro
transcript.taxmonitor.pro
`;
  return { subject, body };
}

function email6(first) {
  const subject = `Last note from me, ${first}`;
  const body =
`Hello ${first},

This is my last email on this. I know your inbox is busy.

${first}, if you ever need to parse an IRS transcript quickly,
the tool is here:
https://transcript.taxmonitor.pro

Free IRS code lookup (no account):
https://transcript.taxmonitor.pro/resources

10 full transcript analyses for $19:
https://transcript.taxmonitor.pro/pricing

I hope it saves you some time when you need it.

—
Jamie L Williams, EA
Transcript Tax Monitor Pro
transcript.taxmonitor.pro
`;
  return { subject, body };
}

// ---- Main --------------------------------------------------------------------

console.log('Reading master file:', MASTER_PATH);
const text = fs.readFileSync(MASTER_PATH, 'utf8');
const lines = text.split('\n');
const records = [];
for (const line of lines) {
  const t = line.trim();
  if (!t) continue;
  try { records.push(JSON.parse(t)); } catch {}
}
console.log(`Loaded ${records.length} records`);

// Filter
const candidates = [];
for (let i = 0; i < records.length; i++) {
  const r = records[i];
  if (!r.WEBSITE || !String(r.WEBSITE).trim()) continue;
  if (!ALLOWED_PROFESSIONS.has(String(r.PROFESSION || '').trim().toUpperCase())) continue;
  if (r.email_found && String(r.email_found).trim()) continue;
  if (r.email_status && String(r.email_status).trim()) continue;
  const domain = extractDomain(r.WEBSITE);
  if (!domain) continue;
  if (FREEMAIL.has(domain)) continue;
  const first = sanitizeNamePart(r.First_NAME);
  const last = sanitizeNamePart(r.LAST_NAME);
  if (!first || !last) continue;
  candidates.push({ idx: i, rec: r, domain, first, last });
}
console.log(`Eligible candidates: ${candidates.length}`);

candidates.sort((a, b) => {
  const la = String(a.rec.LAST_NAME || '').toLowerCase();
  const lb = String(b.rec.LAST_NAME || '').toLowerCase();
  return la.localeCompare(lb);
});

const selected = candidates.slice(0, TARGET_COUNT);
console.log(`Selected: ${selected.length}`);

const queue = [];
for (const s of selected) {
  const r = s.rec;
  const email = `${s.first}.${s.last}@${s.domain}`;
  const profession = String(r.PROFESSION || '').toUpperCase();
  const cred = CRED[profession] || CRED.EA;
  const firstDisplay = titleCaseFirst(r.First_NAME);
  const lastDisplay = titleCase(r.LAST_NAME);
  const cityDisplay = titleCase(r.BUS_ADDR_CITY);
  const stateDisplay = String(r.BUS_ST_CODE || '').toUpperCase();
  const slug = makeSlug(s.first, s.last, r.BUS_ADDR_CITY, r.BUS_ST_CODE);

  const e1 = email1(firstDisplay, cred);
  const e2 = email2(firstDisplay, cred, slug);
  const e3 = email3(firstDisplay, cred, cityDisplay);
  const e4 = email4(firstDisplay);
  const e5 = email5(firstDisplay);
  const e6 = email6(firstDisplay);

  queue.push({
    slug,
    email,
    first_name: firstDisplay,
    last_name: lastDisplay,
    profession,
    city: cityDisplay,
    state: stateDisplay,
    domain: s.domain,
    subject: e1.subject,
    body: e1.body,
    email_2_subject: e2.subject,
    email_2_body: e2.body,
    email_3_subject: e3.subject,
    email_3_body: e3.body,
    email_4_subject: e4.subject,
    email_4_body: e4.body,
    email_5_subject: e5.subject,
    email_5_body: e5.body,
    email_6_subject: e6.subject,
    email_6_body: e6.body,
    email_number: 1,
    status: 'pending',
    created_at: TODAY_ISO,
    email_2_scheduled_for: plusDays(2),
    email_3_scheduled_for: plusDays(4),
    email_4_scheduled_for: plusDays(6),
    email_5_scheduled_for: plusDays(8),
    email_6_scheduled_for: plusDays(10),
  });

  // Update master record in place
  r.email_found = email;
  r.email_status = 'pattern_unvalidated';
  r.ttmp_email_1_prepared_at = TODAY_ISO;
  if (!r.domain_clean) r.domain_clean = s.domain;
}

// Write queue
fs.writeFileSync(QUEUE_OUT, JSON.stringify(queue, null, 2));
console.log(`Wrote queue: ${QUEUE_OUT} (${queue.length} records)`);

// Write updated master as NDJSON
const ndjson = records.map(r => JSON.stringify(r)).join('\n') + '\n';
fs.writeFileSync(MASTER_OUT, ndjson);
console.log(`Wrote updated master: ${MASTER_OUT} (${records.length} records)`);

// Print first 5 selected
console.log('\nFirst 5 selected:');
for (let i = 0; i < Math.min(5, queue.length); i++) {
  const q = queue[i];
  console.log(`  ${i+1}. ${q.first_name} ${q.last_name} | ${q.domain} | ${q.email} | ${q.profession} | ${q.city}, ${q.state}`);
}
