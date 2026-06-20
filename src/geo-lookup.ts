/**
 * Best-effort MaxMind GeoLite2 lookup for IPs seen on opens / clicks.
 *
 * The dependency is intentionally soft — geolite2-redist and
 * @maxmind/geoip2-node are NOT package.json dependencies of this plugin.
 * If they're present at runtime (typically because the visitor-analytics
 * plugin is also installed), we use them; otherwise we return nulls.
 *
 * This keeps the email-tracking plugin's install size small while still
 * enriching with geo when the data is already on disk.
 */
let reader: any | null = null;
let init: Promise<void> | null = null;

export interface GeoLookup {
    country: string | null;
    region: string | null;
    city: string | null;
    timezone: string | null;
}

const EMPTY: GeoLookup = { country: null, region: null, city: null, timezone: null };

export async function lookupGeo(ip: string | null | undefined): Promise<GeoLookup> {
    if (!ip || isLocal(ip)) return EMPTY;
    const r = await getReader();
    if (!r) return EMPTY;
    try {
        const res = r.city(ip);
        return {
            country: res?.country?.isoCode?.slice(0, 8) || null,
            region: res?.subdivisions?.[0]?.isoCode?.slice(0, 8) || null,
            city: res?.city?.names?.en?.slice(0, 100) || null,
            timezone: res?.location?.timeZone?.slice(0, 64) || null,
        };
    } catch {
        return EMPTY;
    }
}

async function getReader(): Promise<any | null> {
    if (reader) return reader;
    if (init) { await init; return reader; }
    init = (async () => {
        try {
            const geolite2 = await import('geolite2-redist');
            const { Reader } = await import('@maxmind/geoip2-node');
            reader = await (geolite2 as any).open('GeoLite2-City', (p: string) => (Reader as any).open(p));
        } catch {
            reader = null;
        }
    })();
    await init;
    init = null;
    return reader;
}

function isLocal(ip: string): boolean {
    if (ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.')
        || ip.startsWith('192.168.') || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)) {
        return true;
    }
    return false;
}
