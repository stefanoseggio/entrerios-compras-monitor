import { describe, expect, it } from 'vitest';

import { decodeWin1252 } from '../src/decode.js';

describe('decodeWin1252', () => {
    it('decodes a lone 0xF3 byte as an accented "o" (verified live: the real failure mode)', () => {
        // "Licitaci" + 0xF3 + "n" - exactly how the real site stores
        // "Licitación" in the table's raw bytes (verified 2026-09-04).
        const bytes = Buffer.from([0x4c, 0x69, 0x63, 0x69, 0x74, 0x61, 0x63, 0x69, 0xf3, 0x6e]);
        expect(decodeWin1252(bytes)).toBe('Licitación');
    });

    it('decodes 0x96 as an en dash, not a control character (proves Windows-1252, not plain ISO-8859-1)', () => {
        const bytes = Buffer.from([0x41, 0x20, 0x96, 0x20, 0x42]); // "A" 0x96 "B"
        expect(decodeWin1252(bytes)).toBe('A – B');
    });

    it('never throws on invalid input - every byte maps to something', () => {
        const bytes = Buffer.from([0xff, 0x00, 0x80]);
        expect(() => decodeWin1252(bytes)).not.toThrow();
    });

    it('accepts a plain ArrayBuffer, matching what Response.arrayBuffer() returns', () => {
        const buffer = new Uint8Array([0x48, 0x6f, 0x6c, 0x61]).buffer;
        expect(decodeWin1252(buffer)).toBe('Hola');
    });
});
