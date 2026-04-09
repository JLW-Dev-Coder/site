#!/usr/bin/env node
// One-shot: reset records where email_status === 'no_valid_pattern'
// (these were marked under quick mode or 403-mishandled runs)

const fs = require('fs');
const path = require('path');

const inFile = process.argv[2] || '/tmp/foia-master.json';
const outFile = process.argv[3] || '/tmp/foia-master.reset.json';

const lines = fs.readFileSync(inFile, 'utf8').split('\n');
let reset = 0;
let kept = 0;
const out = [];
for (const line of lines) {
  if (!line.trim()) continue;
  let rec;
  try { rec = JSON.parse(line); } catch { continue; }
  if (rec.email_status === 'no_valid_pattern') {
    rec.email_status = '';
    rec.email_found = '';
    reset++;
  }
  kept++;
  out.push(JSON.stringify(rec));
}
fs.writeFileSync(outFile, out.join('\n') + '\n');
console.log(JSON.stringify({ total_lines: kept, reset_count: reset, output: outFile }));
