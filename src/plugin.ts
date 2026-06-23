import { PluginCommonModule, Type, VendurePlugin } from '@vendure/core';
import { fingerprintPublicKey, Heartbeat, RevocationChecker, UpdateChecker, verifyLicence } from '@huloglobal/vendure-licence-sdk';
import { EmailLog } from './email-log.entity';
import { EmailSuppression } from './email-suppression.entity';
import { EmailTrackingService } from './email-tracking.service';
import { EmailTrackingController } from './email-tracking.controller';
import { TrackingEmailSender } from './tracking-email-sender';
import { EmailTrackingPluginOptions, setLicenceStatus, setOptions } from './options';
import { EmailTrackingAdminResolver, emailTrackingAdminApiSchema } from './admin-api';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PKG_VERSION: string = require('../package.json').version;
const PKG_NAME = '@huloglobal/vendure-plugin-email-tracking';

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
    providers: [EmailTrackingService, EmailTrackingAdminResolver],
    controllers: [EmailTrackingController],
    entities: [EmailLog, EmailSuppression],
    compatibility: '^3.0.0',
    adminApiExtensions: {
        schema: emailTrackingAdminApiSchema,
        resolvers: [EmailTrackingAdminResolver],
    },
})
export class EmailTrackingPlugin {
    private static revocation: RevocationChecker | null = null;
    private static updateChecker: UpdateChecker | null = null;
    private static heartbeat: Heartbeat | null = null;

    /** Per-process snapshot of the latest update status — read by the
     * controller's `/status` endpoint and the admin UI banner. */
    static getUpdateChecker(): UpdateChecker | null { return EmailTrackingPlugin.updateChecker; }
    static getPackageVersion(): string { return PKG_VERSION; }
    static getPackageName(): string { return PKG_NAME; }

    static init(options: EmailTrackingPluginOptions): Type<EmailTrackingPlugin> {
        setOptions(options);

        // Start the revocation checker once; safe to call init() again
        // during hot reloads — `RevocationChecker.start()` is idempotent.
        if (!EmailTrackingPlugin.revocation) {
            EmailTrackingPlugin.revocation = new RevocationChecker(REVOCATION_URL);
            EmailTrackingPlugin.revocation.start();
        }
        if (!EmailTrackingPlugin.updateChecker) {
            EmailTrackingPlugin.updateChecker = new UpdateChecker(PKG_NAME, PKG_VERSION);
            EmailTrackingPlugin.updateChecker.start();
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
                ` — Running in FREE tier: opens + clicks NOT recorded, suppression list NOT enforced at send, per-template stats + CSV export disabled. Buy a licence at https://elite.charity/licence/buy/${PLUGIN_ID}`,
            );
        }

        if (!EmailTrackingPlugin.heartbeat) {
            EmailTrackingPlugin.heartbeat = new Heartbeat({
                packageName: PKG_NAME,
                packageVersion: PKG_VERSION,
                licenceKey: options.licenceKey,
                publicKeyFingerprint: fingerprintPublicKey(HULO_PUBLIC_KEY),
            });
            EmailTrackingPlugin.heartbeat.start();
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
