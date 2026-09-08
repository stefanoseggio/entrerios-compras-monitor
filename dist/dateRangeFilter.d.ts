import type { DateRangeCode } from './types.js';
/**
 * `dateRange` is meant to filter results to a source's own natural
 * per-record date field (published/opened/filed date, etc). This source -
 * the Entre Rios tender listing - has NO such field anywhere: the table's
 * only columns are Procedimiento, Objeto, Destino, Estado and Organismo
 * (verified live against the real `<thead>`, see AGENTS.md), and no
 * per-tender detail page exists either where one might be hiding.
 *
 * Faking this filter against a field that exists for other reasons would be
 * actively misleading, not just imprecise:
 * - `scraped_at` is identical for every row from a given run (it's the
 *   extraction timestamp, not the tender's own date) - filtering by it would
 *   either keep everything or nothing depending on when the run happens to
 *   execute relative to the window, never anything meaningful about the
 *   tenders themselves.
 * - `anioProcedimiento` is a full calendar year parsed out of free text
 *   (e.g. "2025") - testing a year against a 24h/7d/30d window is
 *   nonsensical.
 *
 * So this is a disclosed, deliberate no-op: it logs a warning and returns
 * every record unchanged whenever `dateRange` is set, rather than silently
 * shipping a filter that looks like it does something it can't. The input
 * field itself is kept for input-shape consistency with the rest of this
 * portfolio's monitor actors.
 */
export declare function applyDateRangeFilter<T>(records: readonly T[], dateRange: DateRangeCode | undefined): T[];
//# sourceMappingURL=dateRangeFilter.d.ts.map