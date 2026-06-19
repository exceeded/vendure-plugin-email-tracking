import { Injector, Logger, TransactionalConnection } from '@vendure/core';
import { EmailSender } from '@vendure/email-plugin/lib/src/sender/email-sender';
import { EmailDetails, EmailTransportOptions } from '@vendure/email-plugin/lib/src/types';
import { NodemailerEmailSender } from '@vendure/email-plugin/lib/src/sender/nodemailer-email-sender';
import { EmailLog, EmailLogStatus } from './email-log.entity';
import { ownTrackingPrefixes, trackingBaseUrl } from './options';

const loggerCtx = 'TrackingEmailSender';

/**
 * Wraps the default NodemailerEmailSender so every send by the Vendure
 * email-plugin (order confirmation, password reset, OTP, invoice, etc.)
 * also creates an EmailLog row and gets the open-pixel + click-tracking
 * rewrites applied to its html body.
 *
 * The actual SMTP transport handling stays in the default sender — we just
 * mutate the body in-place before delegating, and persist the row.
 */
export class TrackingEmailSender implements EmailSender {
    private inner = new NodemailerEmailSender();
    private connection!: TransactionalConnection;

    init(injector: Injector) {
        try {
            this.connection = injector.get(TransactionalConnection);
            Logger.info('TrackingEmailSender init() OK — tracking enabled', loggerCtx);
        } catch (e: any) {
            Logger.error(`TrackingEmailSender init() FAILED: ${e?.message}`, loggerCtx);
        }
    }

    async send(email: EmailDetails, options: EmailTransportOptions): Promise<void> {
        const trackable = options.type === 'smtp' || options.type === 'ses' || options.type === 'sendmail';
        if (!trackable) {
            return this.inner.send(email, options);
        }
        if (!this.connection) {
            Logger.warn(`TrackingEmailSender.send() called but connection is null — skipping tracking for "${email.subject}"`, loggerCtx);
            return this.inner.send(email, options);
        }

        const repo = this.connection.rawConnection.getRepository(EmailLog);
        const row = repo.create({
            type: this.inferType(email.subject),
            recipient: (email.recipient || '').slice(0, 500),
            subject: (email.subject || '').slice(0, 1000),
            fromAddress: (email.from || '').slice(0, 500),
            bcc: email.bcc?.slice(0, 500),
            replyTo: email.replyTo?.slice(0, 500),
            channelId: 1,
            status: 'sent' as EmailLogStatus,
            tracked: true,
        });
        const saved = await repo.save(row);

        // Rewrite + pixel-inject the html body in place.
        try {
            email.body = this.wrapHtml(email.body || '', Number(saved.id));
        } catch (e: any) {
            Logger.warn(`tracking wrap failed: ${e?.message}`, loggerCtx);
        }

        try {
            await this.inner.send(email, options);
        } catch (e: any) {
            saved.status = 'failed';
            saved.errorMessage = String(e?.message || e).slice(0, 2000);
            await repo.save(saved);
            throw e;
        }
        Logger.info(`Tracked plugin-email [${saved.type}] to ${saved.recipient} (id=${saved.id})`, loggerCtx);
    }

    /** Best-effort categorisation of plugin-email sends. */
    private inferType(subject: string): string {
        const s = (subject || '').toLowerCase();
        if (s.includes('order confirmation') || s.includes('order receipt')) return 'order-confirmation';
        if (s.includes('verify')) return 'email-verification';
        if (s.includes('password')) return 'password-reset';
        if (s.includes('otp') || s.includes('one-time') || s.includes('login code')) return 'otp-code';
        if (s.includes('invoice')) return 'invoice';
        if (s.includes('review')) return 'review-reminder';
        if (s.includes('payment')) return 'payment-due';
        if (s.includes('abandoned')) return 'abandoned-cart';
        if (s.includes('email address')) return 'email-address-change';
        return 'plugin-email';
    }

    private wrapHtml(html: string, eventId: number): string {
        const base = trackingBaseUrl();
        const ownPrefixes = ownTrackingPrefixes();
        const rewritten = html.replace(/<a\b([^>]*?)\bhref\s*=\s*(["'])(.*?)\2/gi, (m, attrs, q, url) => {
            const trimmed = String(url).trim();
            if (!trimmed) return m;
            if (/^(mailto:|tel:|#)/i.test(trimmed)) return m;
            if (ownPrefixes.some(p => trimmed.startsWith(p))) return m;
            if (/unsubscribe/i.test(trimmed) || /\bopt[-_]?out\b/i.test(trimmed)) return m;
            return `<a${attrs}href=${q}${base}/email-track/click/${eventId}?u=${encodeURIComponent(trimmed)}${q}`;
        });
        const pixel = `<img src="${base}/email-track/open/${eventId}.gif" width="1" height="1" alt="" border="0" style="display:none;border:0;max-height:1px;max-width:1px;outline:none;overflow:hidden;visibility:hidden">`;
        if (/<\/body>/i.test(rewritten)) return rewritten.replace(/<\/body>/i, `${pixel}</body>`);
        return rewritten + pixel;
    }
}
