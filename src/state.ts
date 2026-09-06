import { Actor } from 'apify';

/**
 * Fixed, unique-to-this-actor key-value store name. Deliberately NOT the
 * run's default key-value store (`Actor.setValue`/`Actor.getValue` without a
 * store name) - that store is isolated per run and is wiped/replaced on
 * every scheduled run, so it cannot carry state between runs. A named store
 * opened via `Actor.openKeyValueStore` persists across runs and across the
 * run's own retention.
 */
export const DELTA_STATE_STORE_NAME = 'entrerios-compras-monitor-delta-state';
const DELTA_STATE_KEY = 'STATE';

/**
 * Cap on how many ids we persist. The literal Delta Engine spec says "a few
 * thousand", sized for a genuinely paginated, newest-first source where each
 * run only ever sees a bounded recent window and older ids simply never
 * reappear once evicted. This actor is NOT that shape (verified live, see
 * AGENTS.md): a single blank-`estado` POST returns the ENTIRE backlog -
 * currently ~5505 rows - every single run, with no pagination at all.
 * Capping at "a few thousand" here would silently evict real, still-active
 * ids below the cap and make them spuriously reappear as `is_new: true`
 * forever, defeating the point of delta mode. 10,000 is sized to stay
 * comfortably above the current ~5505-row backlog with headroom for years
 * of organic growth - a deliberate, disclosed deviation from the literal
 * spec value, driven by this actor's own architecture.
 */
export const MAX_SEEN_IDS = 10_000;

export interface DeltaState {
    seenIds: string[];
    lastRunAt: string;
}

function emptyState(): DeltaState {
    return { seenIds: [], lastRunAt: '' };
}

export async function loadDeltaState(): Promise<DeltaState> {
    const store = await Actor.openKeyValueStore(DELTA_STATE_STORE_NAME);
    const state = await store.getValue<DeltaState>(DELTA_STATE_KEY);
    if (!state || !Array.isArray(state.seenIds)) return emptyState();
    return state;
}

export async function saveDeltaState(state: DeltaState): Promise<void> {
    const store = await Actor.openKeyValueStore(DELTA_STATE_STORE_NAME);
    await store.setValue(DELTA_STATE_KEY, state);
}

/**
 * Merges this run's fetched ids into the previously persisted seen-set, then
 * caps the result at `MAX_SEEN_IDS`. Pure function - no store access - so it
 * is directly unit-testable.
 *
 * This source publishes no per-record date, so there is no real "newest"
 * ordering to preserve (see AGENTS.md). As a disclosed, deliberate stand-in
 * for that recency signal: every id fetched THIS run is treated as
 * "just reconfirmed present in the live backlog" and moved to the front:
 * - ids from `currentRunIds` come first, in the order they were fetched.
 * - ids that were seen in a previous run but did NOT appear in this run's
 *   fetch (e.g. a transient fetch issue, or a row the source removed) keep
 *   their prior relative order and are appended after.
 * - the combined, de-duplicated list is truncated at `MAX_SEEN_IDS`.
 *
 * Because every run fetches the entire current backlog (no pagination),
 * every currently-active id gets refreshed to the front on every run, so
 * only ids that have been genuinely absent from the live backlog for a very
 * long stretch (long enough for `MAX_SEEN_IDS` other ids to be reconfirmed
 * ahead of them) are ever evicted.
 */
export function mergeSeenIds(previousSeenIds: readonly string[], currentRunIds: readonly string[]): string[] {
    const uniqueCurrent = [...new Set(currentRunIds)];
    const currentSet = new Set(uniqueCurrent);
    const carryOver = previousSeenIds.filter((id) => !currentSet.has(id));
    return [...uniqueCurrent, ...carryOver].slice(0, MAX_SEEN_IDS);
}
