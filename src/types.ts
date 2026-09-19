/** Raw filter values as accepted by the actor input and by the site's own POST form. */
export type EstadoCode = '' | '1' | '2' | '3' | '4';
export type TipoLicitacionCode = '' | '1' | '2' | '3' | '4';
export type OrganismoCode = '' | '1' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

/** `""` (default) disables the filter - see AGENTS.md: this source publishes
 * no per-record date field at all, so this filter is a documented no-op for
 * this particular actor (kept for input-shape consistency with the rest of
 * the portfolio's monitor actors). */
export type DateRangeCode = '' | '24h' | '7d' | '30d';

/**
 * NEW_LISTING: record_id never seen before. STATUS_CHANGE: record_id seen before, `estado`
 * differs from last time - a real, free-to-detect lifecycle transition, since record_id's own
 * hash deliberately EXCLUDES estado (see TenderRecord.record_id doc comment), so a status
 * change never produces a different id the way a content change would. UNCHANGED: seen before,
 * same estado - only ever produced on a full (onlyNew=false) run. CLOSED: a previously-seen
 * record_id absent from this run's fetch - always trustworthy here (unlike sibling actors on
 * paginated sources): a single POST always returns the ENTIRE backlog, so there is no
 * maxItems-truncation risk to gate on. There is deliberately no UPDATED: any change to
 * procedimiento/objeto/destino/organismo produces a genuinely different record_id by
 * construction (those 4 fields ARE the hash), which is indistinguishable from a new listing
 * without a real source-issued id to correlate old and new rows - see AGENTS.md "Delta engine v2".
 */
export type EventType = 'NEW_LISTING' | 'STATUS_CHANGE' | 'UNCHANGED' | 'CLOSED';

export interface ActorInput {
    estado?: EstadoCode;
    tipoLicitacion?: TipoLicitacionCode;
    anio?: string;
    organismo?: OrganismoCode;
    palabra?: string;
    maxItems?: number;
    /** Delta mode: return only tenders that are new, status-changed or closed since a prior
     * run of this actor (state persisted in a named key-value store scoped to this actor - see
     * src/state.ts). Because this source is fetched as a single unpaginated POST covering the
     * whole backlog (not genuinely, reliably sorted newest-first - verified live, see
     * AGENTS.md), enabling this does NOT make the run cheaper or faster: the full backlog is
     * still fetched every time, exactly as without this flag, and filtering happens afterward. */
    onlyNew?: boolean;
    /** Which event types to deliver when onlyNew=true. Ignored (everything delivered) when onlyNew=false. */
    eventTypes?: Exclude<EventType, 'UNCHANGED'>[];
    /** Filters results to a natural per-record date field, when a monitor
     * actor's source has one. THIS actor's source does not (verified live -
     * see AGENTS.md), so setting this has no effect on the returned records;
     * a warning is logged instead of silently applying a misleading filter. */
    dateRange?: DateRangeCode;
}

/**
 * One row of the results table (`#tabla-resultados`), normalized - exactly what the pure
 * parser can produce without any cross-run state. `event_type`/`previousEstado`/`is_new` are
 * layered on afterward in src/delta.ts, once the persisted seen-set is available - see
 * TenderRecord below.
 */
export interface ParsedTenderRow {
    /** Stable id derived from the 4 content fields (the site has no native
     * row id - see AGENTS.md for why this doubles as `record_id` even though
     * it is a content hash rather than a source-issued id). Deliberately
     * excludes `estado`, so the same real-world procedure keeps the same id
     * across its lifecycle (e.g. "En proceso de Evaluación" -> "Realizada")
     * instead of looking like a brand-new record every time its status
     * changes.
     *
     * WARNING - disclosed, accepted risk (see AGENTS.md "Delta engine v2" ->
     * "Undisclosed-until-2026-09-19 sharper consequence" and README "Known
     * limitations"): because this hash covers `procedimiento`/`objeto`/
     * `destino`/`organismo` (free text, not a source-issued id), a silent
     * upstream correction to any of those 4 fields changes `record_id` and
     * is reported as a false CLOSED (old id) + NEW_LISTING (new id) pair on
     * the next unfiltered run for a procurement that never actually closed -
     * not merely "looks like a new listing". Narrowing the hash was
     * considered and rejected for this pass: `SeenEntry` (src/state.ts)
     * doesn't retain the raw text a persisted id's hash was built from, so
     * there is no safe migration path off the current fields without
     * triggering this exact failure across the entire tracked backlog. */
    record_id: string;
    /** Raw "Procedimiento de Contratación" cell, e.g. "Solicitud De Cotizacion 54/2025". Kept as free text - see AGENTS.md for why it is not split into tipo/numero/anio. */
    procedimiento: string;
    /** Trailing year extracted from `procedimiento` (last `/NNNN` segment), or null if the row didn't match that pattern. */
    anioProcedimiento: string | null;
    objeto: string;
    destino: string;
    organismo: string;
    /** Normalized status label - see AGENTS.md for the source-side encoding corruption this corrects. */
    estado: string;
    /** ISO-8601 timestamp of this run's extraction - identical for every record pushed by one run. */
    scraped_at: string;
    /** The shared search-listing URL (see src/constants.ts) - this source has no per-tender detail link to give instead. */
    source_url: string;
}

/** `ParsedTenderRow` plus the state-derived envelope fields - see src/delta.ts's `classify`. */
export interface TenderRecord extends ParsedTenderRow {
    /** NEW_LISTING / STATUS_CHANGE / UNCHANGED / CLOSED - see EventType doc comment and AGENTS.md "Delta engine v2". */
    event_type: EventType;
    /** Set only for event_type=STATUS_CHANGE: the estado this record_id was last seen under. */
    previousEstado: string | null;
}

/**
 * `TenderRecord` plus the one field that requires persisted cross-run state
 * and therefore cannot come out of the pure parser: `is_new`. This is the
 * actual shape pushed to the dataset - see src/delta.ts.
 */
export interface DatasetItem extends TenderRecord {
    /** True if `record_id` was NOT in the persisted seen-set when this run started. Computed and set correctly even when `onlyNew` is false/unset. */
    is_new: boolean;
}
