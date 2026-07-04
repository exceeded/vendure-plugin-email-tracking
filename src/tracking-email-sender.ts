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
        // Vendure's `EmailDetails` doesn't carry the source Order / Customer
        // through to the sender — we get subject/body only. Recover the
        // orderCode from the subject (Vendure's default templates render it
        // as `#<code>`) and then look up the Order by code for the id +
        // customerId. Best-effort: if none of that resolves, the row still
        // saves with just the raw envelope, exactly as before.
        const orderCode = this.extractOrderCode(email.subject, email.body);
        const linkedIds = orderCode ? await this.lookupOrderIds(orderCode) : null;
        const payload: Partial<EmailLog> = {
            type: this.inferType(email.subject),
            recipient: (email.recipient || '').slice(0, 500),
            subject: (email.subject || '').slice(0, 1000),
            fromAddress: (email.from || '').slice(0, 500),
            bcc: email.bcc?.slice(0, 500),
            replyTo: email.replyTo?.slice(0, 500),
            channelId: 1,
            status: 'sent' as EmailLogStatus,
            tracked: true,
        };
        if (orderCode) payload.orderCode = orderCode;
        if (linkedIds?.orderId) payload.orderId = linkedIds.orderId;
        if (linkedIds?.customerId != null) payload.customerId = linkedIds.customerId;
        const row = repo.create(payload);
        const saved: EmailLog = await repo.save(row);

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

    /**
     * Pull an order code out of the email subject (or, as a fallback,
     * the body). Vendure's default order-related templates render the
     * order code as `#<code>` in the subject, e.g.
     * "Order confirmation for #S2BZ54TEK91HUUBA". Order codes are always
     * uppercase alphanumeric — accept 10–32 characters to cover custom
     * `orderCodeStrategy` implementations.
     */
    private extractOrderCode(subject?: string, body?: string): string | null {
        const rx = /#([A-Z0-9]{10,32})\b/;
        const inSubject = rx.exec(subject || '');
        if (inSubject) return inSubject[1];
        const inBody = rx.exec(body || '');
        return inBody ? inBody[1] : null;
    }

    /**
     * Look up `orderId` + `customerId` for an order code so the
     * per-order and per-customer Emails views can filter without a
     * subject-string match. Best-effort — if the order isn't found
     * (e.g. code came from a draft template that was never saved),
     * we return null and let the row save with only `orderCode`.
     */
    private async lookupOrderIds(
        code: string,
    ): Promise<{ orderId: number; customerId: number | null } | null> {
        try {
            const rows: any[] = await this.connection.rawConnection.query(
                'SELECT id, customerId FROM `order` WHERE code = ? LIMIT 1',
                [code],
            );
            if (!rows?.length) return null;
            const r = rows[0];
            return {
                orderId: Number(r.id),
                customerId: r.customerId != null ? Number(r.customerId) : null,
            };
        } catch (e: any) {
            Logger.warn(`orderId lookup failed for code=${code}: ${e?.message}`, loggerCtx);
            return null;
        }
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
