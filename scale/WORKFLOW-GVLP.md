# WORKFLOW — games.virtuallaunch.pro (GVLP)

Owner: James
Last updated: 2026-04-04

---

## 1. Daily Operations

### Morning Checklist
- Check Stripe dashboard for new subscriptions or payment failures
- Review Cloudflare Pages deployment status (auto-deploys from `main`)
- Spot-check one game embed to confirm token flow works end-to-end

### Development Cycle
- Local dev: `npm run dev` (Next.js dev server)
- Build verification: `npm run build` before every push
- Deploy: Push to `main` → Cloudflare Pages auto-deploys

### End of Day
- Review any new operator signups in VLP dashboard
- Check error logs in Cloudflare dashboard

## 2. Weekly Operations

- **Pipeline health**: Check operator signup funnel (onboarding starts → tier selections → active embeds)
- **Game performance**: Which games get the most plays? Token usage distribution across tiers
- **Content refresh**: Update game content or add new questions if engagement drops
- **Cross-sell check**: Review SCALE outreach for GVLP-specific campaigns

## 3. Escalation Triggers

- Stripe webhook failures (tokens not granted after payment)
- API errors from `api.virtuallaunch.pro` affecting game play
- Cloudflare Pages build failures on deploy
- Operator reports embed not loading

## 4. Key Commands Reference

```bash
# Local development
npm run dev

# Production build
npm run build

# Lint
npm run lint
```

## 5. Account Credentials Reference

| Platform | URL | Purpose |
|---|---|---|
| Cloudflare | dash.cloudflare.com | Pages deployment, DNS |
| Stripe | dashboard.stripe.com | Subscriptions, webhooks |
| VLP API | api.virtuallaunch.pro | Backend (separate repo) |

## 6. Troubleshooting

- **Game not loading in embed** → Check iframe src URL, verify `client_id` parameter
- **Tokens not deducting** → Check VLP Worker `/v1/gvlp/tokens/use` endpoint, verify `credentials: 'include'` in fetch
- **Auth redirect loop** → Check `api.virtuallaunch.pro/v1/auth/session`, verify cookies set correctly
- **Build failure** → Run `npm run build` locally, check TypeScript errors
