# @huloglobal/vendure-plugin-email-tracking

Track delivery, opens and clicks on every transactional email a Vendure
server sends. Wraps `@vendure/email-plugin`, persists every send + open
+ click in dedicated tables, hashes IPs, suppresses bounced recipients
automatically, exports CSV — and ships an admin UI to audit the trail
per customer / order / invoice.

Maintained by Wayne Garrison.

## Buy

14-day free trial (card required, start it from the admin — nothing charged until day 15), then **£6.95/month**, or **£139 one-off lifetime** at
[elite.charity/licence/buy/vendure-plugin-email-tracking](https://elite.charity/licence/buy/vendure-plugin-email-tracking).
Start the trial (or buy) from the plugin's admin page — checkout opens in a new tab and the key installs itself.

## Install

```bash
yarn add @huloglobal/vendure-plugin-email-tracking
```

```ts
import {
    EmailTrackingPlugin,
    TrackingEmailSender,
} from '@huloglobal/vendure-plugin-email-tracking';

export const config: VendureConfig = {
    plugins: [
        EmailTrackingPlugin.init({
            publicBaseUrl: 'https://shop.example.com',
            licenceKey: process.env.HULO_LICENCE_KEY_EMAIL_TRACKING,

            // -- Security (recommended in production) --
            signingSecret: process.env.HULO_EMAIL_SIGNING_SECRET, // unset: generated once and stored in the DB
            bounceWebhookSecret: process.env.HULO_BOUNCE_WEBHOOK_SECRET,
            clickRedirectAllowedDomains: ['shop.example.com', '*.example.com'],
            hashIpsInHistory: true,            // default true
            ipSalt: process.env.HULO_IP_SALT,  // recommended in prod
            rateLimit: { capacity: 60, windowMs: 60_000 },

            // -- Retention (opt-in) --
            retention: { days: 365, maxRows: 5_000_000 },
        }),
        EmailPlugin.init({
            // ... your existing email-plugin config ...
            emailSender: new TrackingEmailSender(),
        }),
    ],
};
```

Then add the UI extensions to your `compileUiExtensions` config:

```ts
EmailTrackingPlugin.uiExtensions
```


> **Since 0.14.2:** the bounce webhook needs `bounceWebhookSecret` (or
> `allowUnauthenticatedBounceWebhook: true` on a private network); rows are
> pruned after 365 days by default (`retention`); the visitor IP is `req.ip`
> unless you list proxy headers in `trustedIpHeaders`; unsigned click links
> only redirect to your own hosts — set `signingSecret` for full tracking.

> **Since 0.14.3:** links are always signed — without `signingSecret` a
> random per-install secret is generated at boot and kept in
> `hulo_licence_store` (key `vendure-plugin-email-tracking:signing-secret`,
> shared by server and worker). Set `signingSecret` yourself to keep links in
> already-sent emails valid across reinstalls and database restores. Emails
> sent before any secret existed keep working (pixel served, clicks to your
> own hosts only). Mail sent through the Vendure email pipeline now records
> the SMTP Message-ID and reply, so the bounce webhook can match it.

## Feature tour

### Universal capture

Every email produced by `@vendure/email-plugin` (order confirmation,
password reset, OTP, invoice, etc.) is logged automatically — no
per-handler wiring. Inject `EmailTrackingService` for ad-hoc sends from
your own plugin code and get the same engagement tracking.

### Open + click tracking with full history

- **1×1 pixel** at `/email-track/open/:token.gif` — the token is
  `<id>.<hmac>` (signed with `signingSecret`, or the generated per-install
  secret) and forged ids are rejected.
- **Click redirector** at `/email-track/click/:token?u=…` — skips
  `mailto:`, `tel:`, `#`-anchors, and `unsubscribe`/`opt-out` links.
  Optional `clickRedirectAllowedDomains` denies open-redirector abuse.
  Per-link tokens minted with `EmailLinkService.issueLinkToken()` (64-hex,
  `?u=…&s=<hmac>`) are honoured too: the row must exist and be unexpired,
  and both the signature and the stored destination hash must match `u`,
  so a token cannot be pointed at another URL. Sensitive links are recorded
  by their redacted form.
- **Bounce matching for pipeline mail**: every send through
  `TrackingEmailSender` records nodemailer's Message-ID (without angle
  brackets) and SMTP reply on the row, and sets `sent` / `deferred` /
  `failed` from the reply code.
