/**
 * Vendure Admin API extensions for HULO Email Tracking.
 *
 * Mirrors the operator endpoints from the REST controller so Admin UI
 * extensions, codegen-generated TS clients and the standard GraphQL
 * playground can drive the plugin natively.
 *
 * Storefront paths (`/email-track/open/:token.gif`,
 * `/email-track/click/:token`, `/email-track/bounce-webhook`) stay REST
 * — they return non-JSON or are anonymous high-frequency.
 */
import { Injectable } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { gql } from 'graphql-tag';
import { Allow, Ctx, Permission, RequestContext, TransactionalConnection } from '@vendure/core';
import { isLicensed, premiumFeatureError } from '@huloglobal/vendure-licence-sdk';
import { EmailLog } from './email-log.entity';
import { EmailSuppression } from './email-suppression.entity';
import { EmailTrackingService } from './email-tracking.service';
import { getLicenceStatus } from './options';

export const emailTrackingAdminApiSchema = gql`
    type HuloEmailLog {
        id: ID!
        createdAt: DateTime!
        type: String
        recipient: String!
        subject: String
        status: String!
        openCount: Int!
        clickCount: Int!
        customerId: Int
        orderId: Int
        orderCode: String
        invoiceId: String
        smtpMessageId: String
        errorMessage: String
        firstOpenedAt: DateTime
        lastOpenedAt: DateTime
        firstClickedAt: DateTime
        lastClickedAt: DateTime
    }

    type HuloEmailLogList {
        items: [HuloEmailLog!]!
        totalItems: Int!
    }

    type HuloEmailTemplateStats {
        type: String!
        sent: Int!
        opened: Int!
        clicked: Int!
        bounced: Int!
        failed: Int!
        suppressed: Int!
        totalOpens: Int!
        totalClicks: Int!
        openRate: Float!
        clickRate: Float!
        ctor: Float!
    }

    type HuloEmailTemplateStatsList {
        days: Int!
        types: [HuloEmailTemplateStats!]!
    }

    type HuloEmailSuppression {
        id: ID!
        createdAt: DateTime!
        recipient: String!
        reason: String!
        note: String
        channelId: Int
    }

    type HuloEmailSuppressionList {
        items: [HuloEmailSuppression!]!
        totalItems: Int!
    }

    input HuloEmailLogFilter {
        customerId: Int
        orderId: Int
        orderCode: String
        status: String
        type: String
        recipient: String
        from: DateTime
        to: DateTime
    }

    input HuloEmailLogListOptions {
        take: Int
        skip: Int
        filter: HuloEmailLogFilter
    }

    input HuloAddSuppressionInput {
        recipient: String!
        reason: String!
        note: String
        channelId: Int
    }

    extend type Query {
        huloEmailLogs(options: HuloEmailLogListOptions): HuloEmailLogList!
        huloEmailLog(id: ID!): HuloEmailLog
        huloEmailStatsByTemplate(days: Int): HuloEmailTemplateStatsList!
        huloEmailSuppressions(recipient: String, take: Int): HuloEmailSuppressionList!
    }

    extend type Mutation {
        huloAddEmailSuppression(input: HuloAddSuppressionInput!): HuloEmailSuppression!
        huloRemoveEmailSuppression(id: ID!): Boolean!
    }
`;

@Resolver()
@Injectable()
export class EmailTrackingAdminResolver {
    constructor(
        private connection: TransactionalConnection,
        private tracking: EmailTrackingService,
    ) {}

    @Query()
    @Allow(Permission.ReadCustomer)
    async huloEmailLogs(@Ctx() ctx: RequestContext, @Args('options') options?: any): Promise<any> {
        const o = options || {};
        const f = o.filter || {};
        const take = Math.min(Math.max(Number(o.take) || 50, 1), 500);
        const skip = Math.max(Number(o.skip) || 0, 0);
        const where: string[] = [];
        const params: any[] = [];
        if (f.customerId) { where.push('customerId = ?'); params.push(Number(f.customerId)); }
        if (f.orderId)    { where.push('orderId = ?'); params.push(Number(f.orderId)); }
        if (f.orderCode)  { where.push('orderCode = ?'); params.push(String(f.orderCode)); }
        if (f.status)     { where.push('status = ?'); params.push(String(f.status)); }
        if (f.type)       { where.push('type = ?'); params.push(String(f.type)); }
        if (f.recipient)  { where.push('recipient LIKE ?'); params.push(`%${String(f.recipient)}%`); }
        if (f.from)       { where.push('createdAt >= ?'); params.push(new Date(f.from)); }
        if (f.to)         { where.push('createdAt <= ?'); params.push(new Date(f.to)); }
        const w = where.length ? ` WHERE ${where.join(' AND ')}` : '';

        const items = await this.connection.rawConnection.query(
            `SELECT id, createdAt, type, recipient, subject, status, openCount, clickCount,
                    customerId, orderId, orderCode, invoiceId, smtpMessageId, errorMessage,
                    firstOpenedAt, lastOpenedAt, firstClickedAt, lastClickedAt
             FROM email_log${w} ORDER BY id DESC LIMIT ? OFFSET ?`,
            [...params, take, skip],
        );
        const totals = await this.connection.rawConnection.query(
            `SELECT COUNT(*) AS n FROM email_log${w}`, params,
        );
        return { items, totalItems: Number((totals as any[])[0]?.n) || 0 };
    }

