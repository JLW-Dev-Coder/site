Here’s the clean answer.

**Per-user cost is not a real fixed number** on either Vercel or Cloudflare. Both are usage-based once you get beyond included quotas, so your cost per user depends mostly on:

* dynamic requests
* compute time
* bandwidth / transfer
* storage / database operations ([Vercel][1])

## Vercel cost, in practical terms

Vercel’s billable pieces for a Next.js app are mainly:

* function invocations: $0.60 per 1M
* active CPU: starting at $0.128/hour
* data transfer: starting at $0.15/GB
  with included quotas depending on plan. Their pricing page also shows 1M invocations and 100 GB transfer on Hobby, and 10M edge requests plus 1 TB fast data transfer on Pro. ([Vercel][1])

So a **light user** example on Vercel might look like this:

* 500 dynamic requests/month = about **$0.0003**
* 1 second total CPU/month = about **$0.000036**
* 10 MB transfer/month = about **$0.00146**
  Total variable cost: about **$0.0018 per user/month**, before storage, DB, and your fixed plan costs. That is an illustration, not a guaranteed rate. ([Vercel][1])

The catch is simple: on Vercel, **bandwidth often matters more than function cost** for content-heavy sites. That matters for Website Lotto if you serve lots of site previews, screenshots, or static assets. ([Vercel][1])

## Cloudflare cost, in practical terms

Cloudflare Workers Paid starts at **$5/month minimum**. Standard Workers pricing includes:

* 10M requests/month, then **$0.30 per additional million**
* 30M CPU ms/month, then **$0.02 per additional million CPU ms**
* **no additional egress/bandwidth charges** for Workers/Pages Functions
* static asset requests on Pages are **free and unlimited** if they do not invoke Functions. ([Cloudflare Docs][2])

So a comparable **light user** example on Cloudflare might look like:

* 500 dynamic requests/month = about **$0.00015**
* 2,500 ms total CPU/month = about **$0.00005**
  Total variable cost: about **$0.0002 per user/month**, again before storage and fixed costs. ([Cloudflare Docs][2])

For **static Canva-designed websites**, Cloudflare gets more attractive because:

* Pages static asset requests are free/unlimited
* Workers pricing has no extra egress charge
* R2 also has no egress charge to the Internet. ([Cloudflare Docs][3])

## So which is cheaper per user?

For your setup, **Cloudflare is usually cheaper per user** when:

* most pages are static
* Canva sites are the default Website Lotto format
* you have lots of preview traffic
* your dynamic logic is relatively thin. ([Cloudflare Docs][3])

**Vercel is usually easier to build and manage** for a Next.js-heavy product with lots of authenticated app logic, Route Handlers, and Server Actions. That is why I still lean Vercel for the core app, even though Cloudflare often wins on raw serving economics. ([Next.js][4])

## “CF, global edge everywhere” means what?

It means Cloudflare Workers run on Cloudflare’s global network, which Cloudflare describes as thousands of machines across hundreds of locations, and their product pages say deploy once and run across **330+ cities** by default. ([Cloudflare Docs][5])

What it **does not** mean:

* your database is magically local everywhere
* your private data should be replicated to every edge node
* every request becomes low-latency if the database is far away. Cloudflare itself points out Smart Placement can run compute nearer your data when needed. ([Cloudflare Workers][6])

So the plain-English version is:

* **edge compute near users**
* **not necessarily edge data everywhere**

That distinction matters a lot for PII.

## Auth = security?

Not by itself.

Auth proves who the user is. Security is bigger:

* authorization
* session protection
* rate limiting
* input validation
* storage choices
* secret handling
* data minimization. ([Next.js][4])

Next.js specifically says Server Actions should be treated like public HTTP endpoints and must enforce authorization checks server-side. ([Next.js][4])

## Best setup to avoid exposing PII and reduce liability

This is the setup I’d use for you.

### 1. Split public content from private application data

* **Website Lotto Canva sites**: static, public, no account data, no client records, no tax data
* **VLP/TMP/TTMP/TTTMP app**: authenticated app surface only, separate routes, separate data access path

