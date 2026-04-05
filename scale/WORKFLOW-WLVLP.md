# WORKFLOW — Website Lotto (WLVLP)
**Owner:** JLW
**Last updated:** 2026-04-04

---

## Daily Operations

### Morning checklist
1. Check Stripe dashboard — new subscriptions, failed payments, churns
2. Check marketplace gallery — all 48 templates rendering, no broken thumbnails
3. Check active auctions — any ending today? Verify bid counts are sane
4. Review scratch ticket redemptions — unusual spikes may indicate abuse

### Template management
- Templates are immutable Canva exports in `public/sites/{slug}/index.html`
- Adding a new template: export from Canva → place in `public/sites/{new-slug}/index.html` → add to VLP Worker template registry
- Do NOT edit existing template HTML

### Deployment
- Push to `main` → Cloudflare Pages auto-deploys
- Build command: `npm run build`
- Output directory: `out`

### End of day
- Review daily revenue (Stripe)
- Check for support requests
- Note any templates with high vote counts (promotion candidates)

---

## Weekly Operations

- **Auction review:** Which auctions completed? Revenue from auction conversions?
- **Scratch ticket metrics:** Tickets issued vs redeemed vs converted to subscription
- **Template performance:** Which templates get most votes/views? Consider featuring
- **Affiliate check:** New affiliates onboarded? Commission payouts pending?
- **Content refresh:** Add new templates if pipeline has capacity

---

## Escalation Triggers

- Stripe webhook failures (payments not processing)
- Template serving errors (VLP Worker subdomain routing)
- Auth session issues (vlp_session cookie problems)
- Scratch ticket abuse (bulk creation from single IP)
- Auction bid manipulation

---

## Key Commands

```bash
npm run dev          # Local dev server
npm run build        # Production build
npm run lint         # ESLint check
```

---

## Account Credentials Reference

| Service | URL | Notes |
|---------|-----|-------|
| Stripe | dashboard.stripe.com | Subscription management |
| Cloudflare | dash.cloudflare.com | Pages deployment, DNS |
| Canva | canva.com | Template source designs |

(No passwords here — use password manager)

---

## Troubleshooting

- **Template not loading:** Check VLP Worker subdomain routing → verify slug exists in template registry
- **Auth not working:** Check `vlp_session` cookie → verify `api.virtuallaunch.pro` is responding
- **Build failing:** Run `npm run build` locally → check TypeScript errors
- **Scratch ticket not revealing:** Check `/v1/wlvlp/scratch/:ticket_id/reveal` endpoint → verify ticket status
