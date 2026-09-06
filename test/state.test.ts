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

const { DELTA_STATE_STORE_NAME, MAX_SEEN_IDS, loadDeltaState, mergeSeenIds, saveDeltaState } =
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
        expect(state).toEqual({ seenIds: [], lastRunAt: '' });
    });

    it('round-trips a previously saved state', async () => {
        await saveDeltaState({ seenIds: ['a', 'b'], lastRunAt: '2026-09-01T00:00:00.000Z' });
        const state = await loadDeltaState();
        expect(state).toEqual({ seenIds: ['a', 'b'], lastRunAt: '2026-09-01T00:00:00.000Z' });
    });
});

describe('mergeSeenIds', () => {
    it('puts every id fetched this run first, in fetch order', () => {
        const merged = mergeSeenIds(['old1', 'old2'], ['new1', 'new2']);
        expect(merged).toEqual(['new1', 'new2', 'old1', 'old2']);
    });

    it('carries forward ids not re-seen this run, appended after the current run ids', () => {
        const merged = mergeSeenIds(['old1', 'old2'], ['new1']);
        expect(merged).toEqual(['new1', 'old1', 'old2']);
    });

    it('de-duplicates an id that is both in the previous state and re-seen this run', () => {
        const merged = mergeSeenIds(['a', 'b'], ['b', 'c']);
        expect(merged).toEqual(['b', 'c', 'a']);
    });

    it('de-duplicates ids appearing twice within the SAME run (real case: this source has ~22 pairs of byte-identical duplicate rows that hash to the same record_id - see AGENTS.md)', () => {
        const merged = mergeSeenIds(['old'], ['dup', 'dup', 'other']);
        expect(merged).toEqual(['dup', 'other', 'old']);
    });

    it('caps the result at MAX_SEEN_IDS', () => {
        const current = Array.from({ length: MAX_SEEN_IDS + 500 }, (_, i) => `id${i}`);
        const merged = mergeSeenIds([], current);
        expect(merged).toHaveLength(MAX_SEEN_IDS);
        expect(merged[0]).toBe('id0');
    });

    it('is sized comfortably above the real ~5505-row backlog (see AGENTS.md), unlike a generic "few thousand" cap', () => {
        expect(MAX_SEEN_IDS).toBeGreaterThan(5505);
    });
});
