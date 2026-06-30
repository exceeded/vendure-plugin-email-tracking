import { Injectable } from '@nestjs/common';
import { Logger, TransactionalConnection } from '@vendure/core';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
    classifyEmailEvent,
    ClassificationResult,
    ClassifierInput,
} from '@huloglobal/vendure-licence-sdk';
import { EmailLink, EmailLinkType } from './email-link.entity';

const loggerCtx = 'EmailLinkService';

/**
 * Per-link tokenisation + sensitive-link handling for transactional
 * emails sent through the HULO email-tracking plugin.
 *
 * Tokens are random opaque hex; they NEVER contain order/customer/
 * email/licence-key data. The destination URL is stored server-side
 * with a redacted form + hash so the click endpoint can identify
 * exactly which link was clicked (link_type, link_label, link_text,
 * link_index, template_section, host, etc) and surface that in the
 * admin UI.
 *
 * Sensitive-link handling: when `isSensitive: true` is passed, the
 * destination is treated as opaque — only the redacted form + hash
 * are persisted on the email_link row, and the click endpoint must
 * never persist the raw destination on the recorded event.
 *
 * Graceful degradation for hosts without optional related plugins:
 *  - No runtime import from invoice / support-ticket / order plugins
 *    happens here. All foreign-id fields are plain `int` columns,
 *    nullable, no FK constraints.
 *  - If the email_link migration hasn't been run yet, persistence
 *    fails silently — the redirect URL still works because the
 *    click endpoint verifies the signature without needing the row.
 */
@Injectable()
export class EmailLinkService {
    constructor(private connection: TransactionalConnection) {}

    private signingSecret(): string {
        return (
            process.env.HULO_EMAIL_LINK_SIGNING_SECRET ||
            process.env.HULO_ORDER_ACTIVITY_SIGNING_SECRET ||
            'hulo-email-link-default-signing-secret-set-env-in-prod'
        );
    }

    /**
     * Mint a token for one link in one email and persist its metadata.
     * Returns the redirect URL to embed in the email body.
     */
    async issueLinkToken(input: {
        emailLogId?: number | null;
        orderId?: number | null;
        invoiceId?: number | null;
        customerId?: number | null;
        supportTicketId?: number | null;
        linkIndex: number;
        linkLabel?: string | null;
        linkText?: string | null;
        templateSection?: string | null;
        linkType: EmailLinkType;
        destinationUrl: string;
        destinationUrlRedacted?: string | null;
        isSensitive?: boolean;
        isTrackingEnabled?: boolean;
        expiresAt?: Date | null;
        baseUrl: string;
    }): Promise<{ token: string; redirectUrl: string; emailLinkId: number | null }> {
        const token = randomBytes(32).toString('hex');
        const destHash = createHash('sha256').update(input.destinationUrl).digest('hex');
        const sig = createHmac('sha256', this.signingSecret())
            .update(`${token}|${input.destinationUrl}`)
            .digest('hex');
        const u = encodeURIComponent(input.destinationUrl);
        const redirectUrl =
            `${input.baseUrl.replace(/\/$/, '')}/email-track/click/${token}?u=${u}&s=${sig}`;

        let host: string | null = null;
        let path: string | null = null;
        try {
            const parsed = new URL(input.destinationUrl);
            host = parsed.hostname;
            path = parsed.pathname;
        } catch {}

        try {
            const repo = this.connection.rawConnection.getRepository(EmailLink);
            const row = await repo.save(repo.create({
                emailLogId: input.emailLogId ?? null,
                orderId: input.orderId ?? null,
                invoiceId: input.invoiceId ?? null,
                customerId: input.customerId ?? null,
                supportTicketId: input.supportTicketId ?? null,
                linkToken: token,
                linkIndex: input.linkIndex,
                linkLabel: input.linkLabel ?? null,
                linkText: input.linkText ?? null,
                templateSection: input.templateSection ?? null,
                linkType: input.linkType,
                destinationUrlRedacted: input.isSensitive
                    ? (input.destinationUrlRedacted ?? `[sensitive: ${host || 'unknown'}]`)
                    : (input.destinationUrlRedacted ?? input.destinationUrl),
                destinationUrlHost: host,
                destinationUrlPath: path,
                destinationUrlHash: destHash,
                signedDestinationToken: sig,
                isTrackingEnabled: input.isTrackingEnabled !== false,
                isSensitive: !!input.isSensitive,
                expiresAt: input.expiresAt ?? null,
            }));
            return { token, redirectUrl, emailLinkId: Number(row.id) };
        } catch (e: any) {
            // Don't fail the email send. The redirect still works via
            // signature verification — the click event just won't carry
            // server-side link metadata.
            Logger.warn(
                `EmailLink persistence skipped (${e?.message}) — link still redirects via signature`,
                loggerCtx,
            );
            return { token, redirectUrl, emailLinkId: null };
        }
    }

    /** Verify the destination signature in constant time. */
    verifyClickDestination(token: string, destinationUrl: string, providedSig: string): string | null {
        if (!token || !destinationUrl || !providedSig) return null;
        const expected = createHmac('sha256', this.signingSecret())
            .update(`${token}|${destinationUrl}`)
            .digest('hex');
        const a = Buffer.from(expected, 'hex');
        const b = Buffer.from(providedSig, 'hex');
        if (a.length !== b.length) return null;
        try {
            return timingSafeEqual(a, b) ? destinationUrl : null;
        } catch {
            return null;
        }
    }

    /** Look up an EmailLink row by token. Returns null if the
     *  email_link table doesn't exist yet OR the token is unknown. */
    async findLinkByToken(token: string): Promise<EmailLink | null> {
        if (!/^[0-9a-f]{64}$/.test(token)) return null;
        try {
            const repo = this.connection.rawConnection.getRepository(EmailLink);
            return repo.findOne({ where: { linkToken: token } });
        } catch {
            return null;
        }
    }

    /** Helper — apply the SDK classifier with the inputs the controller
     *  already has on hand. */
    classify(ua: string | null, ipFlags?: Omit<ClassifierInput, 'userAgent' | 'eventType'>): ClassificationResult {
        return classifyEmailEvent({
            userAgent: ua,
            ipIsVpn: ipFlags?.ipIsVpn ?? null,
            ipIsProxy: ipFlags?.ipIsProxy ?? null,
            ipIsTor: ipFlags?.ipIsTor ?? null,
            ipIsDatacentre: ipFlags?.ipIsDatacentre ?? null,
            ipIsKnownSecurityScanner: ipFlags?.ipIsKnownSecurityScanner ?? null,
            ipOrg: ipFlags?.ipOrg ?? null,
            ipRiskScore: ipFlags?.ipRiskScore ?? null,
        });
    }
}
