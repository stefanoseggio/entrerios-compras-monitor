import { TARGET_URL } from './constants.js';
import type { DeltaState, SeenEntry } from './state.js';
import type { ActorInput, DatasetItem, EventType, ParsedTenderRow, TenderRecord } from './types.js';

/**
 * True only when none of the search-form filters are set. CLOSED detection (see findClosed
 * below) is safe to compute ONLY against a fetch this returns true for - a filtered run's
 * fetch is a SUBSET of the register, not the whole thing, so a previously-seen id absent from
 * it may simply be outside this run's filter, not actually gone. Confirmed live during
 * verification: a run narrowed to estado=3 after an unfiltered run wrongly reported 37 records
 * from other estados as CLOSED before this check existed - see AGENTS.md "Delta engine v2".
 */
export function isUnfilteredInput(input: ActorInput): boolean {
    return !input.estado && !input.tipoLicitacion && !input.organismo && !input.anio && !input.palabra;
}

function classify(previous: SeenEntry | undefined, row: ParsedTenderRow): { eventType: EventType; previousEstado: string | null } {
    if (!previous) return { eventType: 'NEW_LISTING', previousEstado: null };
    if (previous.estado !== row.estado) return { eventType: 'STATUS_CHANGE', previousEstado: previous.estado };
    return { eventType: 'UNCHANGED', previousEstado: null };
}

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
export function attachEnvelope(rows: readonly ParsedTenderRow[], state: DeltaState): DatasetItem[] {
    return rows.map((row) => {
        const previous = state.entries[row.record_id];
        const { eventType, previousEstado } = classify(previous, row);
        return { ...row, event_type: eventType, previousEstado, is_new: !previous };
    });
}

/**
 * Below this many previously-tracked ids, a row-count comparison is too noisy to mean anything
 * (a handful of ids can legitimately shrink a lot in one day) - the guard only engages once
 * there is a real backlog on record to compare against. This source's real unfiltered backlog
 * is ~5505 rows (see AGENTS.md), so 20 is a low floor that only matters near cold start, where a
 * false trigger is harmless (it just leaves a handful of ids untouched for one extra run).
 */
export const SUSPECTED_FETCH_FAILURE_MIN_PREVIOUS = 20;

/**
 * An unfiltered fetch must return at least this fraction of the previously-tracked id count to
 * be trusted. Sized against the real, verified shape of this backlog (see AGENTS.md "Delta
 * engine v2"): it is a live government tender register split across 4 estados, none of which
 * plausibly empties out by 90%+ between two runs of the same schedule. A drop that steep has
 * only ever been observed here as a fetch/parse failure, not a real event in the domain -
 * see `isSuspectedFetchFailure`.
 */
export const SUSPECTED_FETCH_FAILURE_MIN_RATIO = 0.1;

/**
 * Guards `findClosed` against the one input it cannot tell apart from a real mass closure: a
 * technically-successful fetch (HTTP 200, no thrown error) that comes back empty or
 * near-empty for reasons that have nothing to do with the register actually shrinking - a
 * bot-check/interstitial page, the documented GET-with-querystring trap shape returned by
 * mistake (see `fetchTenders.ts` and the `licitaciones_get_trampa.html`/`licitaciones_vacio.html`
 * fixtures - both are the SAME ~9.4KB "no hay informacion" shell with no structural marker that
 * tells them apart from each other or from a real narrow-filter zero-result page), a dropped
 * session, or an unannounced markup change under `#tabla-resultados` that `parseTenders` quietly
 * reads as "no rows" (src/parsers/table.ts) rather than failing loudly.
 *
 * `findClosed` has no way to see any of that - it only ever sees `fetchedIds`, a set that looks
 * identical whether it is empty because the backlog genuinely emptied out or because the fetch
 * silently came back with garbage. This function is the sanity check that must run BEFORE
 * `findClosed` on an unfiltered run: it compares this run's fetched row count against the
 * previously-tracked id count and flags a suspected fetch failure when the drop is too steep to
 * be a real event in this domain (see the constants above). The caller (main.ts) must then skip
 * `findClosed` entirely and leave the previously-tracked ids untouched in state, rather than
 * closing them out - a real, non-transient closure will still be caught correctly on a future
 * run whose fetch actually succeeds.
 */
export function isSuspectedFetchFailure(previousTrackedCount: number, fetchedCount: number): boolean {
    if (previousTrackedCount < SUSPECTED_FETCH_FAILURE_MIN_PREVIOUS) return false;
    return fetchedCount < previousTrackedCount * SUSPECTED_FETCH_FAILURE_MIN_RATIO;
}

/**
 * A previously-seen record_id absent from THIS run's fetch has left the live backlog. Unlike
 * sibling actors on paginated sources, this is always trustworthy here: a single POST always
 * returns the entire backlog (no pagination, see AGENTS.md), so "absent from the fetch" can
 * never be an artifact of a maxItems-truncated walk - there is no such truncation at the fetch
 * level (maxItems only bounds what gets PUSHED, in main.ts, after this point).
 *
 * That said, "always trustworthy" assumes the fetch itself is trustworthy - it says nothing
 * about a fetch that merely LOOKS like it returned the whole (now-empty) backlog when it
 * actually failed silently. Callers MUST check `isSuspectedFetchFailure` first and skip this
 * function entirely when it returns true - see its doc comment.
 */
export function findClosed(state: DeltaState, fetchedIds: ReadonlySet<string>, scrapedAt: string): TenderRecord[] {
    const closed: TenderRecord[] = [];
    for (const [recordId, entry] of Object.entries(state.entries)) {
        if (fetchedIds.has(recordId)) continue;
        closed.push({
            record_id: recordId,
            procedimiento: '',
            anioProcedimiento: null,
            objeto: '',
            destino: '',
            organismo: '',
            estado: entry.estado,
            event_type: 'CLOSED',
            previousEstado: null,
            scraped_at: scrapedAt,
            source_url: TARGET_URL,
        });
    }
    return closed;
}

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
export function filterOnlyNew(items: readonly DatasetItem[]): DatasetItem[] {
    return items.filter((item) => item.event_type !== 'UNCHANGED');
}

export function filterEventTypes(items: readonly DatasetItem[], eventTypes: readonly EventType[] | undefined): DatasetItem[] {
    if (!eventTypes) return items.slice();
    const allowed = new Set(eventTypes);
    return items.filter((item) => item.event_type === 'UNCHANGED' || allowed.has(item.event_type));
}
