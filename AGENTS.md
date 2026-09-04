# AGENTS.md - Entre Rios Compras Monitor

Technical notes for whoever (human or AI) touches this actor next. Written
plainly, disclosing real gaps rather than hiding them.

## What this actor does

POSTs the search form of the Province of Entre Rios, Argentina's Unidad
Central de Contrataciones portal
(`www.entrerios.gov.ar/contrataciones/licitaciones.php`) and extracts every
row of the resulting `#tabla-resultados` table: contracting procedure,
object, destination office, organism and status. One request returns the
entire matching slice server-rendered - no pagination, no AJAX, no session
state.

## Architecture

Plain PHP + `PHPSESSID` cookie, zero DevExpress/ASPX/ViewState markers
(grepped the full HTML live, confirmed). No Crawlee, no browser - a single
`fetch()` POST per run (`src/fetchTenders.ts`), retried with exponential
backoff (`src/http.ts`, same pattern as the other actors in this portfolio).
No proxy: reachable directly from this machine, 200 OK, ~0.3s for the full
3.1MB unfiltered response.

- `src/http.ts` - `fetchWithRetry` returns the raw `ArrayBuffer`, not parsed
  text (see Encoding below for why).
- `src/decode.ts` - `decodeWin1252` - the one non-boilerplate architectural
  choice this actor needed.
- `src/parsers/table.ts` - `parseTenders` handles the two different table
  shapes the site renders (see below), extracts a trailing year from the
  free-text procedure string, and normalizes one specific corrupted status
  label.
- `src/fetchTenders.ts` - builds the POST body from `ActorInput` and drives
  the above.

## Real, live-verified findings (2026-09-04) - corrections to the earlier recon pass

The task's own recon notes said this endpoint holds "2042 rows" and that
"you must iterate the estado field's values... to cover the full backlog."
Both were incomplete, verified by re-testing every filter value live before
writing any parser code:

1. **The real backlog is 5505 rows, not 2042.** The recon pass only tried
   `estado=3` ("Realizada"), which is indeed 2042 rows - but that's less
   than 37% of the total. The other 3 status values: `estado=2` (En
   proceso de Evaluacion) = 2840, `estado=4` (Fracasada) = 623, `estado=1`
   (Proxima Apertura) = 0 at capture time. `2042+2840+623+0 = 5505`.
2. **You do NOT need to iterate `estado` to get the full backlog.** Leaving
   `estado` blank returns the union of all 4 statuses in a single POST
   (verified: the blank response's row count, 5505, exactly equals the sum
   of the 4 individually-filtered requests). This is simpler and cheaper
   than the recon notes assumed - one request covers everything.
3. **The table's column count changes shape depending on the `estado`
   filter**, which the recon notes never mentioned because they only tested
   one filter value:
    - `estado` blank: **5 columns** - Procedimiento, Objeto, Destino,
      **ESTADO**, Organismo.
    - `estado` set to a specific code: **4 columns** - Procedimiento, Objeto,
      Destino, Organismo (no ESTADO column, since every row already shares
      the filtered status). `parseTenders` detects which shape it received
      by counting `<td>` cells per row and fills in `estado` from the
      applied filter code when the ESTADO column is absent.
4. **The GET-with-querystring trap the recon notes flagged is real and was
   re-confirmed live**: `GET /licitaciones.php?estado=3` returns 200 OK and
   9.4KB of "No hay informacion con ese criterio" every time, regardless of
   the querystring - the backend genuinely never reads GET params. The form
   fields must be POSTed as `application/x-www-form-urlencoded`. A
   regression fixture (`test/fixtures/licitaciones_get_trampa.html`) and a
   live test both guard against silently regressing to GET.
5. **The site's own data contains ~22 pairs of exact, byte-identical
   duplicate rows** (same procedimiento+objeto+destino+organismo+estado,
   confirmed by diffing full field values, not just an id collision). This
   is genuine upstream data duplication, not a parsing bug - `id` is a
   content hash, so these collide by design. See
   `test/parsers/table.test.ts` for the exact count (22) verified against a
   full live capture.
6. **No proxy needed** - reachable directly, 200 OK, fast. `robots.txt`
   does not disallow `/contrataciones/`.

## Encoding - the real headline finding

The response declares `Content-Type: text/html; charset=UTF-8`, but the
**actual bytes are Windows-1252**, not UTF-8. This was verified at the byte
level, not guessed:

- `Licitaci[0xF3]n` in the raw response bytes - `0xF3` is the Windows-1252
  encoding of an accented "o". A correct UTF-8 encoding of that character
  would be the 2-byte sequence `0xC3 0xB3`, which is not what's on the
  wire.
- `Atenci[0xF3]n[0x96]Control` - `0x96` decodes to an en dash ("-") only
  under Windows-1252. Under plain ISO-8859-1, `0x96` is an unprintable C1
  control character; under UTF-8 it's not a valid sequence at all. This one
  byte is what distinguishes Windows-1252 from ISO-8859-1 here, not just
  "some 8-bit charset."
- Decoding the same bytes with `TextDecoder('utf-8')` (i.e. trusting the
  declared charset, or calling `Response.text()`) replaces every such byte
  with U+FFFD - and since virtually every row's `objeto`/`destino`/
  `organismo` has at least one accented character, this would corrupt
  nearly the entire dataset. `Response.text()` must never be used for this
  target; always `Response.arrayBuffer()` + `decodeWin1252`.