This reduces the chance you accidentally leak private data into public pages or caches. The ecosystem you uploaded already naturally separates public offerings from tool-driven products. 

### 2. Keep PII out of edge caches and KV

Cloudflare KV is eventually consistent and globally cached, which is great for config and read-heavy reference data, but that is exactly why I would **not** use KV as the primary store for sensitive PII. ([Cloudflare Workers][7])

Use KV for:

* feature flags
* public catalog metadata
* routing/config
* maybe anonymous voting counters

Do **not** use it as your main store for:

* taxpayer names
* emails tied to tax work
* transcript results
* support tickets with private details. ([Cloudflare Workers][7])

### 3. Keep sensitive data in one canonical database layer

Use one canonical server-side data layer for auth, subscriptions, entitlements, and private records. Next.js recommends choosing one clear data access approach and not mixing patterns randomly. ([Next.js][4])

For you, that means:

* one app
* one auth/session model
* one private DB layer
* one billing integration

### 4. Use server-side auth only for private actions

Use:

* HttpOnly cookies
* Secure cookies
* SameSite explicitly set
* server-side auth checks on every private mutation. OWASP documents HttpOnly and SameSite as important cookie protections. ([OWASP][8])

### 5. Treat every tool action like a secure API call

For TTMP and TTTMP:

* transcript parsing
* token debits
* support tickets
* uploads
  all need server-side authz, validation, and audit logging. Next.js explicitly says Server Actions are public endpoints and need authorization checks. ([Next.js][4])

### 6. Minimize the PII you store

Best liability reduction is boring:

* do not store full transcripts longer than needed
* do not store raw uploaded docs unless you must
* do not store unnecessary taxpayer details in Website Lotto or public-facing systems
* store IDs and derived results where possible, not raw originals

That is not just good hygiene. It reduces breach blast radius.

### 7. Stripe-hosted billing, not custom card handling

Use Stripe Checkout / Customer Portal so you are not building your own billing UI or handling card workflows directly. Stripe’s docs support this pattern, and it lowers your operational burden. ([Vercel][1])

### 8. Rate limit sensitive endpoints

Use rate limits on:

* login
* magic link
* transcript parse
* token consumption
* support ticket spam
* upload endpoints

Cloudflare has WAF rate limiting and Worker-side rate limiting options; OWASP also flags unrestricted resource consumption as a real API security issue. ([Cloudflare Workers][9])

## My recommendation for your exact case

Best balance of **low liability + low management + sane cost**:

### Core private app

* **Next.js app**
* host on **Vercel** or Cloudflare if you insist, but keep private logic centralized
* private DB for all PII
* Stripe for billing
* auth via secure server-side sessions

### Public Website Lotto / Canva delivery

* static hosting
* CDN-first
* no PII
* no auth required for browsing
* voting/bidding APIs call private backend only when needed

### Cloudflare usage

Use Cloudflare for:

* DNS
* WAF
* caching
* static asset delivery
* maybe public Website Lotto static surfaces

Do **not** spread private tax/customer records around edge caches just because edge is fast.

## Bottom line

If your top priority is **lowest serving cost**, especially for Canva-based static websites, Cloudflare wins more often. ([Cloudflare Docs][3])

If your top priority is **lowest development complexity for the private application**, Vercel is usually easier for a Next.js-heavy app. ([Vercel][1])

If your top priority is **not exposing PII**, the answer is not “pick Vercel” or “pick Cloudflare.” The answer is:

* keep PII in one private server-side data layer
* keep public Canva sites static and separate
* use secure cookies
* do server-side authorization on every private action
* do not put sensitive data in globally cached KV or public assets. ([Next.js][4])

The cleanest architecture for you is probably:
**Cloudflare for public/static delivery + WAF, Next.js private app with strict server-side data access, and zero PII on Website Lotto pages.**

I can turn this into a concrete “safe architecture” diagram for your stack next.

