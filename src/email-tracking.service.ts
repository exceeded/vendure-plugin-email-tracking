import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { hashIp, isLicensed, signValue, startRetentionSweeper } from '@huloglobal/vendure-licence-sdk';
import { Logger, TransactionalConnection } from '@vendure/core';
import * as nodemailer from 'nodemailer';
import { EmailLog, EmailLogStatus } from './email-log.entity';
import { EmailSuppression } from './email-suppression.entity';
import { lookupGeo } from './geo-lookup';
import { getLicenceStatus, getOptions, ownTrackingPrefixes, trackingBaseUrl } from './options';
import { parseEmailClient } from './parse-ua';

const loggerCtx = 'EmailTrackingService';

interface SendTrackedMeta {
    /** Logical email type — e.g. 'welcome', 'order-confirmation', 'invoice'. */
    type: string;
    /** Optional context string, e.g. chase stage 'T-7' / 'due' / 'T+14'. */
    context?: string;
    /** Channel id (1 = elite, 2 = LD). Defaults to 1. */
    channelId?: number;
    customerId?: number;
    orderId?: number;
    orderCode?: string;
    invoiceId?: number;
    applicationId?: number;
}

@Injectable()
export class EmailTrackingService implements OnApplicationBootstrap, OnModuleDestroy {
    private stopRetention: (() => void) | null = null;

    constructor(private connection: TransactionalConnection) {}

    /** Called by Nest after every provider is initialised. Safe place to
     *  start background sweepers that need DB access. */
    onApplicationBootstrap(): void {
        const opts = getOptions();
        if (!opts.retention) return;
        this.stopRetention = startRetentionSweeper({
            getConnection: () => this.connection.rawConnection,
            table: 'email_log',
            options: opts.retention,
            label: 'email-tracking',
        });
    }

    onModuleDestroy(): void {
        this.stopRetention?.();
        this.stopRetention = null;
    }

    /**
     * Send an email through nodemailer with full tracking: creates an
     * EmailLog row, injects a 1×1 open-tracking pixel, rewrites every
     * `href` in the html to go through our click-tracker, records the
     * SMTP response on success / failure.
     *
     * Returns the created EmailLog row (with id). Throws only if the
     * transport configuration itself is invalid; SMTP delivery failures
     * are caught and recorded as status='failed' / 'deferred'.
     */
    async sendTracked(
        transporter: nodemailer.Transporter,
        mail: nodemailer.SendMailOptions,
        meta: SendTrackedMeta,
    ): Promise<EmailLog> {
        const repo = this.connection.rawConnection.getRepository(EmailLog);
        const recipient = this.firstAddress(mail.to) || '';

        // Suppression check — refuse to call SMTP for recipients on the
        // suppression list, and record a `status='suppressed'` row so
        // the admin can still see the attempt in the log.
        if (recipient && await this.isSuppressed(recipient)) {
            const suppressed = repo.create({
                type: meta.type, recipient,
                subject: String(mail.subject || ''),
                fromAddress: this.firstAddress(mail.from as any),
                channelId: meta.channelId || 1,
                customerId: meta.customerId, orderId: meta.orderId, orderCode: meta.orderCode,
                invoiceId: meta.invoiceId, applicationId: meta.applicationId,
                status: 'suppressed' as EmailLogStatus, tracked: true,
                errorMessage: 'Recipient is on the suppression list',
            });
            return await repo.save(suppressed);
        }

        // Create the row up-front so the pixel/click URLs have an id to
        // reference. status starts as 'sent' optimistically; we update
        // it if the SMTP submit throws or returns 4xx/5xx.
        const row = repo.create({
            type: meta.type,
            recipient: this.firstAddress(mail.to),
            subject: String(mail.subject || ''),
            fromAddress: this.firstAddress(mail.from as any),
            bcc: this.firstAddress(mail.bcc),
            replyTo: this.firstAddress(mail.replyTo as any),
            context: meta.context,
            channelId: meta.channelId || 1,
            customerId: meta.customerId,
            orderId: meta.orderId,
            orderCode: meta.orderCode,
            invoiceId: meta.invoiceId,
            applicationId: meta.applicationId,
            status: 'sent' as EmailLogStatus,
            tracked: true,
        });
        const saved = await repo.save(row);

        // Wrap the HTML — clicks first (so the pixel itself isn't rewritten),
        // then the pixel append. Plain-text-only emails are unaffected.
        const html = mail.html ? String(mail.html) : '';
        if (html) {
            const wrapped = this.wrapHtml(html, Number(saved.id));
            mail = { ...mail, html: wrapped };
        }

        // Send.
        try {
            const info = await transporter.sendMail(mail);
            saved.smtpResponse = String(info.response || '').slice(0, 500);
            saved.smtpMessageId = String(info.messageId || '').slice(0, 500);
            // Gmail's "250 2.0.0 OK" → sent. 4xx → deferred. 5xx → failed.
            const code = parseInt((info.response || '').split(' ')[0], 10);
            if (code >= 500) saved.status = 'failed';
            else if (code >= 400) saved.status = 'deferred';
            else saved.status = 'sent';
            await repo.save(saved);
        } catch (e: any) {
            saved.status = 'failed';
            saved.errorMessage = String(e?.message || e).slice(0, 2000);
            saved.smtpResponse = e?.response ? String(e.response).slice(0, 500) : '';
            await repo.save(saved);
            Logger.error(`Tracked send FAILED [${meta.type}] to ${saved.recipient}: ${e?.message}`, loggerCtx);
            throw e;
        }
        Logger.info(`Tracked send OK [${meta.type}] to ${saved.recipient} (id=${saved.id})`, loggerCtx);
        return saved;
    }

