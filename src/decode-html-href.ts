/**
 * Decode the query-string separators that HTML template engines escape inside
 * href attributes before the tracking destination is URL-encoded.
 */
export function decodeHtmlHref(value: string): string {
    return value
        .replace(/&amp;/gi, '&')
        .replace(/&#0*38;/g, '&')
        .replace(/&#x0*26;/gi, '&')
        .replace(/&#0*61;/g, '=')
        .replace(/&#x0*3d;/gi, '=')
        .replace(/&equals;/gi, '=');
}