- **Per-row history** of the last 50 opens and clicks. Each entry includes
  timestamp, IP (raw or hashed), parsed email client (Gmail web, Outlook
  desktop, Apple Mail iOS, Thunderbird, …), bot flag for prefetch
  proxies, and best-effort country / city via MaxMind GeoLite2 (when
  installed via the visitor-analytics plugin or directly).

### Suppression list

- New `EmailSuppression` entity. Hard bounces and complaints
  auto-populate; `sendTracked()` refuses suppressed recipients and
  writes `status='suppressed'` rather than calling SMTP.
- Admin CRUD at `GET/POST/DELETE /email-track/suppression`.

### Per-template analytics

- `GET /email-track/log/stats/by-template?fromDays=30` returns open
  rate, click rate and click-to-open per email type.

### Bounce webhook

- `POST /email-track/bounce` with `{ messageId, status, reason }`.
- Verifies `X-Signature` (HMAC-SHA256) against `bounceWebhookSecret` or a
  *configured* `signingSecret` (a generated one is never used here, since
  the sender could not know it). Postmaster integrations stay loose-coupled.

### Admin UI

- Global **Email Log** page with status totals, filter row, paginated
  list, expand-row detail showing both the open and click history
  tables with location + device + client per row.
- **Per-customer Emails tab** filtered to that customer.
- **Update banner** when a new plugin version is published to npm.

### CSV export

- `GET /email-track/log/export.csv?status=sent&from=2026-05-01` — same
  filters as the list endpoint, up to 50 000 rows.

### Privacy + safety

- `hashIpsInHistory: true` (default) stores SHA-256 hashed IPs.
- All admin endpoints get security headers via the licence-sdk helper.
- Rate limiter on every public endpoint (default 60/60s per IP).

### Opt-in retention

```ts
retention: { days: 180, maxRows: 1_000_000 }
```

The sweeper runs once a day on the worker only, deletes in batches of
5 000 rows (oldest id first, with a short pause between batches so the
sender is never stalled by one long DELETE), prunes `email_link` rows
past their `expiresAt` or older than `days`, is `.unref()`'d so it never
blocks shutdown, and fails soft on DB hiccups.

## HTTP endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/email-track/open/:token.gif` | public | tracking pixel |
| `GET` | `/email-track/click/:token?u=…` | public | click redirector |
| `POST` | `/email-track/bounce` | HMAC | bounce / complaint webhook |
| `GET` | `/email-track/log` | admin | paginated list with filters |
| `GET` | `/email-track/log/summary` | admin | status totals tile |
| `GET` | `/email-track/log/:id` | admin | full detail incl. opens + clicks |
| `GET` | `/email-track/log/stats/by-template` | admin | per-template aggregates |
| `GET` | `/email-track/log/export.csv` | admin | CSV export |
| `GET` | `/email-track/suppression` | admin | list suppressions |
| `POST` | `/email-track/suppression` | admin | add a suppression |
| `DELETE` | `/email-track/suppression/:recipient` | admin | lift a suppression |
| `GET` | `/email-track/status` | admin | version + licence + update status |

## Lost your licence key?

Re-send every active key on file at
[elite.charity/licence/forgot](https://elite.charity/licence/forgot).

## Documentation

User manual + screenshots:
[huloglobal.com/vendure-plugins/email-tracking/docs/](https://huloglobal.com/vendure-plugins/email-tracking/docs/)

## Licence

Commercial. Buy at
[elite.charity/licence/buy/vendure-plugin-email-tracking](https://elite.charity/licence/buy/vendure-plugin-email-tracking).
