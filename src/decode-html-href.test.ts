import { describe, expect, it } from 'vitest';
import { decodeHtmlHref } from './decode-html-href';

describe('decodeHtmlHref', () => {
    it.each([
        ['https://example.com/?a=1&amp;b=2', 'https://example.com/?a=1&b=2'],
        ['https://example.com/?token&#x3D;abc', 'https://example.com/?token=abc'],
        ['https://example.com/?token&#61;abc', 'https://example.com/?token=abc'],
        ['https://example.com/?token&equals;abc', 'https://example.com/?token=abc'],
    ])('decodes %s', (encoded, decoded) => {
        expect(decodeHtmlHref(encoded)).toBe(decoded);
    });
});
