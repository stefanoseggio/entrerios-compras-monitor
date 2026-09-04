import { describe, expect, it } from 'vitest';

import { fetchTenders } from '../src/fetchTenders.js';

// Live checks against the real site - skipped in CI (same lesson as the
// other actors in this portfolio: don't make CI depend on an external host
// with no uptime guarantee).
describe.skipIf(process.env.CI)('live fetchTenders against the real Entre Rios portal', () => {
    it('fetches a real, narrow, filtered slice with well-formed fields', async () => {
        const records = await fetchTenders({ organismo: '8', estado: '3' });

        expect(records.length).toBeGreaterThan(0);
        for (const r of records) {
            expect(r.organismo).toBe('Ministerio de Salud');
            expect(r.estado).toBe('Realizada');
            expect(r.procedimiento).toBeTruthy();
            expect(r.objeto).toBeTruthy();
            // Real Spanish text must round-trip - no mojibake in a live pull.
            expect(r.objeto).not.toContain('�');
        }
    }, 30_000);

    it('fetches the real unfiltered union across all 4 statuses and it is larger than any single status', async () => {
        const all = await fetchTenders({});
        const soloRealizadas = await fetchTenders({ estado: '3' });

        expect(all.length).toBeGreaterThan(soloRealizadas.length);
        expect(all.length).toBeGreaterThan(5000); // verified live 2026-09-04: 5505 total
        // The blank-estado response carries a real ESTADO column per row.
        const distinctEstados = new Set(all.map((r) => r.estado));
        expect(distinctEstados.size).toBeGreaterThan(1);
    }, 60_000);

    it('confirms the GET-with-querystring trap live: it always returns empty, never the real data', async () => {
        const response = await fetch('https://www.entrerios.gov.ar/contrataciones/licitaciones.php?estado=3');
        const text = await response.text();
        expect(response.status).toBe(200);
        expect(text).toContain('No hay informaci');
        // The static #tabla-resultados container id is present in the page's
        // template either way (verified live), so the reliable "no real
        // data" signal is the absence of a populated <tbody>, not the id.
        expect(text).not.toContain('<tbody>');
    }, 30_000);

    it('confirms the real response headers still claim UTF-8 while the bytes are Windows-1252', async () => {
        const response = await fetch('https://www.entrerios.gov.ar/contrataciones/licitaciones.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'tipo_licitacion=&anio=&estado=3&palabra=&cmb_organismo=8&buscar=Buscar',
        });
        expect(response.headers.get('content-type')).toContain('UTF-8');

        const buffer = await response.arrayBuffer();
        const naiveUtf8 = new TextDecoder('utf-8').decode(buffer);
        const correctWin1252 = new TextDecoder('windows-1252').decode(buffer);

        // The naive UTF-8 decode the declared charset implies corrupts real
        // tender data - every accented character in the actual table rows
        // becomes U+FFFD, since a lone byte like 0xF3 is not valid UTF-8.
        const naiveTbody = naiveUtf8.slice(naiveUtf8.indexOf('<tbody>'), naiveUtf8.indexOf('</tbody>'));
        expect(naiveTbody).toContain('�');

        // The Windows-1252 decode this actor actually uses recovers the
        // real table data cleanly. (A separate, already-known, permanently
        // corrupted - and irrelevant, since it's inside an HTML comment -
        // placeholder string elsewhere on the page still contains garbage
        // either way; this assertion is scoped to the real data rows only.)
        const win1252Tbody = correctWin1252.slice(
            correctWin1252.indexOf('<tbody>'),
            correctWin1252.indexOf('</tbody>'),
        );
        expect(win1252Tbody).not.toContain('Ã');
        expect(win1252Tbody).toContain('ó');
    }, 30_000);
});
