import { describe, expect, it } from 'vitest';
import { parseEmailClient } from './parse-ua';

describe('parseEmailClient', () => {
    it('flags prefetch / proxy bots that inflate open counts', () => {
        expect(parseEmailClient('Mozilla/5.0 (via ggpht.com GoogleImageProxy)')).toMatchObject({ client: 'Gmail (prefetch)', isBot: true });
        expect(parseEmailClient('Mozilla/5.0 (Windows NT; Microsoft-OfficeProtectionService)')).toMatchObject({ isBot: true });
        expect(parseEmailClient('curl/8.4.0')).toMatchObject({ client: 'Bot / scanner', isBot: true });
        expect(parseEmailClient('python-requests/2.31')).toMatchObject({ isBot: true });
    });

    it('classifies Apple Mail by platform', () => {
        expect(parseEmailClient('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit AppleMail')).toMatchObject({ client: 'Apple Mail', platform: 'iOS', isBot: false });
        expect(parseEmailClient('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleMail')).toMatchObject({ client: 'Apple Mail', platform: 'macOS' });
    });

    it('classifies the Outlook family', () => {
        expect(parseEmailClient('Microsoft Outlook 16.0')).toMatchObject({ client: 'Outlook desktop', isBot: false });
        expect(parseEmailClient('Outlook-iOS/2.0')).toMatchObject({ client: 'Outlook mobile', platform: 'iOS' });
        expect(parseEmailClient('Mozilla/5.0 outlook.office.com')).toMatchObject({ client: 'Outlook web' });
    });

    it('classifies Gmail web vs mobile', () => {
        expect(parseEmailClient('Mozilla/5.0 Gmail')).toMatchObject({ client: 'Gmail web', platform: 'web' });
        expect(parseEmailClient('Mozilla/5.0 (Android) Gmail Mobile')).toMatchObject({ client: 'Gmail mobile', platform: 'Android' });
    });

    it('falls back to browser + OS detection', () => {
        expect(parseEmailClient('Mozilla/5.0 (Windows NT 10.0) Firefox/121.0')).toMatchObject({ client: 'Firefox', platform: 'Windows', isBot: false });
        expect(parseEmailClient('Mozilla/5.0 (Linux) Chrome/120.0')).toMatchObject({ client: 'Chrome', platform: 'Linux' });
    });

    it('handles null / empty as unknown, not bot', () => {
        expect(parseEmailClient(null)).toEqual({ client: 'unknown', platform: 'unknown', isBot: false });
        expect(parseEmailClient('')).toEqual({ client: 'unknown', platform: 'unknown', isBot: false });
    });
});
