Scaffold a new Worker route for this repository.

The user will provide: HTTP method, path (e.g. `POST /v1/tools/2848`), which platform owns it (VLP / TMP / TTMP / TTTMP), and whether it requires auth.

Follow every step in order:

## Step 1 — Create the contract

Create `/contracts/{domain}/{route-slug}.v1.json` with all 7 required keys:

```json
{
  "auth": {},
  "contract": {},
  "delivery": {},
  "effects": {},
  "payload": {},
  "response": {},
  "schema": {}
}
```

- `auth.required` must be `true` for any route touching PII, tokens, or account data
- `effects` must list every R2 write, D1 write, and side effect (webhook, email, etc.)
- `schema` must define every request field with type and whether required
- `response` must define the success shape and every error code

## Step 2 — Implement the Worker handler

Add the route to `workers/src/index.js` following the exact write pipeline:

```
1. Parse and validate request against contract schema (reject 400 if invalid)
2. Validate session / auth (reject 401 if missing, 403 if unauthorized)
3. Check membership tier entitlement if token-gated
4. Write receipt to R2:  receipts/{domain}/{event_id}.json
5. Write/update canonical object in R2
6. Update D1 projection
7. Return response
```

Never write to D1 before R2. Never skip the receipt write on mutations.

## Step 3 — Apply rate limiting

If the route is in any of these categories, add a rate limit check at the top of the handler before any other logic:

- Auth endpoints (magic link, 2FA, OAuth start)
- Tool execution endpoints
- Transcript submission endpoints
- Support ticket creation
- Upload endpoints

Use Cloudflare's built-in rate limiting binding or a KV-backed counter with a TTL key. Reject 429 with `Retry-After` header.

## Step 4 — Add the frontend call

If a frontend page needs to call this route, add it to `/web/lib/api/client.ts` using the existing fetch pattern. The request body must match the contract schema exactly — no extra fields.

## Step 5 — Security checklist before finishing

Confirm each item:

- [ ] Contract has all 7 keys
- [ ] Auth validated before any data access
- [ ] Ownership check: does this account own the resource?
- [ ] No PII written to KV
- [ ] Rate limiting applied if in a sensitive category
- [ ] Receipt written to R2 before canonical write
- [ ] D1 updated after R2, not before
- [ ] CORS header locked to `https://virtuallaunch.pro`
- [ ] Response does not leak internal IDs or stack traces
