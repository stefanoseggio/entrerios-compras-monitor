import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));

function loadFixtureBuffer(name: string): ArrayBuffer {
    const buffer = readFileSync(`${fixturesDir}/${name}`);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

// Mocks the network layer only (same pattern as the rest of this portfolio's
// delta-mode tests) - decodeWin1252 and parseTenders run for real against a
// real fixture, so this exercises the actual fetchTenders() pipeline without
// hitting the live site.
const fetchWithRetryMock = vi.fn();
vi.mock('../src/http.js', () => ({
    fetchWithRetry: (...args: unknown[]) => fetchWithRetryMock(...args),
}));

const { applyDateRangeFilter } = await import('../src/dateRangeFilter.js');
const { attachIsNew, filterOnlyNew } = await import('../src/delta.js');
const { fetchTenders } = await import('../src/fetchTenders.js');

describe('attachIsNew - cold run (test 5a from the retrofit spec)', () => {
    it('marks every record is_new=true when the seen-set is empty', async () => {
        fetchWithRetryMock.mockReset();
        fetchWithRetryMock.mockResolvedValueOnce(loadFixtureBuffer('licitaciones_organismo8.html'));

        const records = await fetchTenders({});
        expect(records).toHaveLength(54); // same real fixture table.test.ts uses

        const items = attachIsNew(records, new Set());
        expect(items).toHaveLength(54);
        expect(items.every((item) => item.is_new)).toBe(true);
    });
});

describe('onlyNew - safe post-filter, not early-stop pagination (test 5b from the retrofit spec)', () => {
    it('fetches the ENTIRE backlog even when every id is already seen, then filters to zero afterward', async () => {
        fetchWithRetryMock.mockReset();
        fetchWithRetryMock.mockResolvedValueOnce(loadFixtureBuffer('licitaciones_organismo8.html'));

        const records = await fetchTenders({});
        expect(records).toHaveLength(54);
        // This source is a single unpaginated POST (verified live - see
        // AGENTS.md), so there is nothing to "stop early" - one fetch call
        // is expected with or without onlyNew.
        expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);

        const fullySeenIds = new Set(records.map((r) => r.record_id));
        const items = attachIsNew(records, fullySeenIds);
        expect(items.every((item) => !item.is_new)).toBe(true);

        const filtered = filterOnlyNew(items);
        expect(filtered).toHaveLength(0);
        // Still exactly one fetch call: the full set was fetched first and
        // filtered afterward, not cut short by the seen-set.
        expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
    });

    it('a partially-seen state returns only the genuinely-unseen records (not zero, not everything)', async () => {
        fetchWithRetryMock.mockReset();
        fetchWithRetryMock.mockResolvedValueOnce(loadFixtureBuffer('licitaciones_organismo8.html'));

        const records = await fetchTenders({});
        const partiallySeenIds = new Set(records.slice(0, 40).map((r) => r.record_id));

        const items = attachIsNew(records, partiallySeenIds);
        const filtered = filterOnlyNew(items);

        expect(filtered).toHaveLength(14);
        expect(filtered.every((item) => item.is_new)).toBe(true);
    });
});

describe('applyDateRangeFilter - documented no-op for this source (test 5c, adapted honestly - see AGENTS.md)', () => {
    it('returns records unchanged when dateRange is not set', () => {
        const records = [{ a: 1 }, { a: 2 }];
        expect(applyDateRangeFilter(records, undefined)).toEqual(records);
        expect(applyDateRangeFilter(records, '')).toEqual(records);
    });

    it('ALSO returns records unchanged when dateRange IS set, because this source has no per-record date field to filter on', () => {
        // Not "excludes out-of-window records" - there is no natural date
        // field in this domain to test a window against at all (verified
        // live: the table's only columns are Procedimiento/Objeto/Destino/
        // Estado/Organismo, and there is no per-tender detail page either -
        // see AGENTS.md). The honest, disclosed behavior is a no-op rather
        // than a filter faked against an unrelated field like scraped_at or
        // anioProcedimiento.
        const records = [{ a: 1 }, { a: 2 }, { a: 3 }];
        for (const window of ['24h', '7d', '30d'] as const) {
            expect(applyDateRangeFilter(records, window)).toEqual(records);
        }
    });
});
