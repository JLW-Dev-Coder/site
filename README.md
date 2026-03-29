# Virtual Launch Pro (VLP)

## Table of Contents

* [Memberships and Plans](#memberships-and-plans)

  * [Developers Virtual Launch Pro (DVLP)](#developers-virtual-launch-pro-dvlp)
  * [Games Virtual Launch Pro (GVLP)](#games-virtual-launch-pro-gvlp)
  * [Tax Claim Virtual Launch Pro (TCVLP)](#tax-claim-virtual-launch-pro-tcvlp)
  * [Tax Monitor Pro (TMP)](#tax-monitor-pro-tmp)
  * [Tax Tools Arcade (TTTMP)](#tax-tools-arcade-tttmp)
  * [Transcript Tax Monitor (TTMP)](#transcript-tax-monitor-ttmp)
  * [Virtual Launch Pro (VLP)](#virtual-launch-pro-vlp)
  * [Website Lotto Virtual Launch Pro (WLVLP)](#website-lotto-virtual-launch-pro-wlvlp)
* [Architecture and Write Pipeline](#architecture-and-write-pipeline)
* [Platform Responsibilities](#platform-responsibilities)
* [Route Surface and Storage Map](#route-surface-and-storage-map)
* [Integrations](#integrations)

  * [Auth — Google OAuth](#auth--google-oauth)
  * [Auth — Magic Link](#auth--magic-link)
  * [Auth — SSO (SAML / OIDC)](#auth--sso-saml--oidc)
  * [2FA](#2fa)
  * [Cal.com Scheduling](#calcom-scheduling)
  * [Stripe Billing](#stripe-billing)
  * [In-App Notifications](#in-app-notifications)
  * [Support Tickets](#support-tickets)
  * [Twilio SMS (Coming Soon)](#twilio-sms-coming-soon)
* [Security and Secrets](#security-and-secrets)
* [License](#license)

## Memberships and Plans

### Developers Virtual Launch Pro (DVLP)

| Feature / Capability                  | Free – Self-Service Matching | $2.99 – Job Match Intro Service |
| ------------------------------------- | ---------------------------- | ------------------------------- |
| 1-on-1 Kickoff Consultation           | —                            | ✓                               |
| Account / Membership Mgmt             | ✓                            | ✓                               |
| Calendar / Scheduling                 | ✓                            | ✓                               |
| Community Support & Resources         | ✓                            | ✓                               |
| Curated Client Introductions (3–5/mo) | —                            | ✓                               |
| Directory Profile                     | ✓                            | ✓                               |
| Direct Messaging with Clients         | ✓                            | ✓                               |
| Profile Management                    | ✓                            | ✓                               |
| Profile Optimization Review           | —                            | ✓                               |
| Profile Visibility                    | ✓                            | ✓                               |
| Project Browsing Access               | ✓                            | ✓                               |
| Support Level                         | Community                    | Priority Email + Slack          |
| Support Tickets                       | ✓                            | ✓                               |

---

### Games Virtual Launch Pro (GVLP)

| Feature / Capability      | Starter (Free) | Apprentice ($9/mo) | Strategist ($19/mo) | Firm Navigator ($39/mo) |
| ------------------------- | -------------- | ------------------ | ------------------- | ----------------------- |
| Account / Membership Mgmt | ✓              | ✓                  | ✓                   | ✓                       |
| Calendar / Scheduling     | ✓              | ✓                  | ✓                   | ✓                       |
| Directory Profile         | ✓              | ✓                  | ✓                   | ✓                       |
| Games Included            | 1 game         | 3 games            | 5 games             | All games               |
| Profile Management        | ✓              | ✓                  | ✓                   | ✓                       |
| Support Level             | Basic support  | Email support      | Priority support    | Dedicated support       |
| Support Tickets           | ✓              | ✓                  | ✓                   | ✓                       |
| Tokens / Month            | 50 tokens      | 500 tokens         | 1,500 tokens        | 750 tokens              |

---

### Tax Claim Virtual Launch Pro (TCVLP)

| Feature / Capability                 | Plan ($10/mo) |
| ------------------------------------ | ------------- |
| Account / Membership Mgmt            | ✓             |
| Auto Form 843 Generator              | ✓             |
| Calendar / Scheduling                | ✓             |
| Cancel Anytime (No Contract)         | ✓             |
| Directory Profile                    | ✓             |
| Fully Branded Page (Logo + Colors)   | ✓             |
| IRS Mailing Instructions (Per State) | ✓             |
| Mobile Responsive & Print-Ready      | ✓             |
| Profile Management                   | ✓             |
| Support Tickets                      | ✓             |
| Unlimited Client Access              | ✓             |

---

### Tax Monitor Pro (TMP)

| Feature / Capability       | Free | Essential ($9) | Plus ($19) | Premier ($39) |
| -------------------------- | ---- | -------------- | ---------- | ------------- |
| Account / Membership Mgmt  | ✓    | ✓              | ✓          | ✓             |
| Calendar / Scheduling      | ✓    | ✓              | ✓          | ✓             |
| Directory Profile          | ✓    | ✓              | ✓          | ✓             |
| Discounts / Entitlements   | ✓    | ✓              | ✓          | ✓             |
| Messaging (Pro ↔ Taxpayer) | ✓    | ✓              | ✓          | ✓             |
| Profile Management         | ✓    | ✓              | ✓          | ✓             |
| Support Tickets            | ✓    | ✓              | ✓          | ✓             |
| Tax Tool Game Tokens       | 0    | 5              | 15         | 40            |
| Taxpayer Intake            | ✓    | ✓              | ✓          | ✓             |
| Token Balances             | ✓    | ✓              | ✓          | ✓             |
| Tool Usage History         | ✓    | ✓              | ✓          | ✓             |
| Transcript Tokens          | 0    | 2              | 5          | 10            |

---

### Tax Tools Arcade (TTTMP)

| Feature / Capability      | 30-pack ($9) | 80-pack ($19) | 200-pack ($39) |
| ------------------------- | ------------ | ------------- | -------------- |
| Account / Membership Mgmt | ✓            | ✓             | ✓              |
| Calendar / Scheduling     | ✓            | ✓             | ✓              |
| Directory Profile         | ✓            | ✓             | ✓              |
| Game Analytics            | ✓            | ✓             | ✓              |
| Profile Management        | ✓            | ✓             | ✓              |
| Support Tickets           | ✓            | ✓             | ✓              |
| Token Balances            | ✓            | ✓             | ✓              |
| Tool Usage History        | ✓            | ✓             | ✓              |
| Game Tokens               | 30           | 80            | 200            |

---

### Transcript Tax Monitor (TTMP)

| Feature / Capability      | 10-pack ($19) | 25-pack ($29) | 100-pack ($129) |
| ------------------------- | ------------- | ------------- | --------------- |
| Account / Membership Mgmt | ✓             | ✓             | ✓               |
| Calendar / Scheduling     | ✓             | ✓             | ✓               |
| Directory Profile         | ✓             | ✓             | ✓               |
| Profile Management        | ✓             | ✓             | ✓               |
| Support Tickets           | ✓             | ✓             | ✓               |
| Token Balances            | ✓             | ✓             | ✓               |
| Tool Usage History        | ✓             | ✓             | ✓               |
| Transcript Parser Tool    | ✓             | ✓             | ✓               |
| Transcript Report History | ✓             | ✓             | ✓               |
| Transcript Tokens         | 10            | 25            | 100             |

---

### Virtual Launch Pro (VLP)

| Feature / Capability       | Free      | Starter ($79) | Scale ($199) | Advanced ($399) |
| -------------------------- | --------- | ------------- | ------------ | --------------- |
| Account / Membership Mgmt  | ✓         | ✓             | ✓            | ✓               |
| Booking Analytics          | ✓         | ✓             | ✓            | ✓               |
| Calendar / Scheduling      | ✓         | ✓             | ✓            | ✓               |
| Directory Profile          | ✓         | ✓             | ✓            | ✓               |
| Messaging (Pro ↔ Taxpayer) | ✓         | ✓             | ✓            | ✓               |
| Profile Management         | ✓         | ✓             | ✓            | ✓               |
| Profile Visibility         | Directory | Directory     | Featured     | Top-Tier        |
| Support Tickets            | ✓         | ✓             | ✓            | ✓               |
| Tax Tool Game Tokens       | 0         | 30            | 120          | 300             |
| Token Balances             | ✓         | ✓             | ✓            | ✓               |
| Tool Usage History         | ✓         | ✓             | ✓            | ✓               |
| Transcript Tokens          | 0         | 30            | 100          | 250             |

---

### Website Lotto Virtual Launch Pro (WLVLP)

| Feature / Capability                 | Free Plan ($0/mo) | Plan ($99/mo) |
| ------------------------------------ | ----------------- | ------------- |
| Account / Membership Mgmt            | ✓                 | ✓             |
| Bid on Websites                      | —                 | ✓             |
| Buy Now (Instant Claim)              | ✓                 | ✓             |
| Calendar / Scheduling                | ✓                 | ✓             |
| Cloudflare Security                  | —                 | ✓             |
| Easy Transfer Anytime                | —                 | ✓             |
| High-Converting Website              | —                 | ✓             |
| Mobile Optimized                     | —                 | ✓             |
| Payment Integration                  | —                 | ✓             |
| Premium Domain Hosting               | —                 | ✓             |
| Profile Management                   | ✓                 | ✓             |
| Reward Perks (Tax Tools Integration) | ✓                 | ✓             |
| Support Tickets                      | —                 | ✓             |
| Vote on Designs                      | ✓                 | ✓             |
|

---

## Architecture and Write Pipeline

The system runs on Cloudflare edge infrastructure.

Core principles: canonical storage in R2, contract-driven validation, deny-by-default routing, stateless workers.

### Write Pipeline (never deviate)

```

1\. Request received

2\. Contract validation (reject if invalid — deny-by-default)

3\. Receipt written to R2 (immutable event record)

4\. Canonical R2 object updated

5\. D1 index updated (projection only — never source of truth)

6\. Response returned

```

R2 is always authoritative. D1 is always a projection.

### Contract Structure (every contract must have all 7 keys)*

```json

{

&#x20; "auth": {},

&#x20; "contract": {},

&#x20; "delivery": {},

&#x20; "effects": {},

&#x20; "payload": {},

&#x20; "response": {},

&#x20; "schema": {}

}

```

### Contract Rules

* Contracts are repo-local — never copy a VLP contract into TMP, TTMP, or TTTMP

* Every contract must be versioned: `/contracts/account.create.v1.json`

* Frontend pages must submit exactly what the contract expects — no invented fields

* DVLP, GVLP, TCVLP, WLVLP, TMP, TTMP, and TTTMP must NOT have contracts for: billing_customers, billing_invoices, billing_payment_intents, billing_payment_methods, billing_setup_intents, billing_subscriptions, bookings, memberships, professionals, profiles, support_tickets, tokens — those are governed by VLP contracts

* Every contract must be listed in the contract registry

* See canonical contract for specific setup

* See canonical registry for specific setup

---

## Platform Responsibilities

### Ownership Rule

VLP owns all shared operational records across the ecosystem. DVLP, GVLP, TCVLP, WLVLP, TMP, TTMP, and TTTMP may READ shared records and project them into their own UX. They must NOT write to shared records directly. Shared writes go through VLP API routes.

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
/r2/accounts_dvlp/{account_dvlp_id}.json
/r2/accounts_gvlp/{account_gvlp_id}.json
/r2/accounts_tcvlp/{account_tcvlp_id}.json
/r2/accounts_wlvlp/{account_wlvlp_id}.json
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

### Developers Virtual Launch Pro (DVLP)

DVLP handles developer discovery and matching. It does NOT own shared operational records.

Responsibilities: developer onboarding, profile management, client matching, messaging, project discovery.

Canonical storage (DVLP-owned):

```
/r2/dvlp_activity/{event_id}.json
/r2/dvlp_intake_sessions/{session_id}.json
/r2/dvlp_preferences/{account_id}.json
```

---

### Games Virtual Launch Pro (GVLP)

GVLP handles game access and usage experiences. It does NOT own shared operational records.

Responsibilities: game access, token consumption, gameplay tracking, usage telemetry.

Canonical storage (GVLP-owned):

```
/r2/gvlp_activity/{event_id}.json
/r2/gvlp_intake_sessions/{session_id}.json
/r2/gvlp_preferences/{account_id}.json
```

---

### Tax Claim Virtual Launch Pro (TCVLP)

TCVLP handles tax claim intake and Form 843 workflow experiences. It does NOT own shared operational records.

Responsibilities: client intake, form generation (Form 843), branded pages, mailing workflows.

Canonical storage (TCVLP-owned):

```
/r2/tcvlp_activity/{event_id}.json
/r2/tcvlp_intake_sessions/{session_id}.json
/r2/tcvlp_preferences/{account_id}.json
```

---

### Website Lotto Virtual Launch Pro (WLVLP)

WLVLP handles marketplace and site-claim experiences. It does NOT own shared operational records.

Responsibilities: site listing, bidding, voting, purchase flow, affiliate tracking.

Canonical storage (WLVLP-owned):

```
/r2/wlvlp_activity/{event_id}.json
/r2/wlvlp_intake_sessions/{session_id}.json
/r2/wlvlp_preferences/{account_id}.json
```

---

### Ownership Rule

VLP owns all shared operational records across the ecosystem. DVLP, GVLP, TCVLP, WLVLP, TMP, TTMP, and TTTMP may READ shared records and project them into their own UX. They must NOT write to shared records directly. Shared writes go through VLP API routes.

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

account_dvlp_id   = DVLP_ACCT_{account_id}

account_gvlp_id   = GVLP_ACCT_{account_id}

account_tcvlp_id  = TCVLP_ACCT_{account_id}

account_tmp_id    = TMP_ACCT_{account_id}

account_ttmp_id   = TTMP_ACCT_{account_id}

account_tttmp_id  = TTTMP_ACCT_{account_id}

account_vlp_id    = VLP_ACCT_{account_id}

account_wlvlp_id  = WLVLP_ACCT_{account_id}

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

All Cal.com booking events route here. DVLP, GVLP, TCVLP, WLVLP, TMP, TTMP, and TTTMP do not implement a /webhooks/cal route.

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

VLP owns the canonical Cal.com webhook. All booking events route to `[https://api.virtuallaunch.pro/v1/webhooks/cal\`](https://api.virtuallaunch.pro/v1/webhooks/cal\`). DVLP, GVLP, TCVLP, WLVLP, TMP, TTMP, and TTTMP expose booking read routes only.

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

VLP is the canonical billing owner. All billing writes flow through VLP contracts and VLP API routes. DVLP, GVLP, TCVLP, WLVLP, TMP, TTMP, and TTTMP may display pricing and launch purchase UX but must proxy shared billing writes through VLP.

Canonical events: `CHECKOUT_SESSION_COMPLETED`, `CUSTOMER_SUBSCRIPTION_CREATED`, `CUSTOMER_SUBSCRIPTION_DELETED`, `CUSTOMER_SUBSCRIPTION_UPDATED`, `INVOICE_PAID`, `INVOICE_PAYMENT_FAILED`, `PAYMENT_INTENT_PAYMENT_FAILED`, `PAYMENT_INTENT_SUCCEEDED`

Stripe price metadata format:

```json

{

&#x20; "app": "tax-monitor-pro",

&#x20; "membership_type": "taxpayer",

&#x20; "plan": "free",

&#x20; "plan_slug": "free",

&#x20; "tax_tool_tokens_monthly": "0",

&#x20; "transcript_tokens_monthly": "0"

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

## Refund Policy (Global)

We may approve a refund (in full or part) in situations like:

* Duplicate charge for the same purchase
* Unrecognized charge that appears to be unauthorized (subject to verification and payment processor rules)
* Technical failure where a purchase was completed but access or service was not delivered to the account
* Service outage at purchase time that prevented access after purchase, and we cannot reasonably resolve it

Approvals are case-by-case and may require supporting details.

### Cancellation Policy

Users may cancel their subscription or plan at any time through their account dashboard within each application. Cancellation stops future billing but does not retroactively refund prior charges unless covered under the refund policy above.

### When We Don’t Refund

Refunds are not typically provided for:

* Change of mind after service, access, or deliverables are provided
* Partially used services, tools, or completed usage
* Failure to sign in to the correct account email used for purchase
* Browser extensions or device settings causing display issues (we will help troubleshoot)

---

## Security and Secrets

Secrets are managed via Wrangler secret management (`wrangler secret put`). Never commit secrets to the repository.

Managed secrets include: `CAL_APP_OAUTH_CLIENT_SECRET`, `CAL_PRO_OAUTH_CLIENT_SECRET`, `CAL_WEBHOOK_SECRET`, `ENCRYPTION_KEY`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `SESSION_SECRET`, `SSO_OIDC_CLIENT_SECRET`, `SSO_SAML_IDP_CERT`, `TWOFA_ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_VERIFY_SERVICE_SID`, `TWILIO_WEBHOOK_SECRET`, `TURNSTILE_SECRET_KEY`, `R2_CANONICAL_WRITE_TOKEN`, `OPENAI_API_KEY`, `PUSH_VAPID_PRIVATE_KEY`

---

## License

This repository is proprietary software owned and maintained by Virtual Launch Pro. Unauthorized redistribution or modification is prohibited.
