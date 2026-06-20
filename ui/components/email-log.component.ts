import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { NotificationService } from '@vendure/admin-ui/core';

interface EmailRow {
    id: number;
    createdAt: string;
    type: string;
    recipient: string;
    subject: string;
    status: string;
    customerId: number | null;
    orderId: number | null;
    orderCode: string | null;
    invoiceId: number | null;
    applicationId: number | null;
    channelId: number;
    openCount: number;
    firstOpenedAt: string | null;
    lastOpenedAt: string | null;
    clickCount: number;
    firstClickedAt: string | null;
    smtpResponse: string | null;
    errorMessage: string | null;
}

interface EmailDetail extends EmailRow {
    fromAddress: string | null;
    bcc: string | null;
    replyTo: string | null;
    context: string | null;
    smtpMessageId: string | null;
    firstOpenIp: string | null;
    firstOpenUserAgent: string | null;
    clicks: Array<{ url: string; ts: string; ip: string | null; ua: string | null }>;
    opens: Array<{ ts: string; ip: string | null; ua: string | null }>;
}

@Component({
    selector: 'ees-email-log',
    standalone: false,
    template: `
        <vdr-page-block>
            <vdr-action-bar>
                <vdr-ab-left><h2>Email Log</h2></vdr-ab-left>
                <vdr-ab-right>
                    <button class="btn btn-link" (click)="load()" [disabled]="loading">
                        <clr-icon shape="refresh"></clr-icon> Refresh
                    </button>
                </vdr-ab-right>
            </vdr-action-bar>
        </vdr-page-block>

        <vdr-page-block *ngIf="updateBanner">
            <div class="update-banner" [class.major]="updateBanner.isMajor">
                <div>
                    <strong>📦 Update available</strong>
                    {{ updateBanner.packageName }} {{ updateBanner.current }} → <strong>{{ updateBanner.latest }}</strong>
                    <span *ngIf="updateBanner.isMajor" class="major-pill">major</span>
                </div>
                <div class="actions">
                    <a [href]="'https://github.com/exceeded/vendure-plugin-email-tracking/releases/tag/v' + updateBanner.latest" target="_blank" class="btn btn-sm btn-link">Release notes ↗</a>
                    <button class="btn btn-sm" (click)="dismissUpdate()">Dismiss</button>
                </div>
            </div>
        </vdr-page-block>

        <vdr-page-block>
            <div class="summary-row">
                <div class="summary-card" [class.active]="filterStatus===''" (click)="setStatus('')">
                    <div class="num" style="color:#1d4ed8">{{ totalAll() }}</div>
                    <div class="lbl">Last {{ summary.fromDays }} days</div>
                </div>
                <div class="summary-card" [class.active]="filterStatus==='sent'" (click)="setStatus('sent')">
                    <div class="num" style="color:#10b981">{{ summary.sent || 0 }}</div>
                    <div class="lbl">Sent</div>
                </div>
                <div class="summary-card" [class.active]="filterStatus==='failed'" (click)="setStatus('failed')">
                    <div class="num" style="color:#ef4444">{{ summary.failed || 0 }}</div>
                    <div class="lbl">Failed</div>
                </div>
                <div class="summary-card" [class.active]="filterStatus==='deferred'" (click)="setStatus('deferred')">
                    <div class="num" style="color:#f59e0b">{{ summary.deferred || 0 }}</div>
                    <div class="lbl">Deferred</div>
                </div>
                <div class="summary-card" [class.active]="filterStatus==='bounced'" (click)="setStatus('bounced')">
                    <div class="num" style="color:#9333ea">{{ summary.bounced || 0 }}</div>
                    <div class="lbl">Bounced</div>
                </div>
                <div class="summary-card">
                    <div class="num" style="color:#0369a1">{{ summary.opens || 0 }}</div>
                    <div class="lbl">Opens</div>
                    <div class="sub">{{ summary.clicks || 0 }} clicks</div>
                </div>
            </div>
        </vdr-page-block>

        <vdr-page-block>
            <div class="card">
                <div class="card-block">
                    <div class="filters">
                        <input class="form-input" placeholder="Filter recipient…" [(ngModel)]="filterRecipient" (keyup.enter)="load()">
                        <input class="form-input" placeholder="Filter type…" [(ngModel)]="filterType" (keyup.enter)="load()">
                        <input class="form-input" placeholder="Customer ID" [(ngModel)]="filterCustomerId" (keyup.enter)="load()">
                        <input class="form-input" placeholder="Order code" [(ngModel)]="filterOrderCode" (keyup.enter)="load()">
                        <button class="btn btn-secondary" (click)="load()">Apply</button>
                        <button class="btn btn-link" (click)="clearFilters()">Clear</button>
                    </div>

                    <div *ngIf="loading" style="padding:30px;text-align:center;color:var(--color-component-color-300)">Loading…</div>
                    <div *ngIf="!loading && rows.length === 0" style="padding:30px;text-align:center;color:var(--color-component-color-300)">
                        No emails match this view.
                    </div>

                    <table class="table table-compact" *ngIf="rows.length > 0">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Sent</th>
                                <th>Type</th>
                                <th>Recipient</th>
                                <th>Subject</th>
                                <th>Status</th>
                                <th>Opens</th>
                                <th>Clicks</th>
                                <th>Linked to</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <ng-container *ngFor="let r of rows">
                                <tr>
                                    <td><strong>#{{ r.id }}</strong></td>
                                    <td>{{ r.createdAt | date:'short' }}</td>
                                    <td><span class="pill type-pill">{{ r.type }}</span></td>
                                    <td>
                                        <a [href]="'mailto:' + r.recipient">{{ r.recipient }}</a>
                                    </td>
                                    <td style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" [title]="r.subject">{{ r.subject }}</td>
                                    <td>
                                        <span class="pill" [ngClass]="'status-' + r.status">{{ r.status }}</span>
                                    </td>
                                    <td>
                                        <span [class.muted]="r.openCount === 0" [style.color]="r.openCount > 0 ? '#10b981' : null">{{ r.openCount }}</span>
                                        <div class="help-text" *ngIf="r.firstOpenedAt">{{ r.firstOpenedAt | date:'short' }}</div>
                                    </td>
                                    <td>
                                        <span [class.muted]="r.clickCount === 0" [style.color]="r.clickCount > 0 ? '#0369a1' : null">{{ r.clickCount }}</span>
                                    </td>
                                    <td>
                                        <a *ngIf="r.orderId" [routerLink]="['/orders', r.orderId]">{{ r.orderCode || r.orderId }}</a>
                                        <a *ngIf="r.customerId && !r.orderId" [routerLink]="['/customers', r.customerId]">cust #{{ r.customerId }}</a>
                                        <span *ngIf="!r.orderId && !r.customerId" class="help-text">—</span>
                                    </td>
                                    <td>
                                        <button class="btn btn-sm btn-link" (click)="open(r.id)">
                                            <clr-icon shape="eye"></clr-icon> Details
                                        </button>
                                    </td>
                                </tr>
                                <tr *ngIf="expandedId === r.id && detail" class="detail-row">
                                    <td colspan="10">
                                        <div class="detail-grid">
                                            <div>
                                                <div class="lbl">From</div><div>{{ detail.fromAddress }}</div>
                                                <div class="lbl">To</div><div>{{ detail.recipient }}</div>
                                                <div class="lbl" *ngIf="detail.bcc">BCC</div><div *ngIf="detail.bcc">{{ detail.bcc }}</div>
                                                <div class="lbl">Subject</div><div>{{ detail.subject }}</div>
                                                <div class="lbl">Context</div><div>{{ detail.context || '—' }}</div>
                                            </div>
                                            <div>
                                                <div class="lbl">SMTP message id</div>
                                                <div style="font-family:monospace;font-size:11px;word-break:break-all">{{ detail.smtpMessageId || '—' }}</div>
                                                <div class="lbl">SMTP response</div>
                                                <div style="font-family:monospace;font-size:11px;word-break:break-all">{{ detail.smtpResponse || '—' }}</div>
                                                <div class="lbl" *ngIf="detail.errorMessage">Error</div>
                                                <div *ngIf="detail.errorMessage" style="color:#ef4444">{{ detail.errorMessage }}</div>
                                            </div>
                                            <div>
                                                <div class="lbl">Opens</div>
                                                <div>{{ detail.openCount }} ({{ detail.firstOpenedAt | date:'short' }} → {{ detail.lastOpenedAt | date:'short' }})</div>
                                                <div class="lbl" *ngIf="detail.firstOpenIp">First open IP</div>
                                                <div *ngIf="detail.firstOpenIp" style="font-family:monospace;font-size:11px">{{ detail.firstOpenIp }}</div>
                                                <div class="lbl" *ngIf="detail.firstOpenUserAgent">First open UA</div>
                                                <div *ngIf="detail.firstOpenUserAgent" style="font-size:11px;color:var(--color-component-color-300)">{{ detail.firstOpenUserAgent }}</div>
                                            </div>
                                        </div>
                                        <h5 style="margin-top:18px" *ngIf="detail.opens && detail.opens.length > 0">Open history ({{ detail.openCount }})</h5>
                                        <table class="table table-compact" *ngIf="detail.opens && detail.opens.length > 0">
                                            <thead><tr><th style="width:160px">Time</th><th style="width:140px">IP</th><th>User-Agent</th></tr></thead>
                                            <tbody>
                                                <tr *ngFor="let o of detail.opens">
                                                    <td>{{ o.ts | date:'medium' }}</td>
                                                    <td style="font-family:monospace;font-size:11px">{{ o.ip || '—' }}</td>
                                                    <td style="font-size:11px;color:var(--color-component-color-300)">{{ o.ua || '—' }}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                        <p *ngIf="detail.openCount > 50 && detail.opens && detail.opens.length === 50" class="help-text" style="margin:6px 0 0">
                                            Showing the most recent 50 opens. Older opens contribute to the open count above.
                                        </p>

                                        <h5 style="margin-top:18px" *ngIf="detail.clicks.length > 0">Click history ({{ detail.clickCount }})</h5>
                                        <table class="table table-compact" *ngIf="detail.clicks.length > 0">
                                            <thead><tr><th style="width:160px">Time</th><th>URL</th><th style="width:140px">IP</th><th>User-Agent</th></tr></thead>
                                            <tbody>
                                                <tr *ngFor="let c of detail.clicks">
                                                    <td>{{ c.ts | date:'medium' }}</td>
                                                    <td style="font-family:monospace;font-size:11px;word-break:break-all"><a [href]="c.url" target="_blank">{{ c.url }}</a></td>
                                                    <td style="font-family:monospace;font-size:11px">{{ c.ip || '—' }}</td>
                                                    <td style="font-size:11px;color:var(--color-component-color-300)">{{ c.ua || '—' }}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                        <p *ngIf="detail.clickCount > 50 && detail.clicks.length === 50" class="help-text" style="margin:6px 0 0">
                                            Showing the most recent 50 clicks. Older clicks contribute to the click count above.
                                        </p>
                                    </td>
                                </tr>
                            </ng-container>
                        </tbody>
                    </table>

                    <div class="pager" *ngIf="total > take">
                        <button class="btn btn-sm" (click)="prevPage()" [disabled]="skip === 0">‹ Prev</button>
                        <span style="margin:0 12px;font-size:12px">Showing {{ skip + 1 }}–{{ skip + rows.length }} of {{ total }}</span>
                        <button class="btn btn-sm" (click)="nextPage()" [disabled]="skip + take >= total">Next ›</button>
                    </div>
                </div>
            </div>
        </vdr-page-block>
    `,
    styles: [`
        :host { color: var(--color-text-100, inherit); }
        .summary-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
        .summary-card {
            flex: 1; min-width: 130px; padding: 14px 18px;
            border: 1px solid var(--color-component-border-200);
            border-radius: 6px;
            background: var(--color-component-bg-100);
            color: var(--color-text-100, inherit);
            cursor: pointer; transition: border-color .15s, box-shadow .15s;
        }
        .summary-card:hover { border-color: var(--color-primary-500, #1d4ed8); }
        .summary-card.active {
            border-color: var(--color-primary-500, #1d4ed8);
            box-shadow: 0 0 0 2px rgba(29,78,216,.18);
        }
        .summary-card .num { font-size: 24px; font-weight: 700; line-height: 1.2; }
        .summary-card .lbl { font-size: 11px; color: var(--color-component-color-300); margin-top: 2px; }
        .summary-card .sub { font-size: 10px; color: var(--color-component-color-300); margin-top: 2px; }

        .filters { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
        .filters .form-input {
            padding: 4px 8px; height: 32px;
            border: 1px solid var(--color-component-border-200);
            background: var(--color-component-bg-100);
            color: var(--color-text-100, inherit);
            border-radius: 4px; min-width: 160px;
        }

        .pill {
            display: inline-block; padding: 2px 8px; border-radius: 10px;
            font-size: 11px; font-weight: 600; text-transform: uppercase;
            color: #fff;
        }
        .type-pill {
            background: var(--color-component-bg-200);
            color: var(--color-text-100, inherit);
            border: 1px solid var(--color-component-border-200);
        }
        .status-sent { background: #10b981; }
        .status-failed { background: #ef4444; }
        .status-deferred { background: #f59e0b; }
        .status-bounced { background: #9333ea; }
        .status-complained { background: #db2777; }

        .detail-row > td {
            background: var(--color-component-bg-200);
            color: var(--color-text-100, inherit);
            padding: 18px;
            border-top: 1px solid var(--color-component-border-200);
        }
        .detail-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
        .detail-grid .lbl {
            font-size: 11px;
            color: var(--color-component-color-300);
            text-transform: uppercase; margin-top: 6px;
        }
        .pager {
            display: flex; align-items: center; justify-content: flex-end;
            padding: 10px 0;
            color: var(--color-text-100, inherit);
        }
        .help-text { color: var(--color-component-color-300); font-size: 11px; }
        .muted { color: var(--color-component-color-300); }

        .update-banner {
            display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap;
            padding: 12px 16px; border-radius: 8px;
            background: #ecfeff; border: 1px solid #67e8f9;
            color: #155e75; font-size: 13px;
        }
        .update-banner.major { background: #fef3c7; border-color: #fde68a; color: #92400e; }
        .update-banner strong { font-weight: 700; }
        .update-banner .major-pill { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 8px; background: #f59e0b; color: #fff; font-size: 10px; font-weight: 700; text-transform: uppercase; }
        .update-banner .actions { display: flex; gap: 8px; align-items: center; }

        /* Mobile under 768px */
        @media (max-width: 767px) {
            .summary-row { gap: 8px; }
            .summary-card { min-width: 0; flex-basis: calc(50% - 4px); padding: 10px 12px; }
            .summary-card .num { font-size: 20px; }
            .filters { flex-direction: column; gap: 6px; }
            .filters .form-input { width: 100%; min-width: 0; }
            .filters .btn { width: 100%; min-height: 44px; }

            /* Tables stay tabular but scroll horizontally inside the card */
            .card-block { padding: 12px; }
            .card-block > table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; white-space: nowrap; }
            .card-block > table th, .card-block > table td { padding: 8px 10px; }
            .detail-row > td { padding: 12px; display: block; }
            .detail-grid { grid-template-columns: 1fr; gap: 10px; }
            .update-banner { flex-direction: column; align-items: flex-start; }
            .update-banner .actions { width: 100%; justify-content: flex-end; }
            .pager { justify-content: center; }
        }
    `],
})
export class EmailLogComponent implements OnInit {
    rows: EmailRow[] = [];
    total = 0;
    take = 100;
    skip = 0;
    loading = false;