    /** Wrap an HTML body for tracking: rewrite links + append open pixel. */
    wrapHtml(html: string, eventId: number): string {
        const base = trackingBaseUrl();
        const token = this.tokenForId(eventId);
        const trackedHtml = this.rewriteLinks(html, token, base);
        const pixel = `<img src="${base}/email-track/open/${token}.gif" width="1" height="1" alt="" border="0" style="display:none;border:0;max-height:1px;max-width:1px;outline:none;overflow:hidden;visibility:hidden">`;
        if (/<\/body>/i.test(trackedHtml)) {
            return trackedHtml.replace(/<\/body>/i, `${pixel}</body>`);
        }
        return trackedHtml + pixel;
    }

    /** Build the URL path token for an email-log id. When a
     *  `signingSecret` is configured, the token is `<id>.<hmac>` so the
     *  controller can verify nobody forged a URL. Without a secret we
     *  fall back to the bare id (legacy behaviour). */
    private tokenForId(eventId: number): string {
        const secret = getOptions().signingSecret;
        if (secret) return signValue(String(eventId), secret);
        return String(eventId);
    }

    private rewriteLinks(html: string, token: string, base: string): string {
        const ownPrefixes = ownTrackingPrefixes();
        return html.replace(/<a\b([^>]*?)\bhref\s*=\s*(["'])(.*?)\2/gi, (match, attrs, quote, url) => {
            const trimmed = String(url).trim();
            if (!trimmed) return match;
            if (/^(mailto:|tel:|#)/i.test(trimmed)) return match;
            if (ownPrefixes.some(p => trimmed.startsWith(p))) return match;
            if (/unsubscribe/i.test(trimmed) || /\bopt[-_]?out\b/i.test(trimmed)) return match;
            const encoded = encodeURIComponent(trimmed);
            return `<a${attrs}href=${quote}${base}/email-track/click/${token}?u=${encoded}${quote}`;
        });
    }

    /** Record a pixel-hit open. Idempotent re-counting; firstOpenedAt only
     *  set the first time. Full history of the last 50 opens is kept on
     *  the row as `opensJson` for the admin detail page.
     *
     *  Each open entry includes:
     *    - ts        ISO timestamp
     *    - ip        raw or hashed (per `hashIpsInHistory` option)
     *    - ipHash    one-way hash with the per-install salt
     *    - ua / client / platform / isBot   from parseEmailClient
     *    - country / region / city / timezone   best-effort MaxMind geo
     */
    async recordOpen(id: number, ip: string | null, ua: string | null) {
        const repo = this.connection.rawConnection.getRepository(EmailLog);
        const row = await repo.findOne({ where: { id } });
        if (!row) return;
        const opts = getOptions();
        const now = new Date();
        row.lastOpenedAt = now;
        row.openCount = (row.openCount || 0) + 1;

        // Geo lookup uses the raw IP — done before hashing so we can
        // resolve country/city even when the stored IP is anonymised.
        const geo = await lookupGeo(ip);
        const ipForRow = opts.hashIpsInHistory ? hashIp(ip, opts.ipSalt || '') : ip;

        if (!row.firstOpenedAt) {
            row.firstOpenedAt = now;
            row.firstOpenIp = ipForRow || undefined as any;
            row.firstOpenUserAgent = ua ? ua.slice(0, 1000) : undefined as any;
        }
        let opens: any[] = [];
        try { opens = JSON.parse(row.opensJson || '[]'); } catch {}
        const parsed = parseEmailClient(ua);
        opens.push({
            ts: now.toISOString(),
            ip: ipForRow,
            ipHash: hashIp(ip, opts.ipSalt || ''),
            ua: ua ? ua.slice(0, 300) : null,
            client: parsed.client,
            platform: parsed.platform,
            isBot: parsed.isBot,
            country: geo.country,
            region: geo.region,
            city: geo.city,
            timezone: geo.timezone,
        });
        if (opens.length > 50) opens = opens.slice(-50);
        row.opensJson = JSON.stringify(opens);
        await repo.save(row);
    }

    /** Record a click. Geo + IP hashing applied the same way as opens. */
    async recordClick(id: number, url: string, ip: string | null, ua: string | null): Promise<string | null> {
        const repo = this.connection.rawConnection.getRepository(EmailLog);
        const row = await repo.findOne({ where: { id } });
        if (!row) return null;
        const opts = getOptions();
        const now = new Date();
        if (!row.firstClickedAt) row.firstClickedAt = now;
        row.clickCount = (row.clickCount || 0) + 1;

        const geo = await lookupGeo(ip);
        const ipForRow = opts.hashIpsInHistory ? hashIp(ip, opts.ipSalt || '') : ip;

        let clicks: any[] = [];
        try { clicks = JSON.parse(row.clicksJson || '[]'); } catch {}
        clicks.push({
            url: url.slice(0, 1000),
            ts: now.toISOString(),
            ip: ipForRow,
            ipHash: hashIp(ip, opts.ipSalt || ''),
            ua: ua ? ua.slice(0, 300) : null,
            country: geo.country,
            region: geo.region,
            city: geo.city,
            timezone: geo.timezone,
        });
        if (clicks.length > 50) clicks = clicks.slice(-50);
        row.clicksJson = JSON.stringify(clicks);
        await repo.save(row);
        return url;
    }

    /** SMTP DSN (bounce / complaint) hook — wire up if you point Postmaster
     *  Tools / a bounce-processor at /email-track/bounce. Hard bounces +
     *  complaints automatically add the recipient to the suppression list
     *  so the next send-attempt is refused. */
    async recordBounce(messageId: string, status: 'bounced' | 'complained', reason?: string) {
        const repo = this.connection.rawConnection.getRepository(EmailLog);
        const row = await repo.findOne({ where: { smtpMessageId: messageId } });
        if (!row) return false;
        row.status = status;
        if (reason) row.errorMessage = reason.slice(0, 2000);
        await repo.save(row);

        if (row.recipient) {
            const suppressionReason = status === 'complained' ? 'complaint' : 'hard-bounce';
            await this.addSuppression(row.recipient, suppressionReason, reason || `Auto-added from ${status} on email #${row.id}`, row.channelId);
        }
        return true;
    }

    /** Returns true if the recipient should be skipped at send-time. */
    async isSuppressed(recipient: string): Promise<boolean> {
        // Suppression-list enforcement is a paid feature. Unlicensed
        // installs always return false here so the suppression rows
        // are visible in the admin UI but not consulted on send —
        // matches the privacy boundary "we don't gate your own emails".
        if (!isLicensed(getLicenceStatus())) return false;
        if (!recipient) return false;
        const repo = this.connection.rawConnection.getRepository(EmailSuppression);
        const row = await repo.findOne({ where: { recipient: recipient.toLowerCase() } });
        return !!row;
    }

    async addSuppression(recipient: string, reason: string, note?: string, channelId?: number): Promise<EmailSuppression> {
        const repo = this.connection.rawConnection.getRepository(EmailSuppression);
        const lower = recipient.toLowerCase();
        const existing = await repo.findOne({ where: { recipient: lower } });
        if (existing) {
            if (note && note !== existing.note) {
                existing.note = note.slice(0, 2000);
                return await repo.save(existing);
            }
            return existing;
        }
        const row = repo.create({
            recipient: lower,
            reason,
            note: note ? note.slice(0, 2000) : (null as any),
            channelId: channelId || null as any,
        });
        return await repo.save(row);
    }

    async removeSuppression(recipient: string): Promise<boolean> {
        const repo = this.connection.rawConnection.getRepository(EmailSuppression);
        const res = await repo.delete({ recipient: recipient.toLowerCase() });
        return !!(res.affected && res.affected > 0);
    }

    private firstAddress(addr: any): string | undefined {
        if (!addr) return undefined;
        if (typeof addr === 'string') return addr.slice(0, 500);
        if (Array.isArray(addr)) return addr.map(a => typeof a === 'string' ? a : a?.address).filter(Boolean).join(', ').slice(0, 500);
        if (addr.address) return String(addr.address).slice(0, 500);
        return String(addr).slice(0, 500);
    }
}
