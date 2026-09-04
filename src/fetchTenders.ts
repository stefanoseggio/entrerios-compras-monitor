import { log } from 'apify';

import { decodeWin1252 } from './decode.js';
import { fetchWithRetry } from './http.js';
import { parseTenders } from './parsers/table.js';
import type { ActorInput, TenderRecord } from './types.js';

const TARGET_URL = 'https://www.entrerios.gov.ar/contrataciones/licitaciones.php';

/**
 * The search form is a standard `method="post" action=""` HTML form (plain
 * PHP + PHPSESSID cookie, no ViewState/DevExpress markers - verified live
 * 2026-09-04). Critically, the page also silently accepts a GET request
 * with the same field names as a querystring and returns 200 OK - but the
 * backend never reads GET params, so it always renders the "no results"
 * empty state (9.4KB) regardless of what's in the querystring. The form
 * fields MUST be POSTed, not appended as `?estado=...`. See AGENTS.md.
 */
export async function fetchTenders(input: ActorInput): Promise<TenderRecord[]> {
    const estado = input.estado ?? '';
    const body = new URLSearchParams({
        tipo_licitacion: input.tipoLicitacion ?? '',
        anio: input.anio ?? '',
        estado,
        palabra: input.palabra ?? '',
        cmb_organismo: input.organismo ?? '',
        buscar: 'Buscar',
    });

    log.info(`POST ${TARGET_URL} (${body.toString()})`);
    const buffer = await fetchWithRetry(TARGET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    const html = decodeWin1252(buffer);
    const records = parseTenders(html, estado);
    log.info(`Parseadas ${records.length} licitaciones para el filtro aplicado.`);
    return records;
}
