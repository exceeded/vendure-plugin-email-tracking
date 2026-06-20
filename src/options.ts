import { LicenceStatus, RetentionOptions } from '@huloglobal/vendure-licence-sdk';

export interface EmailTrackingPluginOptions {
    /** Public host of the Vendure server. Embedded in outgoing pixel +
     *  click URLs. Example: `https://shop.example.com`. */
    publicBaseUrl: string;

    /** Licence JWT. Without a valid key the plugin runs in
     *  evaluation mode (basic logging, no tracking endpoints). */
    licenceKey?: string;

    /** Hosts the click rewriter recognises as already-tracked. Defaults
     *  to `[publicBaseUrl]`. */
    trackedHosts?: string[];

    // ── Security ────────────────────────────────────────────────────────
    /**
     * HMAC secret used to:
     *   1. Sign open pixel + click URLs at embed time — prevents anyone
     *      from forging arbitrary open / click events by hitting
     *      `/email-track/open/<arbitrary-id>.gif`.
     *   2. Verify bounce-webhook requests when no `bounceWebhookSecret`
     *      is set separately.
     *
     * Strongly recommend setting this in production. When unset, the
     * plugin falls back to unsigned URLs (legacy behaviour, less safe).
     */
    signingSecret?: string;

    /**
     * Optional dedicated HMAC secret for the `/email-track/bounce`
     * webhook. Falls back to `signingSecret` if unset.
     * Requests without a valid `X-Signature` header are rejected 401.
     */
    bounceWebhookSecret?: string;

    /**
     * Domain allowlist for the click redirector. When non-empty, click
     * URLs whose hostname isn't on this list are refused. Prevents the
     * redirector from being abused as an open redirector by attackers
     * who get hold of a valid signed `/click/:id` URL.
     * Wildcard suffixes supported: `*.example.com`.
     */
    clickRedirectAllowedDomains?: string[];

    /**
     * Rate limit for the public tracking endpoints, keyed by IP. Two
     * values: `{ capacity, windowMs }`. Default 60 requests / 60s.
     */
    rateLimit?: { capacity: number; windowMs: number };

    /**
     * Per-install salt for hashing IPs stored in open / click history
     * rows. Defaults to a process-static salt — set this in production
     * so the hash is stable across deploys. */
    ipSalt?: string;

    /**
     * Store hashed IPs instead of raw IPs in open / click history. Hashed
     * IPs still let you see "same network" patterns but can't be
     * de-anonymised. Default: `true`.
     */
    hashIpsInHistory?: boolean;

    // ── Retention ───────────────────────────────────────────────────────
    /**
     * Automatic pruning of the `email_log` table. `{ days: 180 }` keeps
     * the last 180 days. `{ days: null }` (default) keeps everything.
     * Optionally set `maxRows` as a safety cap. The sweeper runs every
     * 24h and is unref'd so it never blocks shutdown.
     */
    retention?: RetentionOptions;
}

const DEFAULTS: Required<Omit<EmailTrackingPluginOptions, 'licenceKey' | 'trackedHosts' | 'signingSecret' | 'bounceWebhookSecret' | 'clickRedirectAllowedDomains' | 'retention'>> = {
    publicBaseUrl: 'http://localhost:3000',
    rateLimit: { capacity: 60, windowMs: 60_000 },
    ipSalt: 'hulo-email-tracking-default-salt',
    hashIpsInHistory: true,
};

let cachedOptions: EmailTrackingPluginOptions = { ...DEFAULTS };
let cachedStatus: LicenceStatus | null = null;

export function setOptions(opts: EmailTrackingPluginOptions): void {
    cachedOptions = {
        ...DEFAULTS,
        ...opts,
        publicBaseUrl: opts.publicBaseUrl.replace(/\/$/, ''),
    };
}

export function getOptions(): EmailTrackingPluginOptions {
    return cachedOptions;
}

export function setLicenceStatus(status: LicenceStatus): void {
    cachedStatus = status;
}

export function getLicenceStatus(): LicenceStatus | null {
    return cachedStatus;
}

export function trackingBaseUrl(): string {
    return cachedOptions.publicBaseUrl;
}

export function ownTrackingPrefixes(): string[] {
    const list = cachedOptions.trackedHosts && cachedOptions.trackedHosts.length
        ? cachedOptions.trackedHosts
        : [cachedOptions.publicBaseUrl];
    return list.map(h => h.replace(/\/$/, '') + '/email-track/');
}
