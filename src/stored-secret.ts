import { LicenceStore, randomToken, SqlQueryFn } from '@huloglobal/vendure-licence-sdk';

/**
 * A per-install secret that is generated once and then shared by every
 * process of the install (server + worker) through the `hulo_licence_store`
 * key/value table the licence SDK already maintains.
 *
 * The first writer wins: the insert is `INSERT IGNORE`, so a server and a
 * worker booting at the same moment both end up reading the same row. When
 * the atomic insert is not possible the plain upsert is used and the value
 * is re-read afterwards. Returns `null` only when the table cannot be used
 * at all — callers then fall back to their legacy default.
 */
export async function ensureStoredSecret(store: LicenceStore, query: SqlQueryFn, key: string): Promise<string | null> {
    try {
        await store.ensureTable();
        const existing = await store.load(key);
        if (existing) return existing;
        const fresh = randomToken(32);
        try {
            await query(
                'INSERT IGNORE INTO hulo_licence_store (pluginId, licenceKey, updatedAt) VALUES (?, ?, NOW())',
                [key, fresh],
            );
        } catch {
            await store.save(key, fresh);
        }
        // Re-read so every process agrees on whichever value landed first.
        return (await store.load(key)) || null;
    } catch {
        return null;
    }
}
