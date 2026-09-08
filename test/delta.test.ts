import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { DeltaState } from '../src/state.js';

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
const { attachEnvelope, filterEventTypes, filterOnlyNew, findClosed } = await import('../src/delta.js');
const { fetchTenders } = await import('../src/fetchTenders.js');

const EMPTY_STATE: DeltaState = { entries: {}, lastRunAt: '' };

describe('attachEnvelope - cold run', () => {
    it('marks every record NEW_LISTING/is_new=true when the state is empty', async () => {
        fetchWithRetryMock.mockReset();
        fetchWithRetryMock.mockResolvedValueOnce(loadFixtureBuffer('licitaciones_organismo8.html'));

        const records = await fetchTenders({});
        expect(records).toHaveLength(54); // same real fixture table.test.ts uses

        const items = attachEnvelope(records, EMPTY_STATE);
        expect(items).toHaveLength(54);
        expect(items.every((item) => item.is_new && item.event_type === 'NEW_LISTING')).toBe(true);
    });
});

describe('attachEnvelope - STATUS_CHANGE / UNCHANGED', () => {
    it('classifies a known record_id with a different estado as STATUS_CHANGE, with previousEstado set', async () => {
        fetchWithRetryMock.mockReset();
        fetchWithRetryMock.mockResolvedValueOnce(loadFixtureBuffer('licitaciones_organismo8.html'));
        const records = await fetchTenders({});
        const target = records[0];
        const state: DeltaState = { entries: { [target.record_id]: { estado: 'a stale estado' } }, lastRunAt: '' };

        const items = attachEnvelope([target], state);
        expect(items[0].event_type).toBe('STATUS_CHANGE');
        expect(items[0].previousEstado).toBe('a stale estado');
        expect(items[0].is_new).toBe(false);
    });

    it('classifies a known record_id with the same estado as UNCHANGED - delivered only when onlyNew is off', async () => {
        fetchWithRetryMock.mockReset();
        fetchWithRetryMock.mockResolvedValueOnce(loadFixtureBuffer('licitaciones_organismo8.html'));
        const records = await fetchTenders({});
        const target = records[0];
        const state: DeltaState = { entries: { [target.record_id]: { estado: target.estado } }, lastRunAt: '' };

        const items = attachEnvelope([target], state);
        expect(items[0].event_type).toBe('UNCHANGED');
        expect(filterOnlyNew(items)).toHaveLength(0);
    });
});

describe('findClosed', () => {
    it('reports a previously-seen record_id absent from this run\'s fetch as CLOSED', () => {
        const state: DeltaState = {
            entries: { stillHere: { estado: 'Realizada' }, goneNow: { estado: 'Fracasada' } },
            lastRunAt: '',
        };
        const closed = findClosed(state, new Set(['stillHere']), '2026-09-08T00:00:00.000Z');
        expect(closed).toHaveLength(1);
        expect(closed[0].record_id).toBe('goneNow');
        expect(closed[0].event_type).toBe('CLOSED');
        expect(closed[0].estado).toBe('Fracasada'); // last-known estado, carried through
    });

    it('reports nothing closed when every previously-seen id is still present', () => {
        const state: DeltaState = { entries: { a: { estado: 'Realizada' } }, lastRunAt: '' };
        expect(findClosed(state, new Set(['a']), '2026-09-08T00:00:00.000Z')).toHaveLength(0);
    });
});

describe('filterEventTypes', () => {
    it('restricts to the requested subset, always keeping UNCHANGED items available for onlyNew to decide on', () => {
        const items = [
            { event_type: 'NEW_LISTING' } as never,
            { event_type: 'STATUS_CHANGE' } as never,
            { event_type: 'UNCHANGED' } as never,
        ];
        const filtered = filterEventTypes(items, ['STATUS_CHANGE']);
        expect(filtered.map((i) => i.event_type)).toEqual(['STATUS_CHANGE', 'UNCHANGED']);
    });

    it('returns everything unchanged when eventTypes is not set', () => {
        const items = [{ event_type: 'NEW_LISTING' } as never];
        expect(filterEventTypes(items, undefined)).toEqual(items);
    });
});

describe('onlyNew - safe post-filter, not early-stop pagination', () => {
    it('fetches the ENTIRE backlog even when every id is already seen+unchanged, then filters to zero afterward', async () => {
        fetchWithRetryMock.mockReset();
        fetchWithRetryMock.mockResolvedValueOnce(loadFixtureBuffer('licitaciones_organismo8.html'));

        const records = await fetchTenders({});
        expect(records).toHaveLength(54);
        // This source is a single unpaginated POST (verified live - see
        // AGENTS.md), so there is nothing to "stop early" - one fetch call
        // is expected with or without onlyNew.
        expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);

        const entries = Object.fromEntries(records.map((r) => [r.record_id, { estado: r.estado }]));
        const items = attachEnvelope(records, { entries, lastRunAt: '' });
        expect(items.every((item) => item.event_type === 'UNCHANGED')).toBe(true);

        const filtered = filterOnlyNew(items);
        expect(filtered).toHaveLength(0);
        // Still exactly one fetch call: the full set was fetched first and
        // filtered afterward, not cut short by the state.
        expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
    });

    it('a partially-seen state returns only the genuinely-new records (not zero, not everything)', async () => {
        fetchWithRetryMock.mockReset();
        fetchWithRetryMock.mockResolvedValueOnce(loadFixtureBuffer('licitaciones_organismo8.html'));

        const records = await fetchTenders({});
        const entries = Object.fromEntries(records.slice(0, 40).map((r) => [r.record_id, { estado: r.estado }]));

        const items = attachEnvelope(records, { entries, lastRunAt: '' });
        const filtered = filterOnlyNew(items);

        expect(filtered).toHaveLength(14);
        expect(filtered.every((item) => item.is_new && item.event_type === 'NEW_LISTING')).toBe(true);
    });
});

describe('applyDateRangeFilter - documented no-op for this source (adapted honestly - see AGENTS.md)', () => {
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
