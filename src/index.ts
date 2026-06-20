/**
 * `@huloglobal/vendure-plugin-email-tracking` — public exports.
 *
 * Consumers wire the plugin into Vendure via `EmailTrackingPlugin.init()`,
 * pass `new TrackingEmailSender()` to the `@vendure/email-plugin`'s
 * `emailSender` option, and (optionally) inject `EmailTrackingService`
 * into their own custom controllers to send tracked emails outside the
 * email-plugin pipeline (e.g. ad-hoc transactional sends from plugin
 * code).
 */

export { EmailTrackingPlugin } from './plugin';
export { TrackingEmailSender } from './tracking-email-sender';
export { EmailTrackingService } from './email-tracking.service';
export { EmailLog, EmailLogStatus } from './email-log.entity';
export { EmailSuppression } from './email-suppression.entity';
export { EmailTrackingPluginOptions } from './options';
export { parseEmailClient, ParsedClient } from './parse-ua';
