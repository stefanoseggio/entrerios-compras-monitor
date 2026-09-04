import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { decodeWin1252 } from '../../src/decode.js';
import { extractAnioProcedimiento, normalizeEstadoText, parseTenders } from '../../src/parsers/table.js';

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));

function loadFixtureHtml(name: string): string {
    const buffer = readFileSync(`${fixturesDir}/${name}`);
    return decodeWin1252(buffer);
}

describe('parseTenders - 5-column layout (estado filter blank, real capture)', () => {
    const html = loadFixtureHtml('licitaciones_organismo8.html');

    it('extracts every real row from the fixture (organismo=8, all statuses)', () => {
        const records = parseTenders(html, '');
        expect(records).toHaveLength(54);
    });

    it('parses well-formed fields on the first row', () => {
        const records = parseTenders(html, '');
        const first = records[0];

        expect(first.procedimiento).toBe('Licitación Pública 17/2024');
        expect(first.anioProcedimiento).toBe('2024');
        expect(first.objeto).toBe('Adquisicion de Una (01) Mesa de Anestesia');
        expect(first.destino).toContain('Hospital');
        expect(first.organismo).toBe('Ministerio de Salud');
        expect(first.estado).toBe('Realizada');
        expect(first.id).toMatch(/^[0-9a-f]{40}$/);
        expect(first.scrapedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('round-trips Spanish accented characters correctly (no mojibake)', () => {
        const records = parseTenders(html, '');
        const withAccents = records.find((r) => r.procedimiento.includes('Pública'));
        expect(withAccents).toBeDefined();
        // None of the real free-text fields should ever contain the mojibake
        // marker this site's own database produces for one specific status
        // label (see normalizeEstadoText docs) - if this ever appears in
        // free text, decoding regressed back to UTF-8.
        for (const r of records) {
            expect(r.objeto).not.toContain('�');
            expect(r.destino).not.toContain('ï¿½');
        }
    });

    it('normalizes the corrupted "En proceso de Evaluacion" label the source itself produces', () => {
        const records = parseTenders(html, '');
        const enEvaluacion = records.filter((r) => r.estado === 'En proceso de Evaluación');
        expect(enEvaluacion.length).toBeGreaterThan(0);
        for (const r of enEvaluacion) {
            expect(r.estado).not.toContain('ï¿½');
        }
    });

    it('only produces the 4 known estado values', () => {
        const records = parseTenders(html, '');
        const distinct = new Set(records.map((r) => r.estado));
        for (const value of distinct) {
            expect(['Realizada', 'Fracasada', 'En proceso de Evaluación', 'Próxima Apertura']).toContain(value);
        }
    });
});

describe('parseTenders - 4-column layout (estado filter applied, real capture)', () => {
    const html = loadFixtureHtml('licitaciones_estado3_organismo8.html');

    it('extracts every real row and fills in estado from the applied filter', () => {
        const records = parseTenders(html, '3');
        expect(records).toHaveLength(17);
        for (const r of records) {
            expect(r.estado).toBe('Realizada');
        }
    });
});

describe('parseTenders - empty result (real capture, no <tbody> at all)', () => {
    it('returns an empty array without throwing', () => {
        const html = loadFixtureHtml('licitaciones_vacio.html');
        const records = parseTenders(html, '1');
        expect(records).toHaveLength(0);
    });
});

describe('parseTenders - GET-with-querystring trap (real capture)', () => {
    it('confirms the documented trap: GET always returns the empty state regardless of querystring', () => {
        const html = loadFixtureHtml('licitaciones_get_trampa.html');
        const records = parseTenders(html, '3');
        expect(records).toHaveLength(0);
        expect(html).toContain('No hay informaci');
    });
});

describe('parseTenders - full unfiltered backlog (real capture, all 4 statuses combined)', () => {
    it('extracts the full real backlog - 5505 rows, not the 2042 an earlier estado=3-only pass found', () => {
        const html = loadFixtureHtml('licitaciones_todas.html');
        const records = parseTenders(html, '');
        expect(records).toHaveLength(5505);

        const byEstado = new Map<string, number>();
        for (const r of records) {
            byEstado.set(r.estado, (byEstado.get(r.estado) ?? 0) + 1);
        }
        // Verified live 2026-09-04: estado=3 alone (Realizada) is 2042 rows,
        // a little over a third of the real 5505-row total.
        expect(byEstado.get('Realizada')).toBe(2042);
        expect(byEstado.get('En proceso de Evaluación')).toBe(2840);
        expect(byEstado.get('Fracasada')).toBe(623);
    });

    it('ids match content: the handful of duplicate ids in the real data are genuine, byte-identical duplicate rows', () => {
        // Verified live 2026-09-04: the source itself lists exactly 22 pairs
        // of rows with fully identical procedimiento/objeto/destino/organismo
        // (real upstream data duplication, not a parsing artifact - see
        // AGENTS.md). `id` is a content hash, so these collide by design;
        // asserting global id-uniqueness would be asserting something false
        // about the actual source data.
        const html = loadFixtureHtml('licitaciones_todas.html');
        const records = parseTenders(html, '');
        const byId = new Map<string, typeof records>();
        for (const r of records) {
            byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
        }
        const duplicateGroups = [...byId.values()].filter((group) => group.length > 1);
        expect(duplicateGroups).toHaveLength(22);
        for (const group of duplicateGroups) {
            expect(group).toHaveLength(2);
            const [a, b] = group;
            expect(a.procedimiento).toBe(b.procedimiento);
            expect(a.objeto).toBe(b.objeto);
            expect(a.destino).toBe(b.destino);
            expect(a.organismo).toBe(b.organismo);
        }
    });
});

describe('extractAnioProcedimiento', () => {
    it('extracts a trailing 4-digit year', () => {
        expect(extractAnioProcedimiento('Solicitud De Cotizacion 54/2025')).toBe('2025');
        expect(extractAnioProcedimiento('Licitacion Privada /2018')).toBe('2018');
    });

    it('extracts whatever digits are actually there for the one known malformed real row', () => {
        expect(extractAnioProcedimiento('Solicitud De Cotización 303/0')).toBe('0');
    });

    it('returns null when there is no trailing /digits at all', () => {
        expect(extractAnioProcedimiento('Sin numero ni anio')).toBeNull();
    });
});

describe('normalizeEstadoText', () => {
    it('passes through clean known labels unchanged', () => {
        expect(normalizeEstadoText('Realizada')).toBe('Realizada');
        expect(normalizeEstadoText('Fracasada')).toBe('Fracasada');
    });

    it('normalizes the corrupted "Evaluacion" spelling', () => {
        // The literal 3-character sequence Windows-1252 produces when
        // decoding the site's own corrupted bytes (EF BF BD) for this label.
        expect(normalizeEstadoText('En proceso de Evaluaciï¿½n')).toBe('En proceso de Evaluación');
    });

    it('passes through an unrecognized label rather than guessing', () => {
        expect(normalizeEstadoText('Algo Inesperado')).toBe('Algo Inesperado');
    });
});
