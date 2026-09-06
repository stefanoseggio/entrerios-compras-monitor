/** Raw filter values as accepted by the actor input and by the site's own POST form. */
export type EstadoCode = '' | '1' | '2' | '3' | '4';
export type TipoLicitacionCode = '' | '1' | '2' | '3' | '4';
export type OrganismoCode = '' | '1' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

/** `""` (default) disables the filter - see AGENTS.md: this source publishes
 * no per-record date field at all, so this filter is a documented no-op for
 * this particular actor (kept for input-shape consistency with the rest of
 * the portfolio's monitor actors). */
export type DateRangeCode = '' | '24h' | '7d' | '30d';

export interface ActorInput {
    estado?: EstadoCode;
    tipoLicitacion?: TipoLicitacionCode;
    anio?: string;
    organismo?: OrganismoCode;
    palabra?: string;
    maxItems?: number;
    /** Delta mode: return only tenders not seen by a prior run of this actor
     * (state persisted in a named key-value store scoped to this actor - see
     * src/state.ts). Because this source is fetched as a single unpaginated
     * POST covering the whole backlog (not genuinely, reliably sorted
     * newest-first - verified live, see AGENTS.md), enabling this does NOT
     * make the run cheaper or faster: the full backlog is still fetched
     * every time, exactly as without this flag, and filtering happens
     * afterward. */
    onlyNew?: boolean;
    /** Filters results to a natural per-record date field, when a monitor
     * actor's source has one. THIS actor's source does not (verified live -
     * see AGENTS.md), so setting this has no effect on the returned records;
     * a warning is logged instead of silently applying a misleading filter. */
    dateRange?: DateRangeCode;
}

/** One row of the results table (`#tabla-resultados`), normalized. */
export interface TenderRecord {
    /** Stable id derived from the 4 content fields (the site has no native
     * row id - see AGENTS.md for why this doubles as `record_id` even though
     * it is a content hash rather than a source-issued id). Deliberately
     * excludes `estado`, so the same real-world procedure keeps the same id
     * across its lifecycle (e.g. "En proceso de Evaluación" -> "Realizada")
     * instead of looking like a brand-new record every time its status
     * changes. */
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
    /** Always `"NEW_LISTING"` for this actor - see src/constants.ts and AGENTS.md. */
    event_type: string;
    /** ISO-8601 timestamp of this run's extraction - identical for every record pushed by one run. */
    scraped_at: string;
    /** The shared search-listing URL (see src/constants.ts) - this source has no per-tender detail link to give instead. */
    source_url: string;
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