    filterStatus = '';
    filterRecipient = '';
    filterType = '';
    filterCustomerId = '';
    filterOrderCode = '';
    /** When the page is mounted with a ?customerId= query param, lock to that
     *  customer (used by the per-customer Emails tab). */
    lockedCustomerId: string | null = null;

    summary: any = { sent: 0, failed: 0, deferred: 0, bounced: 0, opens: 0, clicks: 0, fromDays: 30 };

    expandedId: number | null = null;
    detail: EmailDetail | null = null;

    updateBanner: { packageName: string; current: string; latest: string; isMajor: boolean } | null = null;
    private dismissKey = 'huloglobal-email-tracking-update-dismissed';

    constructor(
        private http: HttpClient,
        private notify: NotificationService,
        private route: ActivatedRoute,
        private cdr: ChangeDetectorRef,
    ) {}

    ngOnInit() {
        const cId = this.route.snapshot.queryParamMap.get('customerId');
        if (cId) {
            this.lockedCustomerId = cId;
            this.filterCustomerId = cId;
        }
        const oCode = this.route.snapshot.queryParamMap.get('orderCode');
        if (oCode) this.filterOrderCode = oCode;
        this.load();
        this.loadStatus();
    }

    loadStatus() {
        this.http.get<any>('/email-track/status').subscribe({
            next: (s) => {
                const u = s?.update;
                if (!u?.updateAvailable || !u.latest) return;
                let dismissed = '';
                try { dismissed = localStorage.getItem(this.dismissKey) || ''; } catch {}
                if (dismissed === u.latest) return;
                this.updateBanner = { packageName: u.packageName, current: u.current, latest: u.latest, isMajor: !!u.isMajor };
                this.cdr.markForCheck();
            },
            error: () => { /* nice-to-have, don't break the page */ },
        });
    }

