import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Ctx, Logger, Permission, RequestContext, TransactionalConnection } from '@vendure/core';
import { Request, Response } from 'express';
import { EmailLog } from './email-log.entity';
import { EmailSuppression } from './email-suppression.entity';
import { EmailTrackingService } from './email-tracking.service';
import { EmailTrackingPlugin } from './plugin';
import { getOptions, getLicenceStatus } from './options';

const loggerCtx = 'EmailTrackingController';

// 1×1 transparent GIF (43 bytes) returned by the open-tracking endpoint.
const ONE_PX_GIF = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64',
);

import { getRealIp } from './proxy-headers';
function realIp(req: Request): string | null { return getRealIp(req); }

function requireAdmin(ctx: RequestContext, res: Response, write = false): boolean {
    if (!ctx?.activeUserId) {
        res.status(401).json({ error: 'Authentication required' });
        return false;
    }
    const needed = write ? [Permission.UpdateCustomer] : [Permission.ReadCustomer];
    if (!ctx.userHasPermissions(needed)) {
        res.status(403).json({ error: 'Insufficient permissions' });
        return false;
    }
    return true;
}

@Controller('email-track')
export class EmailTrackingController {
    constructor(
        private connection: TransactionalConnection,
        private tracking: EmailTrackingService,
    ) {}

    /**
     * Admin: plugin health + update availability. Read by the admin UI
     * banner so the operator sees when a new version is on npm.
     *
     * GET /email-track/status
     */
    @Get('status')
    async status(@Ctx() ctx: RequestContext, @Res() res: Response) {
        if (!requireAdmin(ctx, res, false)) return;
        const updater = EmailTrackingPlugin.getUpdateChecker();
        const update = updater ? updater.getStatus() : null;
        const licence = getLicenceStatus();
        return res.json({
            packageName: EmailTrackingPlugin.getPackageName(),
            version: EmailTrackingPlugin.getPackageVersion(),
            licence: licence ? { valid: licence.valid, reason: licence.reason, plan: licence.payload?.plan, expiresAt: licence.payload?.exp } : null,
            update,
            uptimeSec: Math.round(process.uptime()),
        });
    }

    /**
     * Open-tracking pixel. Returns a 1×1 transparent GIF and logs the
     * open against the event. No-cache so privacy-protecting prefetchers
     * still get caught per fetch (and we count opens accurately).
     *
     * GET /email-track/open/:id.gif
     */
    @Get('open/:id.gif')
    async open(@Param('id') idParam: string, @Req() req: Request, @Res() res: Response) {
        const id = parseInt(idParam, 10);
        if (!isNaN(id) && id > 0) {
            this.tracking.recordOpen(id, realIp(req), req.headers['user-agent'] as string || null)
                .catch((e: any) => Logger.warn(`open log fail #${id}: ${e?.message}`, loggerCtx));
        }
        res.setHeader('Content-Type', 'image/gif');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        return res.end(ONE_PX_GIF);
    }

    /**
     * Click redirect. Logs the click then 302-redirects to the original
     * URL. Returns 400 if the URL is missing or malformed (we never
     * redirect to an empty / javascript: target).
     *
     * GET /email-track/click/:id?u=<encoded>
     */
    @Get('click/:id')
    async click(@Param('id') idParam: string, @Query('u') u: string, @Req() req: Request, @Res() res: Response) {
        const id = parseInt(idParam, 10);
        const url = (u || '').trim();
        if (!url || !/^https?:\/\//i.test(url)) {
            return res.status(400).send('Invalid redirect target');
        }
        if (!isNaN(id) && id > 0) {
            await this.tracking.recordClick(id, url, realIp(req), req.headers['user-agent'] as string || null)
                .catch((e: any) => Logger.warn(`click log fail #${id}: ${e?.message}`, loggerCtx));
        }
        res.setHeader('Cache-Control', 'no-store');
        return res.redirect(302, url);
    }

    /**
     * Bounce webhook. Wire up a postmaster / mail-server hook (or have a
     * scheduled DSN-parser POST here) to mark messages as bounced or
     * complained. Both fields are required; the messageId is the
     * `<...@domain>` value Gmail returned at submit time.
     *
     * POST /email-track/bounce
     * Body: { messageId, status: 'bounced'|'complained', reason? }
     *
     * Currently unauthenticated to keep the integration simple — gate
     * behind a shared secret header if you expose the endpoint to the
     * public internet (it's fine on a private network).
     */
    @Post('bounce')
    async bounce(@Body() body: any, @Res() res: Response) {
        const messageId = String(body?.messageId || '').trim();
        const status = body?.status === 'complained' ? 'complained' : 'bounced';
        if (!messageId) return res.status(400).json({ error: 'messageId required' });
        const ok = await this.tracking.recordBounce(messageId, status, body?.reason);
        return res.json({ ok, matched: ok });
    }

