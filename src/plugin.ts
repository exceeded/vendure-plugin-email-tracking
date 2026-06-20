import { PluginCommonModule, Type, VendurePlugin } from '@vendure/core';
import { RevocationChecker, verifyLicence } from '@huloglobal/vendure-licence-sdk';
import { EmailLog } from './email-log.entity';
import { EmailSuppression } from './email-suppression.entity';
import { EmailTrackingService } from './email-tracking.service';
import { EmailTrackingController } from './email-tracking.controller';
import { TrackingEmailSender } from './tracking-email-sender';
import { EmailTrackingPluginOptions, setLicenceStatus, setOptions } from './options';

// Public key embedded at build time. The matching private key lives on
// HULO's licence server and never leaves it. If you fork this plugin
// privately you must replace this constant with your own public key.
const HULO_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoLmNM5UljRqe71drM6lR
Ba5vXrLOcV3GAHkYvnVFQSqdE0avrge/jsD7WdA6x8qQFNRugxQcxDJa2l0+C+BH
SbU9TimGwhA1yusHHfuz9LAXks5IQ48+2e6Pulh7iThXPJUnIKqKZUN5HhL79aaK
vrZKIgSfVhwE5PMPXWZ+Ij5IRf74PLIUn1Er75qhBXlDJ4vF8y8/3owURNC1XiUB
DGElwV/LYNoqAQei4oixe4EAxPGvFi11pgHiGuRxuWckA88y6ZHLt6urfAY9sCkj
kF+2dc2yS3j7lD+SYAaV5LQYYjePP1CYvxCZ7HHRKqthHopxY1hsK2tBtni3f7/c
UwIDAQAB
-----END PUBLIC KEY-----`;

const PLUGIN_ID = 'vendure-plugin-email-tracking';
const REVOCATION_URL = process.env.HULO_LICENCE_REVOCATION_URL
    || 'https://elite.charity/licence/revoked.json';

/**
 * `@huloglobal/vendure-plugin-email-tracking`
 *
 * Logs every transactional email a Vendure server sends — Vendure-plugin
 * sends (order confirmation, OTP, password reset, invoice, etc.) plus
 * any custom sends routed through the exposed `EmailTrackingService`.
 * Each row captures recipient, subject, links to the related order /
 * customer / invoice, the SMTP response, plus per-event opens + clicks
 * via a 1×1 tracking pixel and a click redirector.
 *
 * Add to your Vendure config:
 *
 * ```ts
 * import { EmailTrackingPlugin, TrackingEmailSender } from '@huloglobal/vendure-plugin-email-tracking';
 *
 * export const config: VendureConfig = {
 *   plugins: [
 *     EmailTrackingPlugin.init({
 *       publicBaseUrl: 'https://shop.example.com',
 *       licenceKey: process.env.HULO_LICENCE_KEY,
 *     }),
 *     EmailPlugin.init({
 *       // ... your existing email-plugin config ...
 *       emailSender: new TrackingEmailSender(),
 *     }),
 *   ],
 * };
 * ```
 *
 * Add the admin UI extension by including `EmailTrackingPlugin.uiExtensions`
 * in your `compileUiExtensions` config.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [EmailTrackingService],
    controllers: [EmailTrackingController],
    entities: [EmailLog, EmailSuppression],
    compatibility: '^3.0.0',
})
export class EmailTrackingPlugin {
    private static revocation: RevocationChecker | null = null;

    static init(options: EmailTrackingPluginOptions): Type<EmailTrackingPlugin> {
        setOptions(options);

        // Start the revocation checker once; safe to call init() again
        // during hot reloads — `RevocationChecker.start()` is idempotent.
        if (!EmailTrackingPlugin.revocation) {
            EmailTrackingPlugin.revocation = new RevocationChecker(REVOCATION_URL);
            EmailTrackingPlugin.revocation.start();
        }

        const host = (options.publicBaseUrl || '')
            .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        const status = verifyLicence({
            licenceKey: options.licenceKey,
            pluginId: PLUGIN_ID,
            host,
            publicKey: HULO_PUBLIC_KEY,
            revokedIds: EmailTrackingPlugin.revocation.getRevokedIds(),
        });
        setLicenceStatus(status);

        if (!status.valid) {
            // eslint-disable-next-line no-console
            console.warn(
                `[@huloglobal/vendure-plugin-email-tracking] ${status.message}` +
                ` — Running in unlicensed mode. Purchase a key at https://elite-software.co.uk/licence/buy/${PLUGIN_ID}`,
            );
        }

        return EmailTrackingPlugin;
    }

    static uiExtensions = {
        extensionPath: __dirname + '/../ui',
        ngModules: [
            {
                type: 'lazy' as const,
                route: 'email-log',
                ngModuleFileName: 'email-log.module.ts',
                ngModuleName: 'EmailLogModule',
            },
            {
                type: 'shared' as const,
                ngModuleFileName: 'email-log-nav.module.ts',
                ngModuleName: 'EmailLogNavModule',
            },
        ],
    };
}