    dismissUpdate() {
        if (!this.updateBanner) return;
        try { localStorage.setItem(this.dismissKey, this.updateBanner.latest); } catch {}
        this.updateBanner = null;
    }

    totalAll(): number {
        return (this.summary.sent || 0) + (this.summary.failed || 0) + (this.summary.deferred || 0)
            + (this.summary.bounced || 0) + (this.summary.complained || 0);
    }

    setStatus(s: string) {
        this.filterStatus = s;
        this.skip = 0;
        this.load();
    }

    clearFilters() {
        this.filterStatus = '';
        this.filterRecipient = '';
        this.filterType = '';
        this.filterCustomerId = this.lockedCustomerId || '';
        this.filterOrderCode = '';
        this.skip = 0;
        this.load();
    }

    private buildParams(): string {
        const p: string[] = [`take=${this.take}`, `skip=${this.skip}`];
        if (this.filterStatus) p.push(`status=${encodeURIComponent(this.filterStatus)}`);
        if (this.filterRecipient) p.push(`recipient=${encodeURIComponent(this.filterRecipient)}`);
        if (this.filterType) p.push(`type=${encodeURIComponent(this.filterType)}`);
        if (this.filterCustomerId) p.push(`customerId=${encodeURIComponent(this.filterCustomerId)}`);
        if (this.filterOrderCode) p.push(`orderCode=${encodeURIComponent(this.filterOrderCode)}`);
        return p.join('&');
    }

    load() {
        this.loading = true;
        Promise.all([
            this.http.get<any>(`/email-track/log?${this.buildParams()}`).toPromise(),
            this.http.get<any>('/email-track/log/summary?fromDays=30').toPromise(),
        ]).then(([list, summary]) => {
            this.rows = list?.items || [];
            this.total = list?.total || 0;
            this.summary = summary || this.summary;
            this.loading = false;
            this.expandedId = null;
            this.detail = null;
            this.cdr.markForCheck();
        }).catch(() => {
            this.loading = false;
            this.notify.error('Failed to load email log');
        });
    }

    open(id: number) {
        if (this.expandedId === id) {
            this.expandedId = null;
            this.detail = null;
            return;
        }
        this.expandedId = id;
        this.detail = null;
        this.http.get<EmailDetail>(`/email-track/log/${id}`).subscribe({
            next: (d) => { this.detail = d; this.cdr.markForCheck(); },
            error: () => this.notify.error('Failed to load email detail'),
        });
    }

    nextPage() { this.skip += this.take; this.load(); }
    prevPage() { this.skip = Math.max(0, this.skip - this.take); this.load(); }
}
