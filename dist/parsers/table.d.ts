import type { EstadoCode, ParsedTenderRow } from '../types.js';
/**
 * Normalizes a raw ESTADO cell scraped from the table. The site's database
 * has a real, permanent encoding corruption for one of its 4 status labels:
 * verified live 2026-09-04, EVERY row (2840/2840 in a full unfiltered pull)
 * whose status is "En proceso de Evaluacion" stores the accented "o" as the
 * literal Unicode replacement character, itself re-encoded as raw UTF-8
 * bytes (EF BF BD) inside a Windows-1252 document - decoding those 3 bytes
 * as Windows-1252 (the correct charset for this document, see decode.ts)
 * yields the 3-character garbage sequence "i-with-diaeresis, inverted
 * question mark, one-half" in place of the single accented "o". This is
 * upstream data loss, not a decoding bug on our side - there is no way to
 * recover the original character. We normalize the known-corrupted spelling
 * back to the correct label rather than shipping visible mojibake, since
 * this is a closed 4-value enum we've verified exhaustively, not a guess
 * over free text.
 *
 * "Proxima Apertura" was NOT verified in actual row data - live testing
 * 2026-09-04 found 0 rows in that status at capture time, only the select
 * dropdown's option text (which is a separate, correctly-encoded template
 * string, not the database value). The regex below tolerates either a clean
 * or corrupted accented "o" for that one label defensively, but this is
 * disclosed as unverified in AGENTS.md.
 */
export declare function normalizeEstadoText(raw: string): string;
/**
 * Extracts the trailing year from a `procedimiento` string, e.g.
 * "Solicitud De Cotizacion 54/2025" -> "2025". Verified live 2026-09-04
 * against all 5505 rows of a full unfiltered pull: 5504/5505 (99.98%) end in
 * `/<digits>`; the one exception ("Solicitud De Cotizacion 303/0") is a real
 * upstream data-entry error (the source's own `anio` filter dropdown lists
 * an actual "0" option), not a parsing failure - we pass through whatever
 * digits are actually there rather than validating them as a real year.
 */
export declare function extractAnioProcedimiento(procedimiento: string): string | null;
/**
 * Parses the `#tabla-resultados` results table out of an already-decoded
 * HTML string (see decode.ts - never pass raw bytes here).
 *
 * @param html Decoded page HTML.
 * @param appliedEstadoFilter The `estado` value the POST request was made
 *   with. Used to fill in the `estado` field when the response is in the
 *   4-column shape (no ESTADO column present).
 */
export declare function parseTenders(html: string, appliedEstadoFilter: EstadoCode): ParsedTenderRow[];
//# sourceMappingURL=table.d.ts.map