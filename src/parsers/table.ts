import { createHash } from 'node:crypto';

import * as cheerio from 'cheerio';

import { TARGET_URL } from '../constants.js';
import type { EstadoCode, ParsedTenderRow } from '../types.js';

/**
 * The site's search form (see AGENTS.md) renders the results table in two
 * different shapes depending on whether an `estado` filter was applied,
 * verified live 2026-09-04:
 *
 * - `estado` blank (unfiltered): 5 columns - Procedimiento, Objeto, Destino,
 *   ESTADO, Organismo. The extra ESTADO column only appears in this shape.
 * - `estado` set to a specific code: 4 columns - Procedimiento, Objeto,
 *   Destino, Organismo (no ESTADO column, since every row already shares
 *   the one filtered status).
 */
const FIVE_COLUMN_LAYOUT = 5;

/**
 * Canonical status labels for the site's 4-value `estado` enum, keyed by the
 * same codes the POST form uses (see AGENTS.md). Used when the ESTADO column
 * isn't present in the response (a specific `estado` filter was applied).
 */
const ESTADO_LABELS_BY_CODE: Record<Exclude<EstadoCode, ''>, string> = {
    '1': 'Próxima Apertura',
    '2': 'En proceso de Evaluación',
    '3': 'Realizada',
    '4': 'Fracasada',
};

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
export function normalizeEstadoText(raw: string): string {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (/^Realizada$/i.test(text)) return 'Realizada';
    if (/^Fracasada$/i.test(text)) return 'Fracasada';
    // The `.{1,3}` in the middle tolerates both a clean single accented "o"
    // and the 3-character garbage the site's own corrupted bytes decode to
    // under Windows-1252 (see the doc comment above).
    if (/^En proceso de Evaluaci.{1,3}n$/i.test(text)) return 'En proceso de Evaluación';
    if (/^Pr.{1,3}xima[s]? Apertura[s]?$/i.test(text)) return 'Próxima Apertura';
    return text;
}

/**
 * Extracts the trailing year from a `procedimiento` string, e.g.
 * "Solicitud De Cotizacion 54/2025" -> "2025". Verified live 2026-09-04
 * against all 5505 rows of a full unfiltered pull: 5504/5505 (99.98%) end in
 * `/<digits>`; the one exception ("Solicitud De Cotizacion 303/0") is a real
 * upstream data-entry error (the source's own `anio` filter dropdown lists
 * an actual "0" option), not a parsing failure - we pass through whatever
 * digits are actually there rather than validating them as a real year.
 */
export function extractAnioProcedimiento(procedimiento: string): string | null {
    const match = procedimiento.match(/\/(\d{1,4})\s*$/);
    return match ? match[1] : null;
}

/**
 * WARNING - disclosed, accepted risk, not a bug to "fix" casually (see
 * AGENTS.md "Delta engine v2" and types.ts's `record_id` doc comment): this
 * hashes 4 FREE-TEXT fields, not a source-issued id. A silent upstream
 * correction to any of them (a typo fix, a re-punctuated `objeto`, the site
 * eventually fixing one of its own known text-encoding corruptions - see
 * decode.ts / normalizeEstadoText above) changes the hash, which surfaces as
 * a false CLOSED + NEW_LISTING pair in src/delta.ts/main.ts, not just a "new
 * listing", for a procurement that never actually closed. Narrowing this to
 * fewer/more-stable fields (e.g. procedimiento+organismo) is NOT safe to do
 * without first adding a state migration - src/state.ts's `SeenEntry` does
 * not retain the source text a persisted id's hash was built from, so
 * changing this function would itself mass-trigger the exact false
 * CLOSED+NEW_LISTING failure across the whole existing tracked backlog.
 */
function stableId(procedimiento: string, objeto: string, destino: string, organismo: string): string {
    return createHash('sha1').update(`${procedimiento}|${objeto}|${destino}|${organismo}`).digest('hex');
}

/**
 * Parses the `#tabla-resultados` results table out of an already-decoded
 * HTML string (see decode.ts - never pass raw bytes here).
 *
 * @param html Decoded page HTML.
 * @param appliedEstadoFilter The `estado` value the POST request was made
 *   with. Used to fill in the `estado` field when the response is in the
 *   4-column shape (no ESTADO column present).
 */
export function parseTenders(html: string, appliedEstadoFilter: EstadoCode): ParsedTenderRow[] {
    const $ = cheerio.load(html);
    const rows = $('#tabla-resultados tbody tr').toArray();

    const scrapedAt = new Date().toISOString();
    const records: ParsedTenderRow[] = [];

    for (const row of rows) {
        const cellTexts = $(row)
            .find('td')
            .toArray()
            .map((td) => $(td).text().replace(/\s+/g, ' ').trim());

        if (cellTexts.length < 4) continue; // defensive: skip any malformed row rather than crash the run

        let procedimiento: string;
        let objeto: string;
        let destino: string;
        let organismo: string;
        let estadoRaw: string;

        if (cellTexts.length >= FIVE_COLUMN_LAYOUT) {
            [procedimiento, objeto, destino, estadoRaw, organismo] = cellTexts;
        } else {
            [procedimiento, objeto, destino, organismo] = cellTexts;
            estadoRaw = appliedEstadoFilter ? ESTADO_LABELS_BY_CODE[appliedEstadoFilter] : '';
        }

        records.push({
            record_id: stableId(procedimiento, objeto, destino, organismo),
            procedimiento,
            anioProcedimiento: extractAnioProcedimiento(procedimiento),
            objeto,
            destino,
            organismo,
            estado: normalizeEstadoText(estadoRaw),
            scraped_at: scrapedAt,
            source_url: TARGET_URL,
        });
    }

    return records;
}
