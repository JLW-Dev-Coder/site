// Run with: node scripts/upload-wlvlp-sites.mjs
// Requires: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN env vars
// Also requires the websitelotto.virtuallaunch.pro repo to be at ../websitelotto.virtuallaunch.pro

import { readdir, readFile } from 'fs/promises'
import { join } from 'path'

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN
const BUCKET = 'virtuallaunch-pro'
const SITES_DIR = '../websitelotto.virtuallaunch.pro/public/sites'

// Fix 3 — Better token validation
if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('❌ Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN')
  process.exit(1)
}
console.log(`✓ Using account: ${ACCOUNT_ID}`)
console.log(`✓ Token starts with: ${API_TOKEN.substring(0, 8)}...`)

// Fix 2 — Add retry logic
async function uploadWithRetry(slug, html, key) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${key}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'text/html',
        },
        body: html
      }
    )

    if (res.status === 429 && attempt === 1) {
      console.log(`⏳ Rate limited on ${slug}, retrying in 2s...`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      continue
    }
    return res
  }
}

try {
  const dirs = await readdir(SITES_DIR)
  console.log(`📁 Found ${dirs.length} template directories`)

  for (const slug of dirs) {
    const htmlPath = join(SITES_DIR, slug, 'index.html')
    try {
      const html = await readFile(htmlPath, 'utf-8')
      const key = `wlvlp/sites/${slug}/index.html`

      const res = await uploadWithRetry(slug, html, key)

      if (res.ok) {
        console.log(`✓ Uploaded ${slug}`)
      } else {
        const error = await res.text().catch(() => 'Unknown error')
        console.error(`✗ Failed ${slug}: ${res.status} - ${error}`)
      }
    } catch (e) {
      console.error(`✗ Skipped ${slug}: ${e.message}`)
    }

    // Fix 1 — Add delay between uploads
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  console.log('✅ Upload complete.')
} catch (e) {
  console.error(`❌ Failed to read sites directory: ${e.message}`)
  console.error(`   Expected path: ${SITES_DIR}`)
  process.exit(1)
}