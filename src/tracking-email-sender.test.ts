import { describe, expect, it, vi } from 'vitest';

// TypeORM entities need emitted decorator metadata, which the test transform does not produce.
vi.mock('./email-log.entity', () => ({ EmailLog: class EmailLog {} }));
import { CapturingSender, TrackingEmailSender, statusFromSmtpResponse } from './tracking-email-sender';
import { setOptions } from './options';

describe('CapturingSender', () => {
    it('keeps nodemailer info on the EmailDetails of that send only', async () => {
        const sender = new CapturingSender();
        const transporter = { sendMail: async (m: any) => ({ messageId: `<${m.subject}@x>`, response: '250 2.0.0 OK' }) };
        const a: any = { recipient: 'a@x', subject: 'A', body: '<p>a</p>' };
        const b: any = { recipient: 'b@x', subject: 'B', body: '<p>b</p>' };
        await Promise.all([(sender as any).sendMail(a, transporter), (sender as any).sendMail(b, transporter)]);
        expect(sender.takeInfo(a)?.messageId).toBe('<A@x>');
        expect(sender.takeInfo(b)?.messageId).toBe('<B@x>');
        expect(sender.takeInfo(a)).toBeNull(); // removed on read
    });

    it('maps the SMTP reply code to a status like sendTracked', () => {
        expect(statusFromSmtpResponse('250 2.0.0 OK')).toBe('sent');
        expect(statusFromSmtpResponse('450 4.2.1 try later')).toBe('deferred');
        expect(statusFromSmtpResponse('550 5.1.1 no such user')).toBe('failed');
        expect(statusFromSmtpResponse(undefined)).toBe('sent');
    });
});

describe('TrackingEmailSender via the Vendure pipeline', () => {
    it('records Message-ID (without brackets) and the SMTP response on the row after inner.send', async () => {
        setOptions({ publicBaseUrl: 'https://shop.example.com', signingSecret: 'test-secret' });
        const saved: any[] = [];
        const updates: any[] = [];
        const repo = {
            create: (p: any) => ({ ...p }),
            save: async (row: any) => { const r = { ...row, id: 7 }; saved.push(r); return r; },
            update: async (id: number, patch: any) => { updates.push({ id, patch }); return { affected: 1 }; },
        };
        const sender = new TrackingEmailSender();
        (sender as any).connection = {
            rawConnection: { options: { type: 'mysql' }, query: async () => [], getRepository: () => repo },
        };
        const email: any = { recipient: 'c@example.com', subject: 'Welcome', body: '<html><body><a href="https://shop.example.com/x?a=1&amp;b=2">x</a></body></html>', from: 'shop@example.com' };
        // A stream transport never touches the network; nodemailer still mints a Message-ID.
        await sender.send(email, { type: 'smtp', streamTransport: true, buffer: true } as any);
        expect(saved).toHaveLength(1);
        expect(email.body).toContain('/email-track/click/7.');
        expect(email.body).toContain('/email-track/open/7.');
        expect(updates).toHaveLength(1);
        expect(updates[0].id).toBe(7);
        expect(updates[0].patch.smtpMessageId).toMatch(/^[^<>]+@[^<>]+$/);
        expect(updates[0].patch.status).toBe('sent');
    });
});
