/**
 * The target (https://www.entrerios.gov.ar/contrataciones/licitaciones.php)
 * sends `Content-Type: text/html; charset=UTF-8`, but its real bytes are
 * Windows-1252 - verified live 2026-09-04 by inspecting raw response bytes:
 * accented characters appear as single high bytes (e.g. 0xF3 for "o" with an
 * accute accent in "Licitaci[0xF3]n"), and an em/en-dash appears as the
 * single byte 0x96, which only resolves to a printable character (an en
 * dash) under Windows-1252 - under plain ISO-8859-1 it is an unprintable C1
 * control code, and under UTF-8 a lone 0xF3/0x96 is not a valid sequence at
 * all (`Response.text()` / a naive UTF-8 TextDecoder would replace every
 * such byte with U+FFFD, corrupting virtually every row - this table's
 * Spanish text is almost never accent-free).
 *
 * Always decode the raw response bytes with this function - never call
 * `Response.text()` or otherwise trust the declared charset for this target.
 */
export function decodeWin1252(bytes: ArrayBuffer | ArrayBufferView): string {
    return new TextDecoder('windows-1252').decode(bytes);
}
