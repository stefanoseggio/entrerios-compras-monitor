import type { DeltaState } from './state.js';
import type { DatasetItem, EventType, ParsedTenderRow, TenderRecord } from './types.js';
/**
 * Attaches the state-derived envelope (`event_type`, `previousEstado`, `is_new`) to every
 * parsed row by checking `record_id` against the persisted state. Pure - takes `state` as a
 * plain argument rather than reading it from storage itself - so it is computed correctly
 * regardless of whether `onlyNew` is enabled this run (a full, non-delta run still tells the
 * consumer exactly what's new, status-changed or unchanged).
 *
 * There is no UPDATED classification - see EventType's doc comment in types.ts: any change to
 * procedimiento/objeto/destino/organismo produces a genuinely different record_id by
 * construction, indistinguishable from a new listing without a real source-issued id.
 */
export declare function attachEnvelope(rows: readonly ParsedTenderRow[], state: DeltaState): DatasetItem[];
/**
 * A previously-seen record_id absent from THIS run's fetch has left the live backlog. Unlike
 * sibling actors on paginated sources, this is always trustworthy here: a single POST always
 * returns the entire backlog (no pagination, see AGENTS.md), so "absent from the fetch" can
 * never be an artifact of a maxItems-truncated walk - there is no such truncation at the fetch
 * level (maxItems only bounds what gets PUSHED, in main.ts, after this point).
 */
export declare function findClosed(state: DeltaState, fetchedIds: ReadonlySet<string>, scrapedAt: string): TenderRecord[];
/**
 * Delta-mode post-filter: keeps only records that are new, status-changed, or (always) closed.
 *
 * This is a SAFE POST-FILTER, not page-level early-stop pagination - see AGENTS.md for the
 * live evidence behind that choice (this source has no pagination at all - one POST returns
 * the entire backlog - and the one full-backlog capture inspected was empirically closer to
 * oldest-first than newest-first, so short-circuiting on "already seen" would have been
 * actively wrong even if this source were paginated). The full backlog is always fetched
 * first, exactly as without `onlyNew`; this function only decides what gets pushed afterward.
 */
export declare function filterOnlyNew(items: readonly DatasetItem[]): DatasetItem[];
export declare function filterEventTypes(items: readonly DatasetItem[], eventTypes: readonly EventType[] | undefined): DatasetItem[];
//# sourceMappingURL=delta.d.ts.map