# @hulo/vendure-plugin-email-tracking

Track delivery, opens and clicks on every transactional email a Vendure
server sends. Wraps `@vendure/email-plugin`, persists every send + open
+ click in a dedicated `email_log` table, and ships an admin UI to audit
the trail per customer / order / invoice.

Maintained by Wayne Garrison.

## What you get

- **Universal capture**. Every email produced by the standard
  `@vendure/email-plugin` (order confirmation, password reset, OTP,
  invoice, etc.) is logged automatically — no per-handler wiring.
- **Custom-send helper**. Inject `EmailTrackingService` into your own
  controllers and call `sendTracked(transporter, mailOpts, meta)` to log
  ad-hoc sends with the same engagement tracking.
- **Open tracking** via a 1×1 pixel served at
  `/email-track/open/:id.gif`. First open captures IP + user-agent.
- **Click tracking** via a redirector at `/email-track/click/:id?u=…`.
  Skips `mailto:`, `tel:`, `#`-anchors, and `unsubscribe`/`opt-out`
  links (ESP rules + privacy expectations).
- **Per-order / per-customer / per-invoice cross-references** stored on
  every row.
- **Admin UI** — global Email Log page + a per-customer Emails action
  bar item.

## Install

```bash
yarn add @hulo/vendure-plugin-email-tracking
```

## Wire up

```ts
import { EmailPlugin } from '@vendure/email-plugin';
import { EmailTrackingPlugin, TrackingEmailSender } from '@hulo/vendure-plugin-email-tracking';

export const config: VendureConfig = {
  plugins: [
    EmailTrackingPlugin.init({
      publicBaseUrl: 'https://shop.example.com',
      licenceKey: process.env.HULO_LICENCE_KEY,
    }),
    EmailPlugin.init({
      // ... your existing email-plugin config (templates, handlers, transport) ...
      emailSender: new TrackingEmailSender(),
    }),
  ],
};
```

Add to your admin-ui compile step:

```ts
import { EmailTrackingPlugin } from '@hulo/vendure-plugin-email-tracking';

compileUiExtensions({
  outputPath: 'admin-ui',
  extensions: [EmailTrackingPlugin.uiExtensions /* + your other extensions */],
});
```

## Init options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `publicBaseUrl` | `string` | yes | Externally reachable hostname (incl. scheme) of your Vendure server. The pixel + click URLs embedded in outgoing email point here. e.g. `https://shop.example.com`. |
| `licenceKey` | `string` | no\* | JWT licence key issued by HULO. Without it the plugin runs in **unlicensed mode**: rows are still written, but open/click endpoints return 410 Gone and the admin UI shows an "Unlicensed" banner. |
| `trackedHosts` | `string[]` | no | Extra hostnames considered "ours" by the click rewriter — useful if you serve `/email-track/*` from a CDN-aliased host. |

\* **Required for production use.** Buy at
`https://elite-software.co.uk/licence/buy/vendure-plugin-email-tracking`.

## Behind Cloudflare / nginx / Akamai

The plugin extracts the visitor's real IP for the open-tracking pixel
and click-redirector from the upstream proxy's headers in this order:

1. `CF-Connecting-IP` (Cloudflare)
2. `True-Client-IP` (Akamai / Cloudflare Enterprise)
3. `X-Real-IP` (nginx default)
4. First entry of `X-Forwarded-For` (RFC 7239)
5. `req.ip` (Express socket — only useful if `app.set('trust proxy')`
   has been set)

If you sit Vendure behind a proxy that doesn't set any of those — set
either `cf-connecting-ip` or `x-real-ip` on the proxy. Otherwise the
pixel will see the proxy's IP, not the visitor's, and `firstOpenIp`
will be the same value on every row.

No additional config is required on the plugin side.

## Migrations

The plugin owns the `email_log` table. Run `yarn migration:generate
AddEmailLog` (Vendure picks up the entity automatically) and apply with
`yarn migration:run`.

## Sending custom tracked emails

```ts
import { EmailTrackingService } from '@hulo/vendure-plugin-email-tracking';

@Controller('my-feature')
export class MyController {
  constructor(private tracking: EmailTrackingService) {}

  @Post('send-quote')
  async sendQuote(/* ... */) {
    await this.tracking.sendTracked(myNodemailerTransporter, {
      from: '"You" <you@example.com>',
      to: customer.email,
      subject: 'Your quote',
      html: '<h1>Your quote</h1><p>...</p>',
    }, {
      type: 'quote',
      customerId: customer.id,
      channelId: 1,
    });
  }
}
```

## Licence

Commercial — see [LICENSE](./LICENSE). Requires an active subscription
(monthly $9.95) or a perpetual licence to run in licensed mode.
