# Virtual Launch Pro (VLP)

## Table of Contents

- [Memberships and Plans](#memberships-and-plans)
- [Architecture and Write Pipeline](#architecture-and-write-pipeline)
- [Platform Responsibilities](#platform-responsibilities)
- [Route Surface and Storage Map](#route-surface-and-storage-map)
- [Integrations](#integrations)

### Live URLs

```
Frontend:         https://virtuallaunch.pro
Worker API:       https://api.virtuallaunch.pro
D1 database:      virtuallaunch-pro (id: 079dfd69-dbf4-4070-bc91-51f837021795)
R2 bucket:        virtuallaunch-pro
Pages project:    virtuallaunch-pro-web (GitHub auto-deploy on push)
CAL_APPT_DEMO:    https://cal.com/tax-monitor-pro/virtual-launch-pro-demo-intro
CAL_APPT_SUPPORT: https://cal.com/tax-monitor-pro/virtual-launch-pro-support
```

### Stack

```
Frontend:  Next.js 15 + Tailwind + @cloudflare/next-on-pages
Backend:   Cloudflare Worker (workers/src/index.js)
Database:  Cloudflare D1 (binding: DB)
Storage:   Cloudflare R2 (binding: R2_VIRTUAL_LAUNCH)
Auth:      HttpOnly cookie (vlp_session), Google OAuth, Magic Link, SSO
Billing:   Stripe (hosted + embedded checkout)
Booking:   Cal.com OAuth + webhook
Deploy:    Cloudflare Pages (frontend) + wrangler deploy (Worker)
```

### Key Files

```
/web/lib/api/client.ts         — API client (mock + real)
/web/lib/auth/session.ts       — getSession() + getSessionToken()
/workers/src/index.js          — full Worker (64 routes)
/workers/migrations/           — 15 D1 migration files
/contracts/                    — 64 canonical contracts (do not modify)
/wrangler.toml                 — Worker config, bindings, env vars
```

### Architecture Rules (never violate)

```
1. Contracts are authoritative — never modify without explicit instruction
2. Write pipeline: receipt R2 → canonical R2 → D1
3. VLP owns all shared operational records
4. Worker CORS locked to https://virtuallaunch.pro
5. Session via vlp_session HttpOnly cookie only
6. All billing writes go through VLP Worker routes
7. Frontend pages must submit exactly what the contract expects — no invented fields
```

---

## Memberships and Plans

### Virtual Launch Pro (VLP)

| Feature / Capability         | Free | Starter ($79) | Scale ($199) | Advanced ($399) |
|------------------------------|------|---------------|--------------|-----------------|
| Account / Membership Mgmt    | ✓    | ✓             | ✓            | ✓               |
| Booking Analytics            | ✓    | ✓             | ✓            | ✓               |
| Calendar / Scheduling        | ✓    | ✓             | ✓            | ✓               |
| Directory Profile            | ✓    | ✓             | ✓            | ✓               |
| Messaging (Pro ↔ Taxpayer)   | ✓    | ✓             | ✓            | ✓               |
| Profile Management           | ✓    | ✓             | ✓            | ✓               |
| Profile Visibility           | Directory | Directory | Featured  | Top-Tier        |
| Support Tickets              | ✓    | ✓             | ✓            | ✓               |
| Tax Tool Game Tokens         | 0    | 30            | 120          | 300             |
| Token Balances               | ✓    | ✓             | ✓            | ✓               |
| Tool Usage History           | ✓    | ✓             | ✓            | ✓               |
| Transcript Tokens            | 0    | 30            | 100          | 250             |

---

### Tax Monitor Pro (TMP)

| Feature / Capability         | Free | Essential ($9) | Plus ($19) | Premier ($39) |
|------------------------------|------|----------------|------------|---------------|
| Account / Membership Mgmt    | ✓    | ✓              | ✓          | ✓             |
| Calendar / Scheduling        | ✓    | ✓              | ✓          | ✓             |
| Directory Profile            | ✓    | ✓              | ✓          | ✓             |
| Discounts / Entitlements     | ✓    | ✓              | ✓          | ✓             |
| Messaging (Pro ↔ Taxpayer)   | ✓    | ✓              | ✓          | ✓             |
| Profile Management           | ✓    | ✓              | ✓          | ✓             |
| Support Tickets              | ✓    | ✓              | ✓          | ✓             |
| Tax Tool Game Tokens         | 0    | 5              | 15         | 40            |
| Taxpayer Intake              | ✓    | ✓              | ✓          | ✓             |
| Token Balances               | ✓    | ✓              | ✓          | ✓             |
| Tool Usage History           | ✓    | ✓              | ✓          | ✓             |
| Transcript Tokens            | 0    | 2              | 5          | 10            |

---

### Transcript Tax Monitor (TTMP)

| Feature / Capability         | 10-pack ($19) | 25-pack ($29) | 100-pack ($129) |
|------------------------------|---------------|---------------|-----------------|
| Account / Membership Mgmt    | ✓             | ✓             | ✓               |
| Calendar / Scheduling        | ✓             | ✓             | ✓               |
| Directory Profile            | ✓             | ✓             | ✓               |
| Profile Management           | ✓             | ✓             | ✓               |
| Support Tickets              | ✓             | ✓             | ✓               |
| Token Balances               | ✓             | ✓             | ✓               |
| Tool Usage History           | ✓             | ✓             | ✓               |
| Transcript Parser Tool       | ✓             | ✓             | ✓               |
| Transcript Report History    | ✓             | ✓             | ✓               |
| Transcript Tokens            | 10            | 25            | 100             |

---

### Tax Tools Arcade (TTTMP)

| Feature / Capability         | 30-pack ($9) | 80-pack ($19) | 200-pack ($39) |
|------------------------------|--------------|---------------|----------------|
| Account / Membership Mgmt    | ✓            | ✓             | ✓              |
| Calendar / Scheduling        | ✓            | ✓             | ✓              |
| Directory Profile            | ✓            | ✓             | ✓              |
| Game Analytics               | ✓            | ✓             | ✓              |
| Profile Management           | ✓            | ✓             | ✓              |
| Support Tickets              | ✓            | ✓             | ✓              |
| Token Balances               | ✓            | ✓             | ✓              |
| Tool Usage History           | ✓            | ✓             | ✓              |
| Game Tokens                  | 30           | 80            | 200            |

---

### Notes

- Booking Analytics = Created / Cancelled / Pending / Rescheduled / Profile Clicks / Profile Views
- Game Analytics = Wins / Loss / Score
- Top-Tier = TTMP or TTTMP Sponsored Ads

---

## Architecture and Write Pipeline

The system runs on Cloudflare edge infrastructure.

Core principles: canonical storage in R2, contract-driven validation, deny-by-default routing, stateless workers.

### Write Pipeline (never deviate)

```
1. Request received
2. Contract validation (reject if invalid — deny-by-default)
3. Receipt written to R2 (immutable event record)
4. Canonical R2 object updated
5. D1 index updated (projection only — never source of truth)
6. Response returned
```

R2 is always authoritative. D1 is always a projection.

### Contract Structure (every contract must have all 7 keys)

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

### Contract Rules

- Contracts are repo-local — never copy a VLP contract into TMP, TTMP, or TTTMP
- Every contract must be versioned: `/contracts/account.create.v1.json`
- Frontend pages must submit exactly what the contract expects — no invented fields
- TMP, TTMP, and TTTMP must NOT have contracts for: billing_customers, billing_invoices, billing_payment_intents, billing_payment_methods, billing_setup_intents, billing_subscriptions, bookings, memberships, professionals, profiles, support_tickets, tokens — those are governed by VLP contracts

---

## Platform Responsibilities

### Ownership Rule

VLP owns all shared operational records across the ecosystem. TMP, TTMP, and TTTMP may READ shared records and project them into their own UX. They must NOT write to shared records directly. Shared writes go through VLP API routes.

---

### Virtual Launch Pro (VLP)

VLP is the professional infrastructure platform and canonical owner of shared operational records.

Responsibilities: account management, billing configuration, booking infrastructure, checkout orchestration, customer portal sessions, membership management, professional dashboard, professional profiles, Stripe customer and subscription lifecycle, support tickets, token balances, token purchase orchestration, webhook-driven billing reconciliation.

Canonical storage (VLP-owned):

```
/r2/accounts_tmp/{account_tmp_id}.json
/r2/accounts_ttmp/{account_ttmp_id}.json
/r2/accounts_tttmp/{account_tttmp_id}.json
/r2/accounts_vlp/{account_vlp_id}.json
/r2/billing_customers/{account_id}.json
/r2/billing_invoices/{invoice_id}.json
/r2/billing_payment_intents/{event_id}.json
/r2/billing_payment_methods/{account_id}.json
/r2/billing_setup_intents/{event_id}.json
/r2/billing_subscriptions/{membership_id}.json
/r2/bookings/{booking_id}.json
/r2/memberships/{membership_id}.json
/r2/professionals/{professional_id}.json
/r2/profiles/{professional_id}.json
/r2/support_tickets/{ticket_id}.json
/r2/tokens/{account_id}.json
/r2/vlp_preferences/{account_id}.json
```

---

### Tax Monitor Pro (TMP)

TMP is the taxpayer discovery and membership platform. It does NOT own professional records.

Responsibilities: intake experience, tax pro directory discovery, taxpayer dashboard, inquiry capture and routing, discounts and entitlements.

Canonical storage (TMP-owned):

```
/r2/tmp_activity/{event_id}.json
/r2/tmp_entitlements/{account_id}.json
/r2/tmp_inquiries/{inquiry_id}.json
/r2/tmp_intake_sessions/{session_id}.json
/r2/tmp_preferences/{account_id}.json
```

---

### Transcript Tax Monitor (TTMP)

TTMP handles transcript diagnostics and analysis. It does NOT own professional records.

Responsibilities: transcript parser tool, diagnostic dashboard, report history, token consumption tracking.

Canonical storage (TTMP-owned):

```
/r2/ttmp_activity/{event_id}.json
/r2/ttmp_preferences/{account_id}.json
/r2/ttmp_transcript_jobs/{job_id}.json
/r2/ttmp_transcript_results/{result_id}.json
```

---

### Tax Tools Arcade (TTTMP)

TTTMP handles tax education games and tool execution. It does NOT own professional records.

Responsibilities: educational tax games, game analytics, tool execution state, usage telemetry, discovery traffic generation.

Canonical storage (TTTMP-owned):

```
/r2/tttmp_activity/{event_id}.json
/r2/tttmp_preferences/{account_id}.json
/r2/tttmp_tool_sessions/{session_id}.json
```

---

## Route Surface and Storage Map

### Canonical ID Reference

```
account_id        = ACCT_{UUID}
account_tmp_id    = TMP_ACCT_{account_id}
account_ttmp_id   = TTMP_ACCT_{account_id}
account_tttmp_id  = TTTMP_ACCT_{account_id}
account_vlp_id    = VLP_ACCT_{account_id}
booking_id        = BOOK_YYYYMMDD_{RANDOM}
event_id          = EVT_{UUID}
inquiry_id        = INQ_{UUID}
invoice_id        = INV_{UUID}
job_id            = JOB_{UUID}
membership_id     = MEM_{UUID}
message_id        = MSG_{UUID}
professional_id   = PRO_{UUID}
result_id         = RES_{UUID}
session_id        = SES_{UUID}
ticket_id         = TKT_{UUID}
```

IDs are globally unique and immutable once assigned.

---

### Auth Routes (all platforms must implement)

```
GET  /v1/auth/google/callback
GET  /v1/auth/google/start
GET  /v1/auth/magic-link/verify
GET  /v1/auth/session
GET  /v1/auth/sso/oidc/callback
GET  /v1/auth/sso/oidc/start
GET  /v1/auth/sso/saml/start
GET  /v1/auth/2fa/status/{account_id}
POST /v1/auth/logout
POST /v1/auth/magic-link/request
POST /v1/auth/sso/saml/acs
POST /v1/auth/2fa/challenge/verify
POST /v1/auth/2fa/disable
POST /v1/auth/2fa/enroll/init
POST /v1/auth/2fa/enroll/verify
```

### Account Routes (all platforms must implement)

```
DELETE /v1/accounts/{account_id}
GET    /v1/accounts/{account_id}
GET    /v1/accounts/by-email/{email}
GET    /v1/memberships/by-account/{account_id}
GET    /v1/memberships/{membership_id}
PATCH  /v1/accounts/{account_id}
PATCH  /v1/memberships/{membership_id}
POST   /v1/accounts
POST   /v1/memberships
```

### Notification Routes (all platforms must implement)

```
GET   /v1/notifications/in-app
GET   /v1/notifications/preferences/{account_id}
PATCH /v1/notifications/preferences/{account_id}
POST  /v1/notifications/in-app
POST  /v1/notifications/sms/send        (coming soon — Twilio)
POST  /v1/webhooks/twilio               (coming soon — Twilio)
```

### Support Routes (all platforms must implement)

```
GET   /v1/support/tickets/by-account/{account_id}
GET   /v1/support/tickets/{ticket_id}
PATCH /v1/support/tickets/{ticket_id}
POST  /v1/support/tickets
```

### Token Routes (all platforms must implement)

```
GET /v1/tokens/balance/{account_id}
GET /v1/tokens/usage/{account_id}
```

### Preferences Routes (all platforms must implement)

```
GET   /v1/vlp/preferences/{account_id}
PATCH /v1/vlp/preferences/{account_id}
```

### Booking Routes (all platforms must implement — VLP is canonical writer)

```
GET   /v1/bookings/by-account/{account_id}
GET   /v1/bookings/by-professional/{professional_id}
GET   /v1/bookings/{booking_id}
GET   /v1/profiles/{professional_id}
PATCH /v1/bookings/{booking_id}
PATCH /v1/profiles/{professional_id}
POST  /v1/bookings
POST  /v1/profiles
```

### Billing Routes (VLP ONLY — other platforms call VLP, do not implement locally)

```
GET    /v1/billing/config
GET    /v1/billing/payment-methods/{account_id}
GET    /v1/billing/receipts/{account_id}
GET    /v1/checkout/status
GET    /v1/pricing
PATCH  /v1/billing/subscriptions/{membership_id}
POST   /v1/billing/customers
POST   /v1/billing/payment-intents
POST   /v1/billing/payment-methods/attach
POST   /v1/billing/portal/sessions
POST   /v1/billing/setup-intents
POST   /v1/billing/subscriptions
POST   /v1/billing/subscriptions/{membership_id}/cancel
POST   /v1/billing/tokens/purchase
POST   /v1/checkout/sessions
POST   /v1/webhooks/stripe
```

### Cal.com Webhook (VLP ONLY)

```
POST /v1/webhooks/cal → https://api.virtuallaunch.pro/v1/webhooks/cal
```

All Cal.com booking events route here. TMP, TTMP, and TTTMP do not implement a /webhooks/cal route.

---

## Integrations

### Auth — Google OAuth

Canonical events: `AUTH_LOGIN_COMPLETED`, `GOOGLE_OAUTH_CALLBACK_COMPLETED`, `GOOGLE_OAUTH_STARTED`, `SESSION_CREATED`

```
GET /v1/auth/google/callback
GET /v1/auth/google/start
GET /v1/auth/session
POST /v1/auth/logout
```

---

### Auth — Magic Link

Canonical events: `AUTH_LOGIN_COMPLETED`, `MAGIC_LINK_REQUESTED`, `MAGIC_LINK_VERIFIED`, `SESSION_CREATED`

```
GET  /v1/auth/magic-link/verify
GET  /v1/auth/session
POST /v1/auth/logout
POST /v1/auth/magic-link/request
```

---

### Auth — SSO (SAML / OIDC)

Canonical events: `AUTH_LOGIN_COMPLETED`, `SESSION_CREATED`, `SSO_OIDC_CALLBACK_COMPLETED`, `SSO_OIDC_STARTED`, `SSO_SAML_ASSERTION_CONSUMED`, `SSO_SAML_STARTED`

```
GET  /v1/auth/session
GET  /v1/auth/sso/oidc/callback
GET  /v1/auth/sso/oidc/start
GET  /v1/auth/sso/saml/start
POST /v1/auth/logout
POST /v1/auth/sso/saml/acs
```

---

### 2FA

Canonical events: `TWO_FA_DISABLED`, `TWO_FA_ENROLLMENT_STARTED`, `TWO_FA_ENROLLMENT_VERIFIED`, `TWO_FA_VERIFICATION_FAILED`, `TWO_FA_VERIFICATION_SUCCEEDED`

```
GET  /v1/auth/2fa/status/{account_id}
POST /v1/auth/2fa/challenge/verify
POST /v1/auth/2fa/disable
POST /v1/auth/2fa/enroll/init
POST /v1/auth/2fa/enroll/verify
```

---

### Cal.com Scheduling

VLP owns the canonical Cal.com webhook. All booking events route to `https://api.virtuallaunch.pro/v1/webhooks/cal`. TMP, TTMP, and TTTMP expose booking read routes only.

Canonical events: `BOOKING_CANCELLED`, `BOOKING_CREATED`, `BOOKING_NO_SHOW_UPDATED`, `BOOKING_PAID`, `BOOKING_PAYMENT_INITIATED`, `BOOKING_REJECTED`, `BOOKING_REQUEST_RESCHEDULE`, `BOOKING_REQUESTED`, `BOOKING_RESCHEDULED`, `MEETING_ENDED`, `MEETING_STARTED`, `OUT_OF_OFFICE_CREATED`

```
GET   /v1/bookings/by-account/{account_id}
GET   /v1/bookings/by-professional/{professional_id}
GET   /v1/bookings/{booking_id}
GET   /v1/profiles/{professional_id}
PATCH /v1/bookings/{booking_id}
PATCH /v1/profiles/{professional_id}
POST  /v1/bookings
POST  /v1/profiles
POST  /v1/webhooks/cal   (VLP only)
```

---

### Stripe Billing

VLP is the canonical billing owner. All billing writes flow through VLP contracts and VLP API routes. Other platforms may display pricing and launch purchase UX but must proxy shared billing writes through VLP.

Canonical events: `CHECKOUT_SESSION_COMPLETED`, `CUSTOMER_SUBSCRIPTION_CREATED`, `CUSTOMER_SUBSCRIPTION_DELETED`, `CUSTOMER_SUBSCRIPTION_UPDATED`, `INVOICE_PAID`, `INVOICE_PAYMENT_FAILED`, `PAYMENT_INTENT_PAYMENT_FAILED`, `PAYMENT_INTENT_SUCCEEDED`

Stripe price metadata format:

```json
{
  "app": "tax-monitor-pro",
  "membership_type": "taxpayer",
  "plan": "free",
  "plan_slug": "free",
  "tax_tool_tokens_monthly": "0",
  "transcript_tokens_monthly": "0"
}
```

---

### In-App Notifications

Canonical events: `IN_APP_NOTIFICATION_CREATED`, `IN_APP_NOTIFICATION_DELIVERED`, `IN_APP_NOTIFICATION_DISMISSED`, `NOTIFICATION_PREFERENCES_UPDATED`

```
GET   /v1/notifications/in-app
GET   /v1/notifications/preferences/{account_id}
PATCH /v1/notifications/preferences/{account_id}
POST  /v1/notifications/in-app
```

---

### Twilio SMS (Coming Soon)

Canonical events: `NOTIFICATION_PREFERENCES_UPDATED`, `SMS_DELIVERY_FAILED`, `SMS_NOTIFICATION_QUEUED`, `SMS_NOTIFICATION_SENT`, `TWILIO_STATUS_CALLBACK_RECEIVED`

```
GET   /v1/notifications/preferences/{account_id}
PATCH /v1/notifications/preferences/{account_id}
POST  /v1/notifications/sms/send
POST  /v1/webhooks/twilio
```

---

### Support Tickets

Canonical events: `SUPPORT_TICKET_CLOSED`, `SUPPORT_TICKET_CREATED`, `SUPPORT_TICKET_MESSAGE_ADDED`, `SUPPORT_TICKET_REOPENED`, `SUPPORT_TICKET_STATUS_UPDATED`

Canonical storage: `/r2/support_tickets/{ticket_id}.json`

```
GET   /v1/support/tickets/by-account/{account_id}
GET   /v1/support/tickets/{ticket_id}
PATCH /v1/support/tickets/{ticket_id}
POST  /v1/support/tickets
```

---

## Security and Secrets

Secrets are managed via Wrangler secret management (`wrangler secret put`). Never commit secrets to the repository.

Managed secrets include: `CAL_APP_OAUTH_CLIENT_SECRET`, `CAL_PRO_OAUTH_CLIENT_SECRET`, `CAL_WEBHOOK_SECRET`, `ENCRYPTION_KEY`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `SESSION_SECRET`, `SSO_OIDC_CLIENT_SECRET`, `SSO_SAML_IDP_CERT`, `TWOFA_ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_VERIFY_SERVICE_SID`, `TWILIO_WEBHOOK_SECRET`, `TURNSTILE_SECRET_KEY`, `R2_CANONICAL_WRITE_TOKEN`, `OPENAI_API_KEY`, `PUSH_VAPID_PRIVATE_KEY`

---

## License

This repository is proprietary software owned and maintained by Virtual Launch Pro. Unauthorized redistribution or modification is prohibited.
