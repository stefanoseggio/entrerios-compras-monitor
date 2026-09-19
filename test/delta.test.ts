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
const { attachEnvelope, filterEventTypes, filterOnlyNew, findClosed, isSuspectedFetchFailure, isUnfilteredInput } = await import(
    '../src/delta.js'
);
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

describe('isSuspectedFetchFailure - guards findClosed against a fetch that only LOOKS like a real empty backlog', () => {
    it('THE BUG: flags the exact scenario that used to flood false CLOSED events - a big previously-tracked backlog and a fetch that came back with nothing', () => {
        // Simulates the real ~5505-row unfiltered backlog (see AGENTS.md) all being tracked from
        // prior runs, then one run's fetch technically "succeeding" (no thrown error) while
        // actually returning 0 rows - e.g. a bot-check page, a dropped session, or the
        // documented GET-with-querystring empty-state shape returned by mistake (both real
        // fixtures - licitaciones_vacio.html and licitaciones_get_trampa.html - are the SAME
        // ~9.4KB "no hay informacion" shell with nothing that structurally tells them apart).
        // Before this guard existed, this exact shape flowed straight into findClosed and
        // reported all 5505 previously-tracked ids as CLOSED in one run.
        const entries = Object.fromEntries(Array.from({ length: 5505 }, (_, i) => [`id${i}`, { estado: 'Realizada' }]));
        expect(isSuspectedFetchFailure(Object.keys(entries).length, 0)).toBe(true);
    });

    it('also flags a dramatic-but-not-total drop with no plausible real-world explanation', () => {
        // 5505 previously tracked, fetch returns only 12 this run (~0.2%) - far below the 10%
        // floor. A real government tender register does not empty out by 99.8% between two runs
        // of the same daily schedule; this is a fetch/parse failure, not a real mass closure.
        expect(isSuspectedFetchFailure(5505, 12)).toBe(true);
    });

    it('does NOT flag a real, small day-to-day drop', () => {
        // 5505 previously tracked, fetch returns 5480 (a handful of genuine real-world
        // closures/updates) - comfortably above the 10% floor, must be trusted as real.
        expect(isSuspectedFetchFailure(5505, 5480)).toBe(false);
    });

    it('does not flag a genuinely healthy, fully-populated fetch (no regression on the real success path)', () => {
        expect(isSuspectedFetchFailure(5505, 5505)).toBe(false);
    });

    it('does not engage when there is no meaningful backlog on record yet (cold start / near-cold-start)', () => {
        // A tiny previous state is too noisy to reason about with a ratio - and in practice only
        // happens near cold start, where leaving a handful of ids untouched for one more run is
        // harmless either way.
        expect(isSuspectedFetchFailure(0, 0)).toBe(false);
        expect(isSuspectedFetchFailure(5, 0)).toBe(false);
        expect(isSuspectedFetchFailure(19, 0)).toBe(false);
    });

    it('DOES engage right at the documented floor of previously-tracked ids', () => {
        expect(isSuspectedFetchFailure(20, 1)).toBe(true); // 1 < 20*0.1=2
        expect(isSuspectedFetchFailure(20, 2)).toBe(false); // 2 is not < 2
    });
});

describe('findClosed + isSuspectedFetchFailure integration - the guard must run BEFORE findClosed', () => {
    it('confirms findClosed alone has no way to tell a real empty backlog apart from a failed fetch (why the guard is necessary)', () => {
        // This documents the actual root cause: findClosed only ever sees the fetched-id set, so
        // an empty set from a broken fetch is indistinguishable from an empty set because the
        // backlog genuinely closed out. Callers (main.ts) MUST consult isSuspectedFetchFailure
        // first and skip calling findClosed at all when it returns true - findClosed itself
        // cannot and should not guess.
        const entries = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`id${i}`, { estado: 'Realizada' }]));
        const state: DeltaState = { entries, lastRunAt: '' };

        expect(isSuspectedFetchFailure(Object.keys(entries).length, 0)).toBe(true);
        // Demonstrating what findClosed would still (correctly, by its own contract) do if a
        // caller ignored the guard and called it anyway - this is exactly the flood the guard
        // exists to prevent main.ts from acting on.
        const wouldBeClosed = findClosed(state, new Set(), '2026-09-19T00:00:00.000Z');
        expect(wouldBeClosed).toHaveLength(100);
    });
});

describe('isUnfilteredInput - gates whether CLOSED detection is safe (real bug found in cloud verification)', () => {
    it('is true when no filter fields are set', () => {
        expect(isUnfilteredInput({})).toBe(true);
        expect(isUnfilteredInput({ maxItems: 500, onlyNew: true })).toBe(true); // non-filter fields don't count
    });

    it('is false when any single filter field is set', () => {
        expect(isUnfilteredInput({ estado: '3' })).toBe(false);
        expect(isUnfilteredInput({ tipoLicitacion: '2' })).toBe(false);
        expect(isUnfilteredInput({ organismo: '8' })).toBe(false);
        expect(isUnfilteredInput({ anio: '2025' })).toBe(false);
        expect(isUnfilteredInput({ palabra: 'salud' })).toBe(false);
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
