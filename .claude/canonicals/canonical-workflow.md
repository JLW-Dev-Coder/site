# canonical-workflow.md

Owner's daily/weekly operational playbook. Not for Claude — for the human.

## 1. Header — Product name, owner name, last updated

## 2. Daily Operations
### Morning checklist
- What to check first (dashboard, email, analytics)
- Expected state vs alert state

### Batch generation
- Command to run
- Where output goes
- What to upload and where

### Sending
- Platform (Hunter.io, Gmail, VLP Worker cron)
- Upload steps
- Verification after send

### End of day
- What to review (open rates, clicks, replies)
- What to log

## 3. Weekly Operations
- Pipeline health check (remaining eligible prospects)
- Conversion review (emails sent → clicks → signups → payments)
- Content refresh (update asset pages based on performance)
- Prospect sourcing (scrape next batch if pipeline low)

## 4. Escalation Triggers
- Pipeline exhausted (fewer than 50 eligible)
- Bounce rate above threshold
- Spam complaints received
- Stripe payment failures

## 5. Key Commands Reference
- Batch generation command
- R2 push commands
- Deploy commands
- Analytics queries

## 6. Account Credentials Reference
- Platform names and login URLs (no passwords — those go in password manager)
- Which email account is used for sending
- Stripe dashboard URL
- Hunter.io dashboard URL
- Cal.com dashboard URL

## 7. Troubleshooting
- Email not sending → check X
- Asset page not loading → check Y
- Token grant not firing → check Z