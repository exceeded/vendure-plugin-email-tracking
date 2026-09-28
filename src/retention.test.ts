import { describe, expect, it, vi } from 'vitest';

// TypeORM entities need emitted decorator metadata, which the test transform does not produce.
vi.mock('./email-log.entity', () => ({ EmailLog: class EmailLog {} }));
vi.mock('./email-suppression.entity', () => ({ EmailSuppression: class EmailSuppression {} }));
import { batchedDelete, RETENTION_BATCH } from './email-tracking.service';

describe('batchedDelete', () => {
    it('loops in batches of RETENTION_BATCH until a short batch and reports the total', async () => {
        const sizes = [RETENTION_BATCH, RETENTION_BATCH, 1234];
        const calls: Array<{ sql: string; params: any[] }> = [];
        const db = {
            query: async (sql: string, params: any[]) => { calls.push({ sql, params }); return { affectedRows: sizes[calls.length - 1] ?? 0 }; },
        };
        const total = await batchedDelete(db, 'email_log', '`createdAt` < DATE_SUB(NOW(), INTERVAL ? DAY)', [365], 0);
        expect(total).toBe(RETENTION_BATCH * 2 + 1234);
        expect(calls).toHaveLength(3);
        expect(calls[0].params).toEqual([365]);
        expect(calls[0].sql).toContain(`ORDER BY id ASC LIMIT ${RETENTION_BATCH}`);
        expect(calls[0].sql).toMatch(/^DELETE FROM email_log WHERE id IN \(SELECT id FROM \(SELECT id FROM email_log WHERE/);
    });

    it('stops after one statement when nothing is left', async () => {
        let n = 0;
        const db = { query: async () => { n++; return { affectedRows: 0 }; } };
        expect(await batchedDelete(db, 'email_link', '`expiresAt` < NOW()', [], 0)).toBe(0);
        expect(n).toBe(1);
    });
});
