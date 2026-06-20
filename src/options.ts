/**
 * Module-scoped plugin options. Populated by `EmailTrackingPlugin.init()`
 * at boot and read by the service / sender / controller via the
 * exported helpers below. Keeping options in module scope rather than
 * threading them through every constructor avoids a refactor of the
 * Nest providers — Nest creates services lazily and we want options
 * available before that happens.
 */

import { LicenceStatus } from '@huloglobal/vendure-licence-sdk';

export interface EmailTrackingPluginOptions {
    /**
     * Public base URL where the tracking endpoints are reachable. Must
     * be the externally-resolvable hostname of your Vendure server —
     * the pixel + click URLs we embed in outgoing email point to this
     * host. Example: `https://shop.example.com`.
     */
    publicBaseUrl: string;

    /**
     * Required licence JWT for production use. Without a valid key the
     * plugin still registers and writes basic delivery rows to the
     * EmailLog table, but the open/click tracking endpoints respond
     * with 410 Gone and the admin UI shows an "Unlicensed" banner.
     */
    licenceKey?: string;

    /**
     * Hostnames considered "self" — used by the click rewriter to
     * detect that a link points to our tracking endpoint and shouldn't
     * be rewritten a second time. Defaults to `[publicBaseUrl]` if
     * omitted.
     */
    trackedHosts?: string[];
}

let cachedOptions: EmailTrackingPluginOptions = {
    publicBaseUrl: 'http://localhost:3000',
    licenceKey: undefined,
    trackedHosts: undefined,
};
let cachedStatus: LicenceStatus | null = null;

export function setOptions(opts: EmailTrackingPluginOptions): void {
    cachedOptions = {
        publicBaseUrl: opts.publicBaseUrl.replace(/\/$/, ''),
        licenceKey: opts.licenceKey,
        trackedHosts: opts.trackedHosts,
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

/** Public tracking base URL — used by both the click-rewriter and the
 *  open-pixel injector. Always returns a value without a trailing slash. */
export function trackingBaseUrl(): string {
    return cachedOptions.publicBaseUrl;
}

/** Hostname prefixes the click-rewriter should treat as already-ours
 *  and skip rewriting. */
export function ownTrackingPrefixes(): string[] {
    const list = cachedOptions.trackedHosts && cachedOptions.trackedHosts.length
        ? cachedOptions.trackedHosts
        : [cachedOptions.publicBaseUrl];
    return list.map(h => h.replace(/\/$/, '') + '/email-track/');
}