    @Query()
    @Allow(Permission.ReadCustomer)
    async huloEmailLog(@Args('id') id: string): Promise<any> {
        const repo = this.connection.rawConnection.getRepository(EmailLog);
        const row = await repo.findOne({ where: { id: Number(id) } as any });
        return row || null;
    }

    @Query()
    @Allow(Permission.ReadCustomer)
    async huloEmailStatsByTemplate(@Args('days') daysInput?: number): Promise<any> {
        if (!isLicensed(getLicenceStatus())) {
            throw new Error(premiumFeatureError('vendure-plugin-email-tracking').message);
        }
        const days = Math.min(Math.max(Number(daysInput) || 30, 1), 365);
        const rows = await this.connection.rawConnection.query(
            `SELECT type,
                    COUNT(*)                                   AS sent,
                    SUM(openCount > 0)                         AS opened,
                    SUM(clickCount > 0)                        AS clicked,
                    SUM(status='bounced' OR status='complained') AS bounced,
                    SUM(status='failed')                       AS failed,
                    SUM(status='suppressed')                   AS suppressed,
                    SUM(openCount)                             AS totalOpens,
                    SUM(clickCount)                            AS totalClicks
             FROM email_log
             WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY)
             GROUP BY type
             ORDER BY sent DESC`,
            [days],
        );
        return {
            days,
            types: rows.map((r: any) => ({
                type: r.type || '(unspecified)',
                sent: Number(r.sent) || 0,
                opened: Number(r.opened) || 0,
                clicked: Number(r.clicked) || 0,
                bounced: Number(r.bounced) || 0,
                failed: Number(r.failed) || 0,
                suppressed: Number(r.suppressed) || 0,
                totalOpens: Number(r.totalOpens) || 0,
                totalClicks: Number(r.totalClicks) || 0,
                openRate:  r.sent > 0 ? Number(r.opened)  / Number(r.sent) : 0,
                clickRate: r.sent > 0 ? Number(r.clicked) / Number(r.sent) : 0,
                ctor:      r.opened > 0 ? Number(r.clicked) / Number(r.opened) : 0,
            })),
        };
    }

    @Query()
    @Allow(Permission.ReadCustomer)
    async huloEmailSuppressions(@Args('recipient') recipient?: string, @Args('take') take?: number): Promise<any> {
        const n = Math.min(Math.max(Number(take) || 200, 1), 1000);
        const repo = this.connection.rawConnection.getRepository(EmailSuppression);
        const items = recipient
            ? await repo.find({ where: { recipient: String(recipient).toLowerCase() }, take: n, order: { id: 'DESC' } })
            : await repo.find({ take: n, order: { id: 'DESC' } });
        return { items, totalItems: items.length };
    }

    @Mutation()
    @Allow(Permission.UpdateCustomer)
    async huloAddEmailSuppression(@Args('input') input: any): Promise<any> {
        if (!input?.recipient || !input?.reason) throw new Error('recipient and reason are required');
        return this.tracking.addSuppression(
            String(input.recipient),
            String(input.reason),
            input.note ? String(input.note) : undefined,
            input.channelId ? Number(input.channelId) : undefined,
        );
    }

    @Mutation()
    @Allow(Permission.UpdateCustomer)
    async huloRemoveEmailSuppression(@Args('id') id: string): Promise<boolean> {
        const repo = this.connection.rawConnection.getRepository(EmailSuppression);
        const result = await repo.delete({ id: Number(id) as any });
        return !!result.affected;
    }
}
