# Changelog

All notable changes to `@huloglobal/vendure-plugin-email-tracking` are documented
here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and this project adheres to [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1]

### Changed
- Comprehensive README refresh — documents the full v0.4 feature set
  with copy-paste config including every security + retention option.

## [0.4.0]

### Added
- Signed open + click URLs — when `signingSecret` is configured, the
  URLs embed an HMAC tag and forged ids are rejected.
- Click redirector domain allowlist (`clickRedirectAllowedDomains`).
- HMAC verification on the `POST /email-track/bounce` webhook
  (`bounceWebhookSecret`).
- IP hashing on opens + clicks history (`hashIpsInHistory`, default
  true; `ipSalt` setting).
- Best-effort MaxMind geo lookup (country / region / city / timezone)
  on every recorded open and click, surfaced in the admin detail.
- Rate limiter (60/60s default) on `/open` + `/click`.
- Security headers on every response via the licence-sdk helper.
- Opt-in retention sweeper via `options.retention`.

## [0.3.3]

### Changed
- Mobile-friendly admin UI — summary cards reflow, filters stack with
  44px tap targets, tables overflow-x scroll inside the card. Update
  banner reflows on mobile.

## [0.3.2]

### Changed
- Republish targeting `@huloglobal/vendure-licence-sdk@^0.2.0`.

## [0.3.1]

### Added
- `UpdateChecker` integration via the licence-sdk — `/email-track/status`
  endpoint returns version + update info, admin UI shows a banner when
  a new version is available.

## [0.3.0]

### Added
- **Suppression list** — new `EmailSuppression` entity. Hard bounces
  and complaints auto-add to the table; `sendTracked()` refuses
  recipients on the list and writes `status='suppressed'`. CRUD
  endpoints (`GET /email-track/suppression`,
  `POST /email-track/suppression`,
  `DELETE /email-track/suppression/:recipient`).
- **Per-template analytics** — `GET /email-track/log/stats/by-template`
  returns open rate, click rate and click-to-open per email type.
- **Device + client detection** — every open is classified (Gmail web,
  Outlook desktop, Apple Mail iOS, Thunderbird, Yahoo, prefetch proxies,
  bots / scanners). Stored on each open history entry.
- **CSV export** — `GET /email-track/log/export.csv` mirrors the list
  endpoint's filters (max 50 000 rows).

### Changed
- Admin UI Email Log detail view now renders the full open and click
  history tables (was just clicks before).

## [0.2.0]

### Added
- Full per-event open history (`opensJson`) alongside the existing click
  history. Capped to the last 50 opens per email — older opens still
  contribute to `openCount`. Surfaced as `opens: []` on
  `GET /email-track/log/:id`.

## [0.1.0]

### Added
- `EmailTrackingPlugin` — wraps `@vendure/email-plugin` and persists every
  send to the `email_log` table.
- `TrackingEmailSender` — drop-in `EmailSender` replacement that wraps
  the default Nodemailer sender and injects an open-tracking pixel and a
  click redirector into the outgoing HTML.
- `EmailTrackingService` — exposed for custom controllers that send
  transactional email outside the email-plugin pipeline.
- Public endpoints `/email-track/open/:id.gif` (1×1 pixel),
  `/email-track/click/:id?u=<encoded>` (302 redirect), and
  `/email-track/bounce` (webhook hook for DSN parsers).
- Admin endpoints `/email-track/log` (paginated list with filters),
  `/email-track/log/summary` and `/email-track/log/:id`.
- Admin UI: standalone Email Log page + a per-customer Emails view.
- Licence verification via `@huloglobal/vendure-licence-sdk` with revocation
  polling against the HULO licence server.
