import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeData = new Map<string, unknown>();

vi.mock('apify', () => ({
    Actor: {
        openKeyValueStore: vi.fn(async () => ({
            getValue: vi.fn(async (key: string) => storeData.get(key) ?? null),
            setValue: vi.fn(async (key: string, value: unknown) => {
                storeData.set(key, value);
            }),
        })),
    },
}));

const { DELTA_STATE_STORE_NAME, MAX_SEEN_IDS, loadDeltaState, mergeSeenEntries, saveDeltaState } =
    await import('../src/state.js');

beforeEach(() => {
    storeData.clear();
});

describe('DELTA_STATE_STORE_NAME', () => {
    it('is a fixed, actor-specific name - NOT the run default key-value store', () => {
        expect(DELTA_STATE_STORE_NAME).toBe('entrerios-compras-monitor-delta-state');
    });
});

describe('loadDeltaState', () => {
    it('returns an empty cold state when nothing has been persisted yet (first-ever run)', async () => {
        const state = await loadDeltaState();
        expect(state).toEqual({ entries: {}, lastRunAt: '' });
    });

    it('round-trips a previously saved state', async () => {
        const saved = { entries: { a: { estado: 'Realizada' }, b: { estado: 'Fracasada' } }, lastRunAt: '2026-09-01T00:00:00.000Z' };
        await saveDeltaState(saved);
        const state = await loadDeltaState();
        expect(state).toEqual(saved);
    });

    it('treats a v1-shaped state ({ seenIds: [...] }) as absent rather than crashing', async () => {
        storeData.set('STATE', { seenIds: ['a', 'b'], lastRunAt: 'x' });
        const state = await loadDeltaState();
        expect(state).toEqual({ entries: {}, lastRunAt: '' });
    });
});

describe('mergeSeenEntries', () => {
    it('puts every id fetched this run first, in fetch order, with its current estado', () => {
        const merged = mergeSeenEntries(
            { old1: { estado: 'Realizada' }, old2: { estado: 'Fracasada' } },
            [
                { id: 'new1', estado: 'En proceso de Evaluación' },
                { id: 'new2', estado: 'Realizada' },
            ],
        );
        expect(Object.keys(merged)).toEqual(['new1', 'new2', 'old1', 'old2']);
        expect(merged.new1).toEqual({ estado: 'En proceso de Evaluación' });
    });

    it('carries forward entries not re-seen this run, appended after the current run ids', () => {
        const merged = mergeSeenEntries({ old1: { estado: 'Realizada' }, old2: { estado: 'Fracasada' } }, [{ id: 'new1', estado: 'Realizada' }]);
        expect(Object.keys(merged)).toEqual(['new1', 'old1', 'old2']);
    });

    it('overwrites an existing id with its new estado (a real status change) when re-seen this run', () => {
        const merged = mergeSeenEntries({ a: { estado: 'Realizada' } }, [{ id: 'a', estado: 'Fracasada' }]);
        expect(merged.a).toEqual({ estado: 'Fracasada' });
    });

    it('de-duplicates ids appearing twice within the SAME run (real case: this source has ~22 pairs of byte-identical duplicate rows that hash to the same record_id - see AGENTS.md)', () => {
        const merged = mergeSeenEntries({ old: { estado: 'Realizada' } }, [
            { id: 'dup', estado: 'Realizada' },
            { id: 'dup', estado: 'Realizada' },
            { id: 'other', estado: 'Fracasada' },
        ]);
        expect(Object.keys(merged)).toEqual(['dup', 'other', 'old']);
    });

    it('caps the result at MAX_SEEN_IDS', () => {
        const current = Array.from({ length: MAX_SEEN_IDS + 500 }, (_, i) => ({ id: `id${i}`, estado: 'Realizada' }));
        const merged = mergeSeenEntries({}, current);
        expect(Object.keys(merged)).toHaveLength(MAX_SEEN_IDS);
        expect(merged.id0).toBeDefined();
    });

    it('is sized comfortably above the real ~5505-row backlog (see AGENTS.md), unlike a generic "few thousand" cap', () => {
        expect(MAX_SEEN_IDS).toBeGreaterThan(5505);
    });
});
