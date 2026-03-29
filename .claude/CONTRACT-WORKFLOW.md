# Contract Creation Workflow

This document provides step-by-step instructions for adding a new contract to the VLP ecosystem.

## Prerequisites

- Determine which platform owns this contract (vlp, tmp, ttmp, tttmp, dvlp, gvlp, tcvlp, wlvlp)
- Understand the endpoint you're creating (`/v1/{domain}/{action}`)
- Have the canonical contract template available at `/contracts/canonical-contract.json`

## Step 1: Create Contract File

**Location:** `/contracts/{platform}/{platform}.{action}.v1.json`

**Template:** Copy from `/contracts/canonical-contract.json`

**Required Sections (all 7 must be present):**
1. `auth` - Authentication requirements
2. `contract` - Metadata (title, source, path, authority, version)
3. `delivery` - HTTP endpoint details (method, endpoint, signature)
4. `effects` - Side effects (writes, dedupeKey, eventId)
5. `payload` - Request schema (JSON Schema format)
6. `response` - Response formats (success, error, deduped)
7. `schema` - Contract schema metadata (name, version)

**Naming Convention:**
- Format: `{platform}.{domain}.{action}.v{version}.json`
- Examples:
  - `tttmp.tool.form2848.v1.json`
  - `vlp.billing.subscription-create.v1.json`
  - `tmp.inquiry.submit.v1.json`

**Critical Fields:**
- `contract.path` must match actual file path
- `contract.source` must match platform name
- `delivery.endpoint` must follow `/v1/` convention
- `delivery.receiptKeyPattern` must specify R2 path
- `effects.writes` must list all R2 writes in order

## Step 2: Validate Contract Structure

Run validation checks:

```bash
# Check JSON syntax
node -e "JSON.parse(require('fs').readFileSync('contracts/{platform}/{filename}.json','utf8')); console.log('Valid JSON')"

# Verify all 7 sections present
node -e "
const c = JSON.parse(require('fs').readFileSync('contracts/{platform}/{filename}.json','utf8'));
const required = ['auth','contract','delivery','effects','payload','response','schema'];
const missing = required.filter(s => !c[s]);
if (missing.length) {
  console.log('Missing sections:', missing);
  process.exit(1);
}
console.log('All 7 sections present');
"
```

## Step 3: Add to Platform Registry

**Location:** `/contracts/registries/{platform}-registry.json`

**Add Entry:**
```json
{
  "id": "{platform}.{action}.v1",
  "path": "/contracts/{platform}/{platform}.{action}.v1.json",
  "endpoint": "/v1/{domain}/{action}",
  "method": "POST",
  "status": "active",
  "category": "tool|auth|billing|booking|notification",
  "addedDate": "2026-03-29"
}
```

**Update lastUpdated:** Update the `lastUpdated` field at the top of the registry file.

## Step 4: Add Worker Route Handler

**Location:** `/workers/src/index.js`

**Add Route:**
```javascript
// In the route matching section
if (method === 'POST' && pathname === '/v1/{domain}/{action}') {
  const validation = await validateContract(pathname, method, body, env);
  if (!validation.valid) {
    return errorResponse('INVALID_PAYLOAD', validation.error, 400);
  }

  // Handle the request
  // ...

  return jsonResponse({ success: true, data: result });
}
```

**Import Contract Loader:**
```javascript
import { validateContract, findContract } from './helpers/contract-loader.js';
```

## Step 5: Test Locally

```bash
# Start local dev server
wrangler dev

# In another terminal, test the endpoint
curl -X POST http://127.0.0.1:8787/v1/{domain}/{action} \
  -H "Content-Type: application/json" \
  -d '{"field": "value"}'

# Verify:
# - Contract validation works
# - Receipt written to R2
# - Canonical object updated
# - D1 index updated (if applicable)
# - Response matches contract.response schema
```

## Step 6: Update Phase Tracking

**Location:** `.claude/registry.json`

Update the appropriate phase milestone status:
```json
"milestones": {
  "X.Y": {
    "name": "Milestone Name",
    "status": "complete",
    "completedDate": "2026-03-29",
    "contracts": ["platform.action.v1"],
    "routes": ["/v1/domain/action"]
  }
}
```

## Step 7: Commit

```bash
git add contracts/{platform}/{platform}.{action}.v1.json
git add contracts/registries/{platform}-registry.json
git add workers/src/index.js
git add .claude/registry.json
git commit -m "Add {platform}.{action}.v1 contract

- Contract: /v1/{domain}/{action}
- Platform: {platform}
- Category: {category}
- Phase X.Y milestone complete"
```

## Step 8: Deploy

```bash
# Deploy Worker
wrangler deploy

# Verify production endpoint
curl -X POST https://api.virtuallaunch.pro/v1/{domain}/{action} \
  -H "Content-Type: application/json" \
  -d '{"field": "value"}'
```

## Common Issues

**Issue:** Contract validation fails with "Missing required field"
**Fix:** Check `payload.required` array in contract matches actual payload

**Issue:** "Contract file not found in R2"
**Fix:** Verify `contract.path` matches actual file path exactly

**Issue:** "Platform registry not found"
**Fix:** Ensure platform registry exists in `/contracts/registries/`

**Issue:** Worker returns 404 for new endpoint
**Fix:** Verify route added to `workers/src/index.js` and deployed

## Registry Update Count

After adding a contract, update the total count:

```bash
# Count all contracts across registries
node -e "
const master = JSON.parse(require('fs').readFileSync('contracts/contract-registry.json','utf8'));
let total = 0;
master.registries.forEach(r => {
  const platform = JSON.parse(require('fs').readFileSync('contracts/registries/' + r.platform + '-registry.json','utf8'));
  total += platform.contracts.length;
});
console.log('Total contracts:', total);
"
```

Update `.claude/registry.json`:
```json
"contractRegistry": {
  "totalContracts": X,
  "lastUpdated": "2026-03-29"
}
```
