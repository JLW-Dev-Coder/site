Scaffold a new Worker route for this repository.

The user will provide: HTTP method, path (e.g. `POST /v1/tools/2848`), which platform owns it (VLP / TMP / TTMP / TTTMP / DVLP / GVLP / TCVLP / WLVLP), and whether it requires auth.

Follow every step in order. Do not skip or reorder.

---

## Step 1 — Create the contract file

File path pattern: `contracts/{domain}/{domain}.{action}.v1.json`

Follow `/contracts/canonical-contract.json` exactly. All 7 sections required:

```json
{
  "auth": {
    "required": true,
    "trustClientIdentityFields": false,
    "type": "session"
  },
  "contract": {
    "authority": ["R2_VIRTUAL_LAUNCH"],
    "governs": "...",
    "path": "/contracts/{domain}/{domain}.{action}.v1.json",
    "source": "Virtual Launch Pro",
    "title": "Virtual Launch Pro — {Title}",
    "usedOnPages": [],
    "validation": {
      "enumStrict": true,
      "rejectUnknownValues": true,
      "requireJsonContentType": true
    },
    "version": 1
  },
  "delivery": {
    "endpoint": "/v1/...",
    "method": "POST",
    "receiptKeyPattern": "receipts/{domain}/{action}/{id}.json",
    "receiptSource": "{domain}_{action}",
    "signature": {
      "header": null,
      "required": false,
      "secretEnvVar": null
    }
  },
  "effects": {
    "canonicalUpsert": {
      "target": "{collection}/{id}.json"
    },
    "dedupeKey": "payload.{idField}",
    "eventIdFrom": "payload.{idField}",
    "receiptAppend": {
      "to": "receipts/{domain}/{action}/{id}.json"
    },
    "writeOrder": ["receiptAppend", "canonicalUpsert"],
    "writes": ["{collection}"]
  },
  "payload": {
    "additionalProperties": false,
    "properties": {},
    "required": [],
    "type": "object"
  },
  "response": {
    "deduped": { "deduped": true, "eventId": "{effects.eventIdFrom}", "ok": true },
    "error": { "error": "validation_failed", "ok": false },
    "success": { "ok": true, "status": "..." }
  },
  "schema": {
    "name": "{domain}_{action}",
    "version": 1
  }
}
```

Notes:
- `contract.path` must be the exact repo path of the file being created
- `delivery.signature.required` is `true` only for webhook routes; set `secretEnvVar` to the env var name
- `effects.writeOrder` must always list `receiptAppend` before `canonicalUpsert`
- For read-only routes (GET), `effects.writes` is `[]` and `writeOrder` is `[]`

## Step 2 — Add entry to contract-registry.json

Open `contracts/contract-registry.json` and add one entry to the `registry` array. Required fields per `canonical-registry.json`:

```json
{
  "authRequired": true,
  "category": "form",
  "dedupeKey": "payload.{idField}",
  "endpoint": "https://api.virtuallaunch.pro/v1/...",
  "id": "{domain}_{action}",
  "method": "POST",
  "path": "/contracts/{domain}/{domain}.{action}.v1.json",
  "receiptKeyPattern": "receipts/{domain}/{action}/{id}.json",
  "receiptSource": "{domain}_{action}",
  "signatureRequired": false,
  "status": "active",
  "usedOnPages": [],
  "version": 1,
  "writes": ["{collection}"]
}
```

`category` values: `"form"` (mutating), `"read-model"` (GET), `"webhook"` (inbound webhook).
`endpoint` must be the absolute URL: `https://api.virtuallaunch.pro/v1/...`
`id` must be lowercase snake_case.
`status` must be `"active"` for production routes, `"draft"` while in development.

## Step 3 — Implement the Worker handler

Add the route to `workers/src/index.js` following the exact write pipeline:

```
1. Parse and validate request body against contract schema → 400 if invalid
2. Validate session (vlp_session cookie) → 401 if missing
3. Verify account ownership of the resource → 403 if mismatch (no IDOR)
4. Check membership tier entitlement if token-gated → 403 if insufficient
5. Write receipt to R2: receipts/{domain}/{action}/{id}.json
6. Write/update canonical object in R2
7. Update D1 projection
8. Return response
```

Never write to D1 before both R2 writes succeed. Never skip the receipt write on mutations.

## Step 4 — Apply rate limiting

If the route is in any of these categories, add a rate limit check at the very top of the handler (before auth):

- Auth endpoints: magic-link, 2FA verify, OAuth start
- Tool execution: `/v1/tools/*`
- Transcript submission: `/v1/transcripts/*`
- Support ticket creation
- Upload endpoints

Reject with 429 and `Retry-After` header.

## Step 5 — Wire the frontend call

If a frontend page calls this route, add the fetch to `/web/lib/api/client.ts` using the existing pattern. The request body must match `contract.payload` exactly — no extra fields.

## Step 6 — Security checklist

Confirm each item before marking done:

- [ ] Contract has all 7 sections with all required fields
- [ ] `contract.path` matches the actual file path
- [ ] Registry entry added to `contract-registry.json` with all required fields
- [ ] Auth validated before any data access
- [ ] Ownership check: session account_id matches resource account_id
- [ ] Rate limiting applied if in a sensitive category
- [ ] Receipt written to R2 before canonical write
- [ ] D1 updated only after R2 writes succeed
- [ ] No PII written to KV
- [ ] Response does not expose stack traces or internal IDs
- [ ] CORS header locked to `https://virtuallaunch.pro`