    /**
     * Admin: list email events, with filtering for the "Email Log" page
     * and the per-customer Emails tab. Filterable by customerId, orderId,
     * orderCode, status, type, recipient, and a date range.
     *
     * GET /email-track/log?customerId=&orderId=&status=&take=
     */
    @Get('log')
    async listLog(@Ctx() ctx: RequestContext, @Req() req: Request, @Res() res: Response) {
        if (!requireAdmin(ctx, res, false)) return;
        const q = req.query as any;
        const take = Math.min(parseInt(q.take, 10) || 100, 500);
        const skip = parseInt(q.skip, 10) || 0;
        const where: string[] = [];
        const params: any[] = [];
        if (q.customerId) { where.push('customerId = ?'); params.push(parseInt(q.customerId, 10)); }
        if (q.orderId) { where.push('orderId = ?'); params.push(parseInt(q.orderId, 10)); }
        if (q.orderCode) { where.push('orderCode = ?'); params.push(String(q.orderCode)); }
        if (q.invoiceId) { where.push('invoiceId = ?'); params.push(parseInt(q.invoiceId, 10)); }
        if (q.status) { where.push('status = ?'); params.push(String(q.status)); }
        if (q.type) { where.push('type = ?'); params.push(String(q.type)); }
        if (q.recipient) { where.push('recipient LIKE ?'); params.push(`%${String(q.recipient)}%`); }
        if (q.from) { where.push('createdAt >= ?'); params.push(new Date(String(q.from))); }
        if (q.to) { where.push('createdAt <= ?'); params.push(new Date(String(q.to))); }

        const whereClause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
        const rows = await this.connection.rawConnection.query(
            `SELECT id, createdAt, type, recipient, subject, status,
                    customerId, orderId, orderCode, invoiceId, applicationId,
                    channelId, openCount, firstOpenedAt, lastOpenedAt,
                    clickCount, firstClickedAt, smtpResponse, errorMessage
             FROM email_log
             ${whereClause}
             ORDER BY createdAt DESC
             LIMIT ? OFFSET ?`,
            [...params, take, skip],
        );
        const [{ total }] = await this.connection.rawConnection.query(
            `SELECT COUNT(*) AS total FROM email_log${whereClause}`, params,
        );
        return res.json({ items: rows, total: Number(total) || 0, take, skip });
    }

    /** Admin: aggregate counts by status for a quick dashboard tile. */
    @Get('log/summary')
    async logSummary(@Ctx() ctx: RequestContext, @Req() req: Request, @Res() res: Response) {
        if (!requireAdmin(ctx, res, false)) return;
        const fromDays = parseInt((req.query as any).fromDays, 10) || 30;
        const rows = await this.connection.rawConnection.query(
            `SELECT status, COUNT(*) AS n, SUM(openCount) AS opens, SUM(clickCount) AS clicks
             FROM email_log
             WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY)
             GROUP BY status`,
            [fromDays],
        );
        const summary: any = { sent: 0, failed: 0, deferred: 0, bounced: 0, complained: 0, opens: 0, clicks: 0, fromDays };
        for (const r of rows) {
            summary[r.status] = Number(r.n);
            summary.opens += Number(r.opens) || 0;
            summary.clicks += Number(r.clicks) || 0;
        }
        return res.json(summary);
    }

    /** Admin: full detail for one event including the clicks JSON. */
    @Get('log/:id')
    async logDetail(@Ctx() ctx: RequestContext, @Param('id') idParam: string, @Res() res: Response) {
        if (!requireAdmin(ctx, res, false)) return;
        const id = parseInt(idParam, 10);
        if (!id) return res.status(400).json({ error: 'Invalid id' });
        const row = await this.connection.rawConnection.getRepository(EmailLog).findOne({ where: { id } });
        if (!row) return res.status(404).json({ error: 'Not found' });
        let clicks: any[] = [];
        let opens: any[] = [];
        try { clicks = JSON.parse(row.clicksJson || '[]'); } catch {}
        try { opens = JSON.parse(row.opensJson || '[]'); } catch {}
        return res.json({ ...row, clicks, opens, clicksJson: undefined, opensJson: undefined });
    }

