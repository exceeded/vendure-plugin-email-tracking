/**
 * Postgres corpus test — every raw SQL statement in `src/**` is translated
 * by the licence-sdk dialect adapter and executed against a scratch
 * PostgreSQL database. Skipped unless `HULO_PG_URL` is set, e.g.
 *
 *   HULO_PG_URL=postgres://hulo_pg:hulo_pg_local@localhost:5432/hulo_et_pg npx vitest run
 *
 * The scratch database gets TypeORM-quoted stand-ins for `email_log`,
 * `email_link`, `email_suppression`, `customer`, `order`,
 * `order_channels_channel` and `channel`, plus the SDK's `hulo_licence_store`. Each statement
 * runs inside a rolled-back transaction, so the seed rows survive and the
 * run is idempotent. SELECTs must return rows with their camelCase aliases
 * intact (the adapter restores them from PG's lower-cased identifiers).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createDbAdapter, translateSql } from '@huloglobal/vendure-licence-sdk';

const PG_URL = process.env.HULO_PG_URL;

const DDL = [
    `DROP TABLE IF EXISTS email_log`,
    `DROP TABLE IF EXISTS email_link`,
    `DROP TABLE IF EXISTS email_suppression`,
    `DROP TABLE IF EXISTS customer`,
    `DROP TABLE IF EXISTS "order"`,
    `DROP TABLE IF EXISTS order_channels_channel`,
    `DROP TABLE IF EXISTS channel`,
    `DROP TABLE IF EXISTS hulo_licence_store`,
    `CREATE TABLE email_log (
        id SERIAL PRIMARY KEY,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        type VARCHAR(255) NOT NULL,
        recipient VARCHAR(255) NOT NULL,
        subject VARCHAR(512) NOT NULL,
        "fromAddress" VARCHAR(512),
        bcc VARCHAR(512),
        "replyTo" VARCHAR(512),
        context VARCHAR(255),
        "channelId" INTEGER NOT NULL DEFAULT 1,
        "customerId" INTEGER,
        "orderId" INTEGER,
        "orderCode" VARCHAR(255),
        "invoiceId" INTEGER,
        "applicationId" INTEGER,
        status VARCHAR(255) NOT NULL DEFAULT 'sent',
        "smtpResponse" VARCHAR(512),
        "smtpMessageId" VARCHAR(512),
        "errorMessage" TEXT,
        "openCount" INTEGER NOT NULL DEFAULT 0,
        "firstOpenedAt" TIMESTAMP,
        "lastOpenedAt" TIMESTAMP,
        "firstOpenIp" VARCHAR(255),
        "firstOpenUserAgent" TEXT,
        "opensJson" TEXT,
        "clickCount" INTEGER NOT NULL DEFAULT 0,
        "clicksJson" TEXT,
        "firstClickedAt" TIMESTAMP,
        tracked BOOLEAN NOT NULL DEFAULT TRUE
    )`,
    `CREATE TABLE email_link (
        id SERIAL PRIMARY KEY,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "emailLogId" INTEGER,
        "orderId" INTEGER,
        "invoiceId" INTEGER,
        "customerId" INTEGER,
        "supportTicketId" INTEGER,
        "linkToken" VARCHAR(64) NOT NULL UNIQUE,
        "linkIndex" INTEGER NOT NULL DEFAULT 0,
        "linkLabel" VARCHAR(255),
        "linkText" VARCHAR(512),
        "templateSection" VARCHAR(64),
        "linkType" VARCHAR(32) NOT NULL,
        "destinationUrlRedacted" TEXT,
        "destinationUrlHost" VARCHAR(255),
        "destinationUrlPath" VARCHAR(512),
        "destinationUrlHash" VARCHAR(64),
        "signedDestinationToken" VARCHAR(64),
        "isTrackingEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
        "isSensitive" BOOLEAN NOT NULL DEFAULT FALSE,
        "expiresAt" TIMESTAMP(3)
    )`,
    `CREATE TABLE email_suppression (
        id SERIAL PRIMARY KEY,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        recipient VARCHAR(320) NOT NULL UNIQUE,
        reason VARCHAR(32) NOT NULL,
        note TEXT,
        "channelId" INTEGER
    )`,
    `CREATE TABLE customer (
        id SERIAL PRIMARY KEY,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "deletedAt" TIMESTAMP,
        "emailAddress" VARCHAR(255) NOT NULL
    )`,
    `CREATE TABLE "order" (
        id SERIAL PRIMARY KEY,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        code VARCHAR(255) NOT NULL,
        "customerId" INTEGER
    )`,
    `CREATE TABLE order_channels_channel (
        "orderId" INTEGER NOT NULL,
        "channelId" INTEGER NOT NULL,
        PRIMARY KEY ("orderId", "channelId")
    )`,
    `CREATE TABLE channel (
        id SERIAL PRIMARY KEY,
        code VARCHAR(255) NOT NULL,
        token VARCHAR(255) NOT NULL
    )`,
    `CREATE TABLE hulo_licence_store (
        pluginid VARCHAR(128) PRIMARY KEY,
        licencekey TEXT NOT NULL,
        updatedat TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
];

const SEED = [
    `INSERT INTO email_log (type, recipient, subject, "channelId", "customerId", "orderId", "orderCode", status, "smtpMessageId", "openCount", "clickCount")
     VALUES ('order-confirmation', 'a@example.com', 'Order confirmation for #ABCDEFGHIJ12', 1, 1, 1, 'ABCDEFGHIJ12', 'sent', 'msg-1@example.com', 2, 1),
            ('password-reset', 'b@example.com', 'Reset your password', 2, NULL, NULL, NULL, 'bounced', 'msg-2@example.com', 0, 0)`,
    `INSERT INTO email_link ("emailLogId", "linkToken", "linkType", "destinationUrlHost", "expiresAt")
     VALUES (1, REPEAT('a', 64), 'order_view', 'shop.example.com', NOW() - INTERVAL '1 day')`,
    `INSERT INTO email_suppression (recipient, reason, note, "channelId") VALUES ('dead@example.com', 'hard-bounce', 'seed', 1)`,
    `INSERT INTO customer ("emailAddress") VALUES ('a@example.com')`,
    `INSERT INTO "order" (code, "customerId") VALUES ('ABCDEFGHIJ12', 1)`,
    `INSERT INTO order_channels_channel ("orderId", "channelId") VALUES (1, 1), (1, 2)`,
    `INSERT INTO channel (code, token) VALUES ('__default_channel__', '1'), ('second', '2')`,
    `INSERT INTO hulo_licence_store (pluginid, licencekey) VALUES ('vendure-plugin-email-tracking:signing-secret', 'secret')`,
];

/** Stand-in for a `${expr}` interpolation inside an SQL template literal. */
function standIn(expr: string): string {
    const e = expr.trim();
    if (/^(w|whereClause)$/.test(e)) return ' WHERE `customerId` = ? AND recipient LIKE ? AND `createdAt` >= ?';
    if (/^where$/.test(e)) return '`createdAt` < DATE_SUB(NOW(), INTERVAL ? DAY)';
    if (/^table$/.test(e)) return 'email_log';
    if (/RETENTION_BATCH/.test(e)) return '5000';
    if (/channelId/.test(e)) return ' AND `channelId` = ?';
    throw new Error(`pg-corpus: no stand-in for interpolation \${${e}} — add one to standIn()`);
}

/** Bind a plausible value for each `?`, judged from the SQL just before it. */
function paramsFor(sql: string): any[] {
    const out: any[] = [];
    let inSingle = false;
    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        if (ch === "'") inSingle = !inSingle;
        if (ch !== '?' || inSingle) continue;
        const before = sql.slice(Math.max(0, i - 48), i);
        if (/INTERVAL\s*$/i.test(before)) out.push(30);
        else if (/OFFSET\s*$/i.test(before)) out.push(0);
        else if (/LIMIT\s*$/i.test(before)) out.push(10);
        else if (/(At`?|NOW\(\))\s*(>=|>)\s*$/.test(before)) out.push(new Date('2000-01-01T00:00:00Z'));
        else if (/(At`?|NOW\(\))\s*(<=|<)\s*$/.test(before)) out.push(new Date('2100-01-01T00:00:00Z'));
        else if (/(At`?|NOW\(\))\s*(=|,)\s*$/.test(before)) out.push(new Date());
        else if (/LIKE\s*$/i.test(before)) out.push('%example%');
        else if (/(code|token|recipient|smtpMessageId`?|emailAddress`?\))\s*=\s*(LOWER\()?\s*$/i.test(before)) out.push('1');
        else out.push('1');
    }
    return out;
}

interface Stmt { file: string; sql: string; }

/** String literals (template, single- and double-quoted) in one TS source,
 *  found with a small scanner so escaped quotes and backticks inside other
 *  strings and comments cannot derail it (a regex does). Template literals
 *  keep their `${expr}` interpolations verbatim. */
function scanLiterals(src: string): string[] {
    const out: string[] = [];
    let i = 0;
    const n = src.length;
    const readQuoted = (q: string): string => {
        // src[i] === q
        let j = i + 1;
        let buf = '';
        while (j < n && src[j] !== q) {
            if (src[j] === '\\') { buf += src[j + 1] === q || src[j + 1] === '`' ? src[j + 1] : src[j] + src[j + 1]; j += 2; continue; }
            if (q !== '`' && src[j] === '\n') break;
            buf += src[j]; j++;
        }
        i = j + 1;
        return buf;
    };
    const readTemplate = (): string => {
        let j = i + 1;
        let buf = '';
        while (j < n && src[j] !== '`') {
            if (src[j] === '\\') { buf += src[j + 1] === '`' || src[j + 1] === '$' ? src[j + 1] : src[j] + src[j + 1]; j += 2; continue; }
            if (src[j] === '$' && src[j + 1] === '{') {
                // Copy the interpolation verbatim, skipping strings inside it.
                let depth = 1; let k = j + 2; let expr = '';
                while (k < n && depth > 0) {
                    const c = src[k];
                    if (c === "'" || c === '"') {
                        const q = c; let m = k + 1; let inner = '';
                        while (m < n && src[m] !== q) { if (src[m] === '\\') { inner += src[m + 1] === '`' ? '`' : src[m] + src[m + 1]; m += 2; continue; } inner += src[m]; m++; }
                        expr += q + inner + q; k = m + 1; continue;
                    }
                    if (c === '{') depth++;
                    if (c === '}') { depth--; if (depth === 0) { k++; break; } }
                    expr += c; k++;
                }
                buf += '${' + expr + '}';
                j = k; continue;
            }
            buf += src[j]; j++;
        }
        i = j + 1;
        return buf;
    };
    while (i < n) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
        if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
        if (c === "'" || c === '"') { out.push(readQuoted(c)); continue; }
        if (c === '`') { out.push(readTemplate()); continue; }
        i++;
    }
    return out;
}

