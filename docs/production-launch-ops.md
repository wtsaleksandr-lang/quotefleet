# QuoteFleet production launch operations checklist

Use this checklist before sending real customer traffic to a public carrier calculator. It does not replace legal, tax, insurance, cybersecurity, or compliance review.

## Launch gate

Do not run an open public launch until the following are assigned and verified:

- Owner for production monitoring and incident response.
- Owner for customer support triage.
- Owner for database backups and restore drills.
- Owner for terms, privacy, DPA, and support contact pages.
- Owner for billing, refund, and account-status decisions.
- A demo tenant and a live tenant have both been tested after the final deployment.

## Monitoring

Minimum monitoring before launch:

- Uptime check for `/`, `/w/demo`, `/app`, and `/api/health` if available.
- Error log review after each deploy.
- Alert when public quote submissions fail repeatedly.
- Alert when login/signup failures spike.
- Alert when outbound email is only logging to stdout instead of sending.
- Alert when database connection errors appear.
- Manual daily review of quote starts, quote submissions, lead submissions, callbacks, and chat activity during the first launch week.

Recommended alert destinations:

- Primary operator phone/email.
- Backup operator phone/email.
- Support inbox.

## Backups and restore

Before launch:

- Confirm automated database backups are enabled.
- Record backup schedule, retention period, and storage location.
- Run one restore drill into a non-production database.
- Confirm restored data includes tenants, users, rate cards, accessorials, zones, leads, chats, and audit logs.
- Confirm secrets are not stored inside backup documentation.

Suggested minimum policy:

- Daily backup before public launch.
- Keep at least 7 daily restore points.
- Keep at least 1 monthly restore point while customers are active.
- Review backup success weekly.

## Incident process

Severity levels:

| Level | Example | First action |
|---|---|---|
| SEV1 | App unavailable, data exposure, login broken for all users | Pause launch traffic, notify owner, open incident log |
| SEV2 | Public quote flow broken for some tenants, lead capture failing, email delivery failing | Triage, capture affected tenants, deploy fix or rollback |
| SEV3 | Styling issue, confusing copy, isolated tenant setup issue | Support ticket and normal patch |

Incident log should capture:

- Start time and detection source.
- Affected routes and tenants.
- Customer impact.
- Temporary workaround.
- Fix or rollback commit.
- Follow-up action and owner.

## Support process

Minimum support workflow:

- Publish a support email/contact method before launch.
- Define expected first response time.
- Define escalation owner for billing, security, data deletion, and broken quote flow.
- Keep demo tenant reset instructions separate from production tenant data.
- Use lead/chat/reference IDs when investigating customer issues.
- Never request customer passwords or secret API keys in support messages.

Suggested first-response targets:

- SEV1: same day / immediate operator review.
- Billing or account access: 1 business day.
- Quote setup or calculator issue: 1 business day.
- General question: 2 business days.

## Terms, privacy, and customer notices

Before public launch, confirm the public site includes or links to:

- Terms of service.
- Privacy policy.
- Data Processing Addendum or data-processing terms.
- Support/contact page.
- Security policy or security contact.
- Cookie/session notice if required by the launch jurisdiction.
- Billing/refund policy if paid subscriptions are active.

Policy pages should explain, in plain language:

- What customer quote data is collected.
- Why quote data is collected.
- Who can access tenant and lead data.
- How long leads/chats are retained.
- How customers can request deletion or correction.
- Whether marketplace exposure is opt-in.
- Whether quote estimates are non-binding until confirmed by the carrier.

## Data retention

Set a default data-retention policy before launch:

- Leads and quote requests.
- Chat messages.
- Callback requests.
- Audit logs.
- Uploaded rate sheets or imported files.
- Inactive tenants and expired trials.

Recommended default for launch notes:

- Keep operational quote/lead data only as long as needed for sales, dispatch, support, and legal/accounting needs.
- Keep audit logs long enough to investigate configuration changes.
- Allow deletion requests through support after identity/tenant verification.

## Pre-launch smoke test

Run after the final production deploy:

```text
Marketing homepage loads: yes/no
Signup creates a tenant: yes/no
Login works: yes/no
Demo widget loads: yes/no
Public quote estimate works: yes/no
Written quote request creates a lead: yes/no
Callback request creates a callback: yes/no
Customer chat opens after quote: yes/no
Dashboard lead queue shows the new lead: yes/no
Rate card editor opens: yes/no
Accessorial editor opens: yes/no
Zone editor opens: yes/no
Brand page saves: yes/no
AI setup page opens: yes/no
Printable quote workflow works: yes/no
Database backup completed after deployment: yes/no
Monitoring alert test completed: yes/no
Support contact page/inbox verified: yes/no
Terms/privacy links verified: yes/no
Known launch blockers:
```

## First week after launch

Daily checks during the first week:

- New signup count.
- Quote starts and quote submissions.
- Lead conversion rate.
- Callback and chat volume.
- Failed quote or unsupported-rate count.
- Login/signup errors.
- Email delivery failures.
- Database backup success.
- Any support tickets with repeated themes.

Move repeated support issues into `docs/product-todo.md` or a tracked issue so launch feedback becomes product work.