    /** Admin: per-template aggregates — open rate + CTR by `type`.
     * Drives the "By template" tab in the admin UI. */
    @Get('log/stats/by-template')
    async byTemplate(@Ctx() ctx: RequestContext, @Req() req: Request, @Res() res: Response) {
        if (!requireAdmin(ctx, res, false)) return;
        const days = Math.min(Math.max(parseInt((req.query as any).fromDays, 10) || 30, 1), 365);
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
        return res.json({ days, types: rows.map((r: any) => ({
            ...r,
            openRate: r.sent > 0 ? (r.opened / r.sent) : 0,
            clickRate: r.sent > 0 ? (r.clicked / r.sent) : 0,
            ctor: r.opened > 0 ? (r.clicked / r.opened) : 0, // click-to-open
        })) });
    }

    /** Admin: CSV export of the log with the same filters as the list view. */
    @Get('log/export.csv')
    async exportCsv(@Ctx() ctx: RequestContext, @Req() req: Request, @Res() res: Response) {
        if (!requireAdmin(ctx, res, false)) return;
        const q = req.query as any;
        const where: string[] = [];
        const params: any[] = [];
        if (q.customerId) { where.push('customerId = ?'); params.push(parseInt(q.customerId, 10)); }
        if (q.orderId) { where.push('orderId = ?'); params.push(parseInt(q.orderId, 10)); }
        if (q.orderCode) { where.push('orderCode = ?'); params.push(String(q.orderCode)); }
        if (q.status) { where.push('status = ?'); params.push(String(q.status)); }
        if (q.type) { where.push('type = ?'); params.push(String(q.type)); }
        if (q.recipient) { where.push('recipient LIKE ?'); params.push(`%${String(q.recipient)}%`); }
        if (q.from) { where.push('createdAt >= ?'); params.push(new Date(String(q.from))); }
        if (q.to) { where.push('createdAt <= ?'); params.push(new Date(String(q.to))); }
        const whereClause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
        const rows = await this.connection.rawConnection.query(
            `SELECT createdAt, type, recipient, subject, status,
                    openCount, clickCount, customerId, orderCode, invoiceId,
                    smtpMessageId, errorMessage
             FROM email_log ${whereClause}
             ORDER BY createdAt DESC LIMIT 50000`,
            params,
        );
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="email-log-${new Date().toISOString().slice(0, 10)}.csv"`);
        const esc = (v: any): string => {
            if (v === null || v === undefined) return '';
            const s = String(v).replace(/"/g, '""');
            return /[",\n]/.test(s) ? `"${s}"` : s;
        };
        const header = 'createdAt,type,recipient,subject,status,openCount,clickCount,customerId,orderCode,invoiceId,smtpMessageId,errorMessage\n';
        res.write(header);
        for (const r of rows) {
            res.write([
                esc(r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt),
                esc(r.type), esc(r.recipient), esc(r.subject), esc(r.status),
                esc(r.openCount), esc(r.clickCount), esc(r.customerId),
                esc(r.orderCode), esc(r.invoiceId),
                esc(r.smtpMessageId), esc(r.errorMessage),
            ].join(',') + '\n');
        }
        return res.end();
    }

    /** Admin: list suppression entries. */
    @Get('suppression')
    async listSuppression(@Ctx() ctx: RequestContext, @Req() req: Request, @Res() res: Response) {
        if (!requireAdmin(ctx, res, false)) return;
        const take = Math.min(parseInt(String((req.query as any).take), 10) || 200, 1000);
        const recipient = (req.query as any).recipient;
        const rows = recipient
            ? await this.connection.rawConnection.getRepository(EmailSuppression).find({
                where: { recipient: String(recipient).toLowerCase() }, take,
            })
            : await this.connection.rawConnection.getRepository(EmailSuppression).find({
                order: { id: 'DESC' }, take,
            });
        return res.json({ items: rows, total: rows.length });
    }

    /** Admin: manually suppress a recipient (e.g. when the customer asks
     * to be removed). */
    @Post('suppression')
    async addSuppression(@Ctx() ctx: RequestContext, @Body() body: any, @Res() res: Response) {
        if (!requireAdmin(ctx, res, true)) return;
        const recipient = String(body?.recipient || '').trim();
        if (!recipient.includes('@')) return res.status(400).json({ error: 'Valid recipient required' });
        const row = await this.tracking.addSuppression(
            recipient,
            String(body?.reason || 'manual'),
            body?.note ? String(body.note) : undefined,
            body?.channelId ? Number(body.channelId) : undefined,
        );
        return res.json({ ok: true, row });
    }

    /** Admin: lift a suppression (recipient asked to be re-subscribed,
     * or it was a transient hard bounce). */
    @Delete('suppression/:recipient')
    async deleteSuppression(@Ctx() ctx: RequestContext, @Param('recipient') recipient: string, @Res() res: Response) {
        if (!requireAdmin(ctx, res, true)) return;
        const removed = await this.tracking.removeSuppression(recipient);
        return res.json({ ok: removed });
    }
}