/** Every string literal in src/**.ts that is a whole SQL statement. */
function extractCorpus(dir: string): Stmt[] {
    const out: Stmt[] = [];
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'));
    for (const f of files) {
        for (const lit of scanLiterals(fs.readFileSync(path.join(dir, f), 'utf8'))) {
            const trimmed = lit.trim();
            // A real statement, not a route path or a keyword quoted in a comment.
            if (!/^(SELECT\s+\S|INSERT\s+(IGNORE\s+)?INTO\s|UPDATE\s+\S+\s+SET\s|DELETE\s+FROM\s|CREATE\s+TABLE\s|ALTER\s+TABLE\s)/i.test(trimmed)) continue;
            const sql = trimmed.replace(/\$\{([^}]*)\}/g, (_all, expr) => standIn(expr));
            out.push({ file: f, sql });
        }
    }
    return out;
}

describe.skipIf(!PG_URL)('Postgres SQL corpus (HULO_PG_URL)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Client } = require('pg');
    const client = new Client({ connectionString: PG_URL });
    const raw = {
        options: { type: 'postgres' },
        query: async (sql: string, params?: any[]) => (await client.query(sql, params)).rows,
    };
    const adapter = createDbAdapter(raw);
    const corpus = extractCorpus(path.join(__dirname));

    beforeAll(async () => {
        await client.connect();
        for (const s of DDL) await client.query(s);
        for (const s of SEED) await client.query(s);
    }, 30_000);

    afterAll(async () => { await client.end(); });

    it('finds the statements', () => {
        expect(corpus.length).toBeGreaterThanOrEqual(14);
    });

    it('leaves no MySQL-ism behind after translation', () => {
        for (const { file, sql } of corpus) {
            const t = translateSql(sql, 'postgres');
            expect(t, `${file}: ${sql}`).not.toMatch(/`|\bDATE_SUB\b|\bDATE_ADD\b|INSERT\s+IGNORE|ON\s+DUPLICATE|\bIF\s*\(|GROUP_CONCAT|AUTO_INCREMENT|\bDATETIME\b/i);
            expect(t.replace(/'(?:[^']|'')*'/g, ''), `${file}: unnumbered placeholder in ${sql}`).not.toContain('?');
        }
    });

    it('executes every statement and keeps camelCase aliases on result rows', async () => {
        const failures: string[] = [];
        for (const { file, sql } of corpus) {
            const params = paramsFor(sql);
            const isRead = /^SELECT/i.test(sql);
            await client.query('BEGIN');
            try {
                const res = await adapter.query(sql, params, isRead ? undefined : { needAffected: true });
                if (isRead) {
                    expect(Array.isArray(res), `${file}: ${sql}`).toBe(true);
                    const aliases = Array.from(sql.matchAll(/\bAS\s+`?([A-Za-z_][A-Za-z0-9_]*)`?/g)).map(m => m[1]).filter(a => /[A-Z]/.test(a) && /[a-z]/.test(a));
                    for (const row of res as any[]) {
                        for (const a of aliases) expect(row, `${file}: alias ${a} lost in ${sql}`).toHaveProperty(a);
                    }
                    if (/^SELECT\s+id,\s+`createdAt`/i.test(sql) || /GROUP BY (status|type)/i.test(sql)) {
                        expect((res as any[]).length, `${file}: expected seed rows for ${sql}`).toBeGreaterThan(0);
                    }
                }
            } catch (e: any) {
                failures.push(`${file}: ${e?.message}\n    ${sql.replace(/\s+/g, ' ').slice(0, 220)}`);
            } finally {
                await client.query('ROLLBACK');
            }
        }
        expect(failures, failures.join('\n')).toEqual([]);
    }, 60_000);
});
