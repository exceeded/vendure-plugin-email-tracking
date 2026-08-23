# Changelog

All notable changes to `@huloglobal/vendure-plugin-email-tracking` are
documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project
adheres to [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.1] — 2026-08-23

### Added
- **Update notifications in the admin UI.** When a newer version is on
  npm, a dismissible banner shows current → latest with a copy-ready
  install command and a link to what's new. (Update data comes from the
  existing daily registry check — no new network calls.)

## [0.10.0] — 2026-08-21

### Added
- **In-admin licence activation.** A banner on the admin page shows the
  evaluation countdown (or free-tier state) with a paste-your-key box:
  the key is verified with the exact boot-time checks and activates
  instantly — no .env edit, no redeploy. Persisted in the shared
  hulo_licence_store table and restored on boot; env/init keys always
  take precedence. New licence/status, licence/activate and
  licence/deactivate admin endpoints.

## [0.9.0] — 2026-08-21

### Added
- **14-day full-featured evaluation.** Unlicensed installs now get the
  complete feature set for 14 days instead of the restricted free tier.
  Premium tracking features now also run during the evaluation window. The clock is anchored server-side (a hashed
  instance id — no personal data), so reinstalling does not restart it,
  and it fails open: if the licence server is unreachable the plugin
  keeps running fully. After the window the plugin drops to the free
  tier; all configuration is kept and reactivates instantly with a key.
## [0.8.2] — 2026-07-04

### Added
- Recipient-email → `customerId` lookup in `TrackingEmailSender`. If
  the subject doesn't contain an order code (password reset, OTP,
  email verification, account welcome, etc.) the sender now does a
  case-insensitive `Customer.emailAddress` lookup so the row still
  links to the right customer. Combined with 0.8.1's order-code
  extraction, this means the per-customer Emails view now surfaces
  every send the customer ever received — order-related and
  non-order-related.

## [0.8.1] — 2026-07-04

### Fixed
- `TrackingEmailSender` now populates `orderCode`, `orderId` and
  `customerId` on every EmailLog row it creates. Before this fix, only
  emails sent by our own service code (which passed those ids in
  explicitly) had them set — the Vendure email-plugin's built-in
  order-confirmation, invoice, password-reset etc. handlers do not
  hand order/customer entities through to the sender, so those rows
  saved with all three ids as `NULL`. That broke the per-order and
  per-customer Emails buttons on the admin (they filter by
  `orderCode` / `customerId`), showing an empty list even though the
  emails were sent.

  The sender now extracts the order code from the email subject via a
  `#<code>` regex (Vendure's default order-related templates render
  it there — e.g. `"Order confirmation for #S2BZ54TEK91HUUBA"`), then
  looks up the corresponding Order row to backfill `orderId` and
  `customerId`. Best-effort: unmatched subjects fall back to the
  previous behaviour (envelope-only row).

## [0.8.0] — 2026-07-04

### Added
- Boot-time compatibility check via the new SDK helper
  `warnIfIncompatibleVendure()`. Logs a non-fatal warning when the runtime
  `@vendure/core` version is outside the tested range. Silent when inside;
  fail-open on unparseable versions.

### Changed
- Peer dep on `@vendure/core` tightened to `>=3.5.0 <4.0.0` — Vendure 3.5,
  3.6 and 3.7 are all covered. Anything under 3.5 has never been tested
  by us; anything from 4.0 upwards is deferred until we've seen the
  changelog.
- Uses `@huloglobal/vendure-licence-sdk@^0.6.0`.

## [0.7.0] — 2026-06-30

### Added
- **`EmailLink` entity** — per-link metadata for tracked transactional
  emails. Each clickable link in each email gets its own random 32-byte
  token. Records the link's type, human label, visible text, position
  index, template section (`main_cta`, `footer`, etc.), destination host,
  path, and a SHA-256 hash of the full destination URL.
- **`EmailLinkService`** — issues per-link tokens, verifies HMAC
  signatures on click, looks up link metadata at redirect time. Graceful
  degradation: if the host doesn't have the migration yet, the redirect
  still works via signature verification alone; the click event just
  won't carry server-side link metadata.
- **Sensitive-link handling** — `isSensitive: true` on password-reset,
  invoice-access, or licence-delivery URLs. The raw destination never
  lands on an admin-visible event row; only the redacted form and hash.
- **Zero runtime coupling to invoice / support-ticket / order plugins.**
  All foreign-id fields are nullable ints with no FK constraints; hosts
  without those plugins simply never pass the id.
- Uses `@huloglobal/vendure-licence-sdk@^0.5.0` for the shared
  `classifyEmailEvent()` classifier.

## [0.6.0] — 2026-06-23

### Added
- Vendure Admin API GraphQL extensions. All of the operator endpoints
  are now available as first-class GraphQL queries and mutations
  alongside the existing REST admin endpoints:
  `huloEmailLogs`, `huloEmailLog`, `huloEmailStatsByTemplate` (paid),
  `huloEmailSuppressions`, `huloAddEmailSuppression`,
  `huloRemoveEmailSuppression`.
- Storefront paths (open pixel, click redirector, DSN webhook) stay
  REST — they're anonymous, high-frequency, and return non-JSON in
  some cases. GraphQL was never the right shape for those.

## [0.5.0] — 2026-06-23

### Changed
- Relicensed the GitHub source to AGPL-3.0. Published npm builds remain
  under the commercial licence documented at
  <https://huloglobal.com/legal/terms/>.
- npm builds now include Sigstore provenance attestations. Consumers can
  verify a tarball came from the official source repo with
  `npm view --json <pkg> dist.attestations`.

## [0.4.3] — 2026-06-21

### Fixed
- Dropped the conflicting `display: block` on mobile tables that broke
  the row / cell alignment. Table now scrolls horizontally inside its
  card at narrow widths.

## [0.4.2] — 2026-06-21

### Changed
- 44px minimum tap targets on every interactive element in the admin UI.
  Buttons, checkboxes, chip filters, expand toggles.

## [0.4.1] — 2026-06-21

### Changed
- Comprehensive README refresh — documents the full v0.4 feature set
  with copy-paste config including every security and retention option.

## [0.4.0] — 2026-06-20

### Added
- Signed open + click URLs — when `signingSecret` is configured, the URLs
  embed an HMAC tag and forged ids are rejected.
- Click redirector domain allowlist (`clickRedirectAllowedDomains`).
- HMAC verification on the `POST /email-track/bounce` webhook
  (`bounceWebhookSecret`).
- IP hashing on opens + clicks history (`hashIpsInHistory`, default
  true; `ipSalt` setting).
- Best-effort MaxMind geo lookup (country / region / city / timezone)
  on every recorded open and click, surfaced in the admin detail.
- Rate limiter (60 requests / 60s default) on `/open` + `/click`.
- Security headers on every response via the licence-sdk helper.
- Opt-in retention sweeper via `options.retention`.

## [0.3.3] — 2026-06-20

### Changed
- Mobile-friendly admin UI — summary cards reflow, filters stack with
  44px tap targets, tables overflow-x scroll inside the card. Update
  banner reflows on mobile.

## [0.3.2] — 2026-06-20

### Changed
- Republish targeting `@huloglobal/vendure-licence-sdk@^0.2.0`.

## [0.3.1] — 2026-06-20

### Added
- `UpdateChecker` integration via the licence-sdk — `/email-track/status`
  endpoint returns version + update info, admin UI shows a banner when
  a new version is available.

## [0.3.0] — 2026-06-20

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

## [0.2.0] — 2026-06-19

### Added
- Full per-event open history (`opensJson`) alongside the existing click
  history. Capped to the last 50 opens per email — older opens still
  contribute to `openCount`. Surfaced as `opens: []` on
  `GET /email-track/log/:id`.

## [0.1.0] — 2026-06-19

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
- Licence verification via `@huloglobal/vendure-licence-sdk` with
  revocation polling against the HULO licence server.

[0.8.2]: https://github.com/exceeded/vendure-plugin-email-tracking/releases/tag/v0.8.2
[0.8.1]: https://github.com/exceeded/vendure-plugin-email-tracking/releases/tag/v0.8.1
[0.8.0]: https://github.com/exceeded/vendure-plugin-email-tracking/releases/tag/v0.8.0
[0.7.0]: https://github.com/exceeded/vendure-plugin-email-tracking/releases/tag/v0.7.0
[0.6.0]: https://github.com/exceeded/vendure-plugin-email-tracking/releases/tag/v0.6.0
[0.5.0]: https://github.com/exceeded/vendure-plugin-email-tracking/releases/tag/v0.5.0
[0.4.3]: https://github.com/exceeded/vendure-plugin-email-tracking/releases/tag/v0.4.3
[0.4.2]: https://github.com/exceeded/vendure-plugin-email-tracking/releases/tag/v0.4.2
[0.4.1]: https://github.com/exceeded/vendure-plugin-email-tracking/releases/tag/v0.4.1
[0.4.0]: https://github.com/exceeded/vendure-plugin-email-tracking/releases/tag/v0.4.0
[0.3.3]: https://github.com/exceeded/vendure-plugin-email-tracking/releases/tag/v0.3.3
[0.3.2]: https://github.com/exceeded/vendure-plugin-email-tracking/releases/tag/v0.3.2
[0.3.1]: https://github.com/exceeded/vendure-plugin-email-tracking/releases/tag/v0.3.1
[0.3.0]: https://github.com/exceeded/vendure-plugin-email-tracking/releases/tag/v0.3.0
[0.2.0]: https://github.com/exceeded/vendure-plugin-email-tracking/releases/tag/v0.2.0
[0.1.0]: https://github.com/exceeded/vendure-plugin-email-tracking/releases/tag/v0.1.0