`src/http.ts` returns the raw `ArrayBuffer`, and `src/decode.ts` decodes it
explicitly. `test/decode.test.ts` and the live tests in
`test/fetchTenders.test.ts` both assert this against real bytes, not
hand-typed fixtures.

### A second, narrower, genuinely unrecoverable corruption

Independent of the charset-mismatch issue above, the site's own database
has **permanently lost** the accented "o" in one specific, fixed status
label. Verified live: in a full 5505-row unfiltered pull, **every single
one** of the 2840 rows whose status is "En proceso de Evaluacion" stores
that "o" as the raw UTF-8 encoding of the Unicode replacement character
(`0xEF 0xBF 0xBD`) embedded inside the otherwise-Windows-1252 document.
Decoding those 3 bytes as Windows-1252 (the correct charset for everything
else) produces the 3-character garbage sequence "i-diaeresis,
inverted-question-mark, one-half" in place of the single "o" - there is no
decode strategy that recovers the original character, because it was
already lost upstream before this actor ever saw it (most likely: someone
on the government's side ran already-mojibake'd UTF-8 bytes through a
second lossy re-encode, years before this data existed on this endpoint).

`normalizeEstadoText` in `src/parsers/table.ts` recognizes this exact,
verified, closed-4-value-enum corruption and maps it back to the correct
"En proceso de Evaluación" label rather than shipping visible mojibake.
This is a narrow, disclosed fix for a fully-verified constant - not a
guess applied to free text. The other 3 status labels ("Realizada",
"Fracasada", "Proxima Apertura") were confirmed clean in every row that
could be checked.

**Disclosed limitation**: "Proxima Apertura" could not be verified in real
row data - live testing found 0 rows in that status at capture time (only
the form's `<select>` dropdown option, a separate, correctly-encoded
template string, not a database value). `normalizeEstadoText`'s regex for
that one label tolerates either a clean or corrupted accented "o"
defensively, but this specific case is unverified against a real row. If
Entre Rios ever publishes an upcoming-opening tender, re-verify this label
against a real capture before trusting it blindly.

## `procedimiento` is not split into tipo/numero/anio - a deliberate scope limit

The free-text "Procedimiento de Contratacion" strings are inconsistently
formatted across the real 5505-row backlog - live samples include
`"Licitacion Privada /2018"` (no number), `"Solicitud De Cotizacion
54/2025"` (clean), and `"Licitacion Privada Licitacion Privada Nº
01/13/2013"` (the type name duplicated, plus a bare `Nº` prefix), with
parenthetical notes like `"(2do Llamado)"` scattered throughout. Attempting
a strict regex split into separate `tipo`/`numero`/`anio` fields would
silently misparse a meaningful fraction of real rows. Instead:

- `procedimiento` is kept as the raw, verbatim string.
- `anioProcedimiento` extracts _only_ the reliable part: the trailing
  `/NNNN` year, verified live to match 5504/5505 rows (99.98%) of a full
  pull. The one exception, `"Solicitud De Cotizacion 303/0"`, is a real
  upstream data-entry error (the site's own `anio` filter dropdown lists an
  actual `"0"` option) - `extractAnioProcedimiento` passes through whatever
  digits are actually there rather than validating them as a plausible
  year.
- If a consumer needs structured filtering by procedure type or year, use
  the `tipoLicitacion`/`anio` **input filters**, which are applied
  server-side against the real underlying data, not reconstructed from the
  display string client-side.

## Known scope limits (disclosed, not hidden)

- `Proxima Apertura` status-label encoding is unverified in live row data
  (see above) - only the corrupted "En proceso de Evaluacion" case was
  confirmed and fixed.
- `procedimiento` is not decomposed into tipo/numero (see above) - use the
  `tipoLicitacion` input filter for structured filtering by type instead.
- No `fechaApertura`/opening-date field exists anywhere in the source HTML
  for this table - the site simply doesn't publish one on this listing view
  (checked the full column set live; only Procedimiento/Objeto/Destino/
  Estado/Organismo exist).
- No per-tender detail page or link exists in the table rows (checked live
    - zero `<a href>` inside `#tabla-resultados`) - the 5 listing fields are
      the entirety of what this endpoint publishes.

## Local dev environment note (not an actor defect)

`apify run` on this Windows machine intermittently crashes _after_ the
actor's own logic completes successfully and the dataset is written
correctly - `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file
src\win\async.c` from Node's own process-teardown path, non-deterministic
(reproduced twice, then a third run completed clean, exit code 0).
Confirmed this is not specific to this actor's code by reproducing the
identical crash running `santafe-compras-monitor` locally with the same
`apify run` flow - a Node 24 + Windows + `tsx`/apify-cli teardown issue
pre-existing in this portfolio's dev environment, not something this
actor's code triggers. It does not affect the actual Docker/cloud runtime
(`FROM apify/actor-node:24`, Linux), and every local run's actual data
output (verified via Node reading the written dataset files) was correct
regardless of whether the shell-level crash occurred afterward.

## Verification performed

- `npm run build` (tsc) - clean.
- `npm run lint` (eslint) - clean.
- `npm test` - 24/24 green, including 4 live tests hitting the real target
  (not skipped, not mocked).
- `apify run --purge` - multiple real local runs, including the default
  unfiltered input (5505 rows parsed live, matching the count in this
  document) and a filtered `organismo=8` run that surfaced a real
  normalized "En proceso de Evaluación" row. Every pushed item's JSON was
  read back with `fs.readFileSync(path, 'utf-8')` + `JSON.parse` in Node
  (never a Windows Python pipe) and round-trips Spanish accents correctly.
