/**
 * Lightweight User-Agent → email-client classifier.
 *
 * We deliberately don't pull in the full `ua-parser-js` here — email
 * clients have a small, well-known set of UA strings, and a tight
 * 30-line classifier covers ~98% of real opens. Keeps the plugin's
 * dependency footprint zero.
 */
export interface ParsedClient {
    client: string;
    platform: string;
    isBot: boolean;
}

export function parseEmailClient(ua: string | null | undefined): ParsedClient {
    if (!ua) return { client: 'unknown', platform: 'unknown', isBot: false };
    const s = ua.toLowerCase();

    // Bots / pre-fetchers — these inflate open counts.
    if (/googleimageproxy|ggpht/.test(s)) return { client: 'Gmail (prefetch)', platform: 'web', isBot: true };
    if (/yahoomailproxy|yahoo!.*proxy/.test(s)) return { client: 'Yahoo Mail (prefetch)', platform: 'web', isBot: true };
    if (/microsoft.*officeprotectionservice|safelinks/.test(s)) return { client: 'Outlook SafeLinks', platform: 'web', isBot: true };
    if (/bot|spider|crawler|preview|curl|wget|python-requests|axios|node-fetch|libwww/.test(s)) {
        return { client: 'Bot / scanner', platform: 'unknown', isBot: true };
    }

    // Apple Mail family.
    if (/applemail/.test(s) || /^mail\//.test(s) || /\bmail\/[\d.]+\b.*(iphone|ipad)/.test(s)) {
        if (/iphone/.test(s)) return { client: 'Apple Mail', platform: 'iOS', isBot: false };
        if (/ipad/.test(s)) return { client: 'Apple Mail', platform: 'iPadOS', isBot: false };
        if (/mac os x|macintosh/.test(s)) return { client: 'Apple Mail', platform: 'macOS', isBot: false };
        return { client: 'Apple Mail', platform: 'unknown', isBot: false };
    }

    // Outlook desktop + web.
    if (/microsoft outlook/.test(s)) return { client: 'Outlook desktop', platform: detectOs(s), isBot: false };
    if (/outlook-ios/.test(s)) return { client: 'Outlook mobile', platform: 'iOS', isBot: false };
    if (/outlook-android/.test(s)) return { client: 'Outlook mobile', platform: 'Android', isBot: false };
    if (/outlook\.live\.com|outlook\.office\.com|owa/.test(s)) return { client: 'Outlook web', platform: 'web', isBot: false };

    // Gmail clients.
    if (/gmail/.test(s) && /mobile/.test(s)) return { client: 'Gmail mobile', platform: /android/.test(s) ? 'Android' : 'iOS', isBot: false };
    if (/gmail/.test(s)) return { client: 'Gmail web', platform: 'web', isBot: false };

    // Yahoo / Thunderbird / others.
    if (/thunderbird/.test(s)) return { client: 'Thunderbird', platform: detectOs(s), isBot: false };
    if (/yahoo!.*mail|yahoomail/.test(s)) return { client: 'Yahoo Mail', platform: 'web', isBot: false };

    // Fallback: it's almost certainly a browser preview.
    if (/firefox/.test(s)) return { client: 'Firefox', platform: detectOs(s), isBot: false };
    if (/chrome/.test(s)) return { client: 'Chrome', platform: detectOs(s), isBot: false };
    if (/safari/.test(s)) return { client: 'Safari', platform: detectOs(s), isBot: false };

    return { client: 'unknown', platform: detectOs(s), isBot: false };
}

function detectOs(s: string): string {
    if (/iphone/.test(s)) return 'iOS';
    if (/ipad/.test(s)) return 'iPadOS';
    if (/android/.test(s)) return 'Android';
    if (/mac os x|macintosh/.test(s)) return 'macOS';
    if (/windows/.test(s)) return 'Windows';
    if (/linux/.test(s)) return 'Linux';
    return 'unknown';
}
