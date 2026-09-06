import type { DatasetItem, TenderRecord } from './types.js';

/**
 * Attaches `is_new` to every parsed record by checking `record_id` against
 * the seen-set persisted from prior runs. Pure - takes the seen-set as a
 * plain argument rather than reading it from storage itself - so it is
 * computed correctly regardless of whether `onlyNew` is enabled this run
 * (a full, non-delta run still tells the consumer which of its results
 * happen to be new).
 */
export function attachIsNew(records: readonly TenderRecord[], previouslySeenIds: ReadonlySet<string>): DatasetItem[] {
    return records.map((record) => ({
        ...record,
        is_new: !previouslySeenIds.has(record.record_id),
    }));
}

/**
 * Delta-mode post-filter: keeps only records not seen in a prior run.
 *
 * This is a SAFE POST-FILTER, not page-level early-stop pagination - see
 * AGENTS.md for the live evidence behind that choice (this source has no
 * pagination at all - one POST returns the entire backlog - and the one
 * full-backlog capture inspected was empirically closer to oldest-first than
 * newest-first, so short-circuiting on "already seen" would have been
 * actively wrong even if this source were paginated). The full backlog is
 * always fetched first, exactly as without `onlyNew`; this function only
 * decides what gets pushed to the dataset afterward.
 */
export function filterOnlyNew(items: readonly DatasetItem[]): DatasetItem[] {
    return items.filter((item) => item.is_new);
}
