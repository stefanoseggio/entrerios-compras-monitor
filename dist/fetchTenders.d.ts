import type { ActorInput, ParsedTenderRow } from './types.js';
/**
 * The search form is a standard `method="post" action=""` HTML form (plain
 * PHP + PHPSESSID cookie, no ViewState/DevExpress markers - verified live
 * 2026-09-04). Critically, the page also silently accepts a GET request
 * with the same field names as a querystring and returns 200 OK - but the
 * backend never reads GET params, so it always renders the "no results"
 * empty state (9.4KB) regardless of what's in the querystring. The form
 * fields MUST be POSTed, not appended as `?estado=...`. See AGENTS.md.
 */
export declare function fetchTenders(input: ActorInput): Promise<ParsedTenderRow[]>;
//# sourceMappingURL=fetchTenders.d.ts.map