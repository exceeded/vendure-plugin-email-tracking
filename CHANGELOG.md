# Changelog

All notable changes to `@hulo/vendure-plugin-email-tracking` are documented
here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and this project adheres to [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — Unreleased

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
- Licence verification via `@hulo/vendure-licence-sdk` with revocation
  polling against the HULO licence server.