[1]: https://vercel.com/pricing?utm_source=chatgpt.com "Vercel Pricing: Hobby, Pro, and Enterprise plans"
[2]: https://developers.cloudflare.com/workers/platform/pricing/?utm_source=chatgpt.com "Pricing · Cloudflare Workers docs"
[3]: https://developers.cloudflare.com/pages/functions/pricing/?utm_source=chatgpt.com "Pricing · Cloudflare Pages docs"
[4]: https://nextjs.org/docs/app/guides/data-security?utm_source=chatgpt.com "Guides: Data Security | Next.js"
[5]: https://developers.cloudflare.com/workers/reference/how-workers-works/?utm_source=chatgpt.com "How Workers works · Cloudflare Workers docs"
[6]: https://workers.cloudflare.com/product/workers?utm_source=chatgpt.com "Cloudflare Workers - Global Serverless Functions Platform"
[7]: https://workers.cloudflare.com/product/kv?utm_source=chatgpt.com "Cloudflare Workers KV - Global Key-Value Database"
[8]: https://owasp.org/www-community/HttpOnly?utm_source=chatgpt.com "HttpOnly | OWASP Foundation"
[9]: https://workers.cloudflare.com/solutions/network/?utm_source=chatgpt.com "Global Network Infrastructure"

Here’s the clean answer.

Per-user cost is not a real fixed number on either Vercel or Cloudflare. Both are usage-based once you get beyond included quotas, so your cost per user depends mostly on:

dynamic requests
compute time
bandwidth / transfer
storage / database operations
Vercel cost, in practical terms

Vercel’s billable pieces for a Next.js app are mainly:

function invocations: $0.60 per 1M
active CPU: starting at $0.128/hour
data transfer: starting at $0.15/GB
with included quotas depending on plan. Their pricing page also shows 1M invocations and 100 GB transfer on Hobby, and 10M edge requests plus 1 TB fast data transfer on Pro.

So a light user example on Vercel might look like this:

500 dynamic requests/month = about $0.0003
1 second total CPU/month = about $0.000036
10 MB transfer/month = about $0.00146
Total variable cost: about $0.0018 per user/month, before storage, DB, and your fixed plan costs. That is an illustration, not a guaranteed rate.

The catch is simple: on Vercel, bandwidth often matters more than function cost for content-heavy sites. That matters for Website Lotto if you serve lots of site previews, screenshots, or static assets.

Cloudflare cost, in practical terms

Cloudflare Workers Paid starts at $5/month minimum. Standard Workers pricing includes:

10M requests/month, then $0.30 per additional million
30M CPU ms/month, then $0.02 per additional million CPU ms
no additional egress/bandwidth charges for Workers/Pages Functions
static asset requests on Pages are free and unlimited if they do not invoke Functions.

So a comparable light user example on Cloudflare might look like:

500 dynamic requests/month = about $0.00015
2,500 ms total CPU/month = about $0.00005
Total variable cost: about $0.0002 per user/month, again before storage and fixed costs.

For static Canva-designed websites, Cloudflare gets more attractive because:

Pages static asset requests are free/unlimited
Workers pricing has no extra egress charge
R2 also has no egress charge to the Internet.
So which is cheaper per user?

For your setup, Cloudflare is usually cheaper per user when:

most pages are static
Canva sites are the default Website Lotto format
you have lots of preview traffic
your dynamic logic is relatively thin.

Vercel is usually easier to build and manage for a Next.js-heavy product with lots of authenticated app logic, Route Handlers, and Server Actions. That is why I still lean Vercel for the core app, even though Cloudflare often wins on raw serving economics.

“CF, global edge everywhere” means what?

It means Cloudflare Workers run on Cloudflare’s global network, which Cloudflare describes as thousands of machines across hundreds of locations, and their product pages say deploy once and run across 330+ cities by default.

What it does not mean:

your database is magically local everywhere
your private data should be replicated to every edge node
every request becomes low-latency if the database is far away. Cloudflare itself points out Smart Placement can run compute nearer your data when needed.

So the plain-English version is:

