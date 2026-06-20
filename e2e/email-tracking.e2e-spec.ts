import { mergeConfig, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import * as path from 'path';
import { initialData } from '../../../e2e-shared/initial-data';
import { EmailLog } from '../src/email-log.entity';
import { EmailTrackingPlugin } from '../src/plugin';
import { EmailTrackingService } from '../src/email-tracking.service';

registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '__data__')));

const PORT = 3060;

describe('@huloglobal/vendure-plugin-email-tracking', () => {
    const config = mergeConfig(testConfig, {
        apiOptions: { port: PORT },
        plugins: [
            EmailTrackingPlugin.init({
                publicBaseUrl: `http://localhost:${PORT}`,
            }),
        ],
    });
    const { server } = createTestEnvironment(config);

    beforeAll(async () => {
        await server.init({ initialData, productsCsvPath: '', customerCount: 0 } as any);
    }, 60_000);

    afterAll(async () => {
        await server.destroy();
    });

    it('boots, exposes EmailTrackingService, and EmailLog table is queryable', async () => {
        const tracking = (server as any).app.get(EmailTrackingService);
        expect(tracking).toBeDefined();
        const conn: TransactionalConnection = (server as any).app.get(TransactionalConnection);
        const repo = conn.rawConnection.getRepository(EmailLog);
        const count = await repo.count();
        expect(count).toBe(0);
    });

    it('records an open and serves the 1×1 GIF', async () => {
        const conn: TransactionalConnection = (server as any).app.get(TransactionalConnection);
        const repo = conn.rawConnection.getRepository(EmailLog);
        const row = await repo.save(repo.create({
            type: 'test',
            recipient: 'a@b.test',
            subject: 'hi',
            fromAddress: 'from@test.local',
            status: 'sent',
            tracked: true,
            channelId: 1,
            openCount: 0,
            clickCount: 0,
        } as Partial<EmailLog>));

        const res = await fetch(`http://localhost:${PORT}/email-track/open/${row.id}.gif`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('image/gif');
        const body = Buffer.from(await res.arrayBuffer());
        expect(body.length).toBeGreaterThan(20);

        // recordOpen() is fire-and-forget from the controller, give it a moment.
        await new Promise(r => setTimeout(r, 150));
        const reloaded = await repo.findOne({ where: { id: row.id } });
        expect(reloaded?.openCount).toBe(1);

        // Open history (new in 0.2.0) — every pixel hit appends to opensJson.
        const opens = JSON.parse(reloaded?.opensJson || '[]');
        expect(opens.length).toBe(1);
        expect(opens[0].ts).toBeTruthy();
    });

    it('rejects click redirect to invalid url and accepts a valid one', async () => {
        const conn: TransactionalConnection = (server as any).app.get(TransactionalConnection);
        const repo = conn.rawConnection.getRepository(EmailLog);
        const row = await repo.save(repo.create({
            type: 'test', recipient: 'c@d.test', subject: 'click', fromAddress: 'from@test.local',
            status: 'sent', tracked: true, channelId: 1, openCount: 0, clickCount: 0,
        } as Partial<EmailLog>));

        const bad = await fetch(`http://localhost:${PORT}/email-track/click/${row.id}?u=javascript:alert(1)`);
        expect(bad.status).toBe(400);

        const good = await fetch(`http://localhost:${PORT}/email-track/click/${row.id}?u=${encodeURIComponent('https://example.com/p')}`, { redirect: 'manual' });
        expect([301, 302, 303, 307, 308]).toContain(good.status);
        expect(good.headers.get('location')).toBe('https://example.com/p');
    });
});
