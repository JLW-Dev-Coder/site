// scale/push-workflow.js
//
// Reads scale/WORKFLOW.md from the local filesystem and uploads it to R2 at
// vlp-scale/workflow.md so the Worker can serve it via /v1/admin/scale/workflow.
//
// Usage:
//   node scale/push-workflow.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SOURCE = path.join('scale', 'WORKFLOW.md');
const R2_KEY = 'vlp-scale/workflow.md';
const BUCKET = 'virtuallaunch-pro';

if (!fs.existsSync(SOURCE)) {
  console.error(`ERROR: ${SOURCE} not found. Run from repo root.`);
  process.exit(1);
}

const content = fs.readFileSync(SOURCE, 'utf-8');

// Stage to a temp file (avoid echo/pipe corruption on Windows)
const tmp = path.join(os.tmpdir(), `vlp-workflow-${Date.now()}.md`);
fs.writeFileSync(tmp, content, 'utf-8');

try {
  execSync(
    `wrangler r2 object put ${BUCKET}/${R2_KEY} --file "${tmp}" --content-type "text/markdown" --remote`,
    { stdio: 'inherit' }
  );
  console.log(`Pushed WORKFLOW.md to R2: ${R2_KEY} (${content.length} bytes)`);
} finally {
  try { fs.unlinkSync(tmp); } catch (_) {}
}