edge compute near users
not necessarily edge data everywhere

That distinction matters a lot for PII.

Auth = security?

Not by itself.

Auth proves who the user is. Security is bigger:

authorization
session protection
rate limiting
input validation
storage choices
secret handling
data minimization.

Next.js specifically says Server Actions should be treated like public HTTP endpoints and must enforce authorization checks server-side.

Best setup to avoid exposing PII and reduce liability

This is the setup I’d use for you.

1. Split public content from private application data
Website Lotto Canva sites: static, public, no account data, no client records, no tax data
VLP/TMP/TTMP/TTTMP app: authenticated app surface only, separate routes, separate data access path

This reduces the chance you accidentally leak private data into public pages or caches. The ecosystem you uploaded already naturally separates public offerings from tool-driven products.

2. Keep PII out of edge caches and KV

Cloudflare KV is eventually consistent and globally cached, which is great for config and read-heavy reference data, but that is exactly why I would not use KV as the primary store for sensitive PII.

Use KV for:

feature flags
public catalog metadata
routing/config
maybe anonymous voting counters

Do not use it as your main store for:

taxpayer names
emails tied to tax work
transcript results
support tickets with private details.
3. Keep sensitive data in one canonical database layer

Use one canonical server-side data layer for auth, subscriptions, entitlements, and private records. Next.js recommends choosing one clear data access approach and not mixing patterns randomly.

For you, that means:

one app
one auth/session model
one private DB layer
one billing integration
4. Use server-side auth only for private actions

Use:

HttpOnly cookies
Secure cookies
SameSite explicitly set
server-side auth checks on every private mutation. OWASP documents HttpOnly and SameSite as important cookie protections.
5. Treat every tool action like a secure API call

For TTMP and TTTMP:

transcript parsing
token debits
support tickets
uploads
all need server-side authz, validation, and audit logging. Next.js explicitly says Server Actions are public endpoints and need authorization checks.
6. Minimize the PII you store

Best liability reduction is boring:

do not store full transcripts longer than needed
do not store raw uploaded docs unless you must
do not store unnecessary taxpayer details in Website Lotto or public-facing systems
store IDs and derived results where possible, not raw originals

That is not just good hygiene. It reduces breach blast radius.

7. Stripe-hosted billing, not custom card handling

Use Stripe Checkout / Customer Portal so you are not building your own billing UI or handling card workflows directly. Stripe’s docs support this pattern, and it lowers your operational burden.

8. Rate limit sensitive endpoints

Use rate limits on:

login
magic link
transcript parse
token consumption
support ticket spam
upload endpoints

Cloudflare has WAF rate limiting and Worker-side rate limiting options; OWASP also flags unrestricted resource consumption as a real API security issue.

My recommendation for your exact case

Best balance of low liability + low management + sane cost:

Core private app
Next.js app
host on Vercel or Cloudflare if you insist, but keep private logic centralized
private DB for all PII
Stripe for billing
auth via secure server-side sessions
Public Website Lotto / Canva delivery
static hosting
CDN-first
no PII
no auth required for browsing
voting/bidding APIs call private backend only when needed
Cloudflare usage

Use Cloudflare for:

DNS
WAF
caching
static asset delivery
maybe public Website Lotto static surfaces

Do not spread private tax/customer records around edge caches just because edge is fast.

Bottom line

If your top priority is lowest serving cost, especially for Canva-based static websites, Cloudflare wins more often.

If your top priority is lowest development complexity for the private application, Vercel is usually easier for a Next.js-heavy app.

If your top priority is not exposing PII, the answer is not “pick Vercel” or “pick Cloudflare.” The answer is:

keep PII in one private server-side data layer
keep public Canva sites static and separate
use secure cookies
do server-side authorization on every private action
do not put sensitive data in globally cached KV or public assets.

The cleanest architecture for you is probably:
Cloudflare for public/static delivery + WAF, Next.js private app with strict server-side data access, and zero PII on Website Lotto pages.

I can turn this into a concrete “safe architecture” diagram for your stack next.