Review the provided file or route for security issues specific to this codebase.

The user will provide a file path or route name to review. Read the relevant code, then check every item below. Report each finding as PASS, FAIL, or N/A with a specific line reference and fix if it fails.

---

## 1. Auth and Authorization

- [ ] Session token is validated before any data is read or written
- [ ] Account ownership is verified — the session account_id matches the resource's account_id (no IDOR)
- [ ] Membership tier / entitlement is checked for any token-gated action
- [ ] Auth check happens at the top of the handler, not after partial processing
- [ ] No route returns data belonging to a different account than the session

## 2. Write Pipeline Order

For any mutating route:

- [ ] R2 receipt is written before the canonical R2 object
- [ ] D1 is updated only after both R2 writes succeed
- [ ] A failure between steps does not leave a partial state that looks like success

## 3. PII Storage Boundaries

- [ ] No PII (names, emails, tax data, transcript content) is written to Cloudflare KV
- [ ] No PII is exposed in public route responses (Website Lotto, directory listings, public profiles)
- [ ] Transcript data and uploaded documents are scoped with a TTL or explicit delete path — not stored indefinitely
- [ ] D1 stores projections only — no raw sensitive content in indexed columns

## 4. Cookie and Session

- [ ] `vlp_session` cookie is set with `HttpOnly; Secure; SameSite=Lax`
- [ ] No session data is stored in LocalStorage, sessionStorage, or non-HttpOnly cookies
- [ ] Session is validated server-side, not just checked for presence

## 5. Rate Limiting

Check whether any of these high-risk routes are missing rate limiting:

- [ ] `POST /v1/auth/magic-link/request`
- [ ] `POST /v1/auth/2fa/challenge/verify`
- [ ] `POST /v1/tools/*`
- [ ] `POST /v1/transcripts/*`
- [ ] `POST /v1/support/tickets`
- [ ] Any upload endpoint

## 6. Input Validation

- [ ] Request body is validated against the contract schema before any logic runs
- [ ] No route uses user-supplied input as a D1 query parameter without parameterized queries
- [ ] No route uses user-supplied input to construct R2 key paths without sanitization
- [ ] File uploads validate content type and size before accepting

## 7. Response Safety

- [ ] Error responses do not include stack traces, internal IDs, or database error messages
- [ ] 404 and 403 errors are indistinguishable where enumeration is a risk (e.g. account lookup by email)
- [ ] CORS header is `https://virtuallaunch.pro` — not `*` or a dynamic reflection

## 8. Public Surface Isolation

- [ ] No account data, client records, or tax data appears in any Website Lotto or Canva static page response
- [ ] Voting/bidding mutations on public surfaces authenticate before writing, but browsing requires no auth
- [ ] Public API responses do not include fields that would expose private account state

## 9. Secrets

- [ ] No secrets, API keys, or tokens appear in source files, contracts, or environment var declarations in `wrangler.toml`
- [ ] All secrets are set via `wrangler secret put` and referenced as Worker bindings only

---

After completing the checklist, summarize:
1. All FAILs with file:line references and the specific fix required
2. Any pattern that appears in multiple places (systemic issues)
3. Items that are fine — confirm explicitly so the user knows coverage was complete
