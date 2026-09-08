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

## Delta engine v2 (2026-09-08)

Supersedes "record_id and event_type choices" below (record_id reasoning
still accurate; event_type's "constant, not a per-record classification"
conclusion is superseded - that section explicitly scoped a per-status
event type as "out of scope for this pass", and this pass is exactly the
one that closes it).

**What changed:**

- `src/types.ts` split the old `TenderRecord` (which the pure parser
  stamped `event_type` onto directly) into `ParsedTenderRow` (exactly what
  `parseTenders` can produce with no state) and `TenderRecord` (that plus
  the state-derived `event_type`/`previousEstado`, attached in
  `src/delta.ts`'s new `attachEnvelope`, mirroring `attachIsNew`'s existing
  separation of concerns).
- `src/state.ts`: `DeltaState.entries` is now `Record<record_id, {estado}>`,
  not a bare `seenIds: string[]`. Only `estado` needs tracking - record_id's
  own hash already excludes it and covers everything else that could
  change, so there is nothing else to fingerprint (see below).
- `event_type` is now NEW_LISTING / STATUS_CHANGE (estado differs from
  last time - free, since estado is already in the fetched row) / UNCHANGED
  (full-mode only) / **CLOSED** (new - a previously-seen record_id absent
  from THIS run's fetch). CLOSED is always trustworthy here, unlike
  sibling actors on paginated sources (santafe/salta/mendoza): a single
  POST always returns the ENTIRE backlog, so there is no maxItems-
  truncation risk at the fetch level to gate CLOSED detection on - `main.ts`
  computes it from the complete fetched-id set, independent of whatever
  `maxItems` later bounds for pushing.
- **Deliberately no UPDATED event.** This is the one place in the fleet
  where that's structurally impossible to add honestly: `record_id` IS a
  hash of procedimiento+objeto+destino+organismo. If any of those 4 fields
  change, the hash changes too, producing a DIFFERENT record_id -
  indistinguishable from a brand-new listing without a real source-issued
  id to say "this new hash used to be that old hash". Unlike Mendoza
  (which fingerprints content SEPARATELY from its real record_id) or
  Tucuman (ditto), Entre Rios has no independent identity key at all - the
  site itself has none (see "Architecture" above). So `estado` is the only
  field this actor can ever say "the SAME record changed" about.
- No `resolveSourceUrl`-style cost lever and no two-tier pricing: every
  record already has identical, complete content at identical cost (one
  shared POST, no per-row anything) - same reasoning as Tucuman. Single
  `result` event, unchanged from v1's pricing shape.
- New `eventTypes` input narrows delta-mode delivery, matching the fleet
  convention on santafe/tucuman/salta/mendoza.
- State shape is NOT backward compatible with v1 (`{seenIds: string[]}` is
  treated as absent, not migrated) - see CHANGELOG.md.

## Delta Engine retrofit (2026-09-06)

Added `onlyNew` (delta mode) and `dateRange`, and standardized the output
envelope (`record_id`/`event_type`/`scraped_at`/`is_new`/`source_url`) to
match the shape shipped on the fleet's UK HSE Enforcement Monitor actor.
Every decision below was checked against this actor's real, already-verified
architecture (see the sections above) rather than assumed from the template.

### Early-stop pagination vs. safe post-filter - decided: safe post-filter

This actor does **not** have page-level pagination to short-circuit at all -
a single blank-`estado` POST already returns the entire matching backlog in
one response (see "Architecture" above; unchanged by this retrofit). So
"early-stop once N consecutive pages contain zero unseen ids" has no
mechanism to attach to here: there is exactly one page, always.

On top of that, the ordering itself was checked live and is **not**
newest-first - if anything it leans oldest-first:

- The real, unfiltered 5505-row fixture (`licitaciones_todas.html`) and a
  fresh live pull made 2026-09-06 both start with `Licitación Privada /2018`
  and `.../2017` rows and end with 2025 rows, with the trailing-year sample
  climbing monotonically through the middle of the response (2017/2018 at
  the start, 2022 by row ~2750, 2025 at the end - checked in both the fixture
  and a live re-pull today).
- There is no per-row id or date attribute in the raw HTML at all (checked
  the `<tr>`/`<td>` markup directly - no `data-*`, no hidden id) to hang any
  ordering guarantee on even if we wanted one.

Given both facts - no pagination to stop within, and the one ordering signal
that does exist pointing away from newest-first - `onlyNew` is implemented
as a **safe post-filter**: `fetchTenders` still fetches the entire backlog
exactly as it does without `onlyNew` (see `src/main.ts`), and filtering to
unseen `record_id`s happens afterward (`src/delta.ts`). `test/delta.test.ts`
asserts the mocked HTTP layer is called exactly once even when every id is
already seen, to prove this isn't secretly truncating the fetch.

### `dateRange` - decided: documented no-op for this actor

This source publishes **no per-record date field anywhere** - not new
information from this pass, already documented above under "Known scope
limits" from the 2026-09-04 recon (no `fechaApertura`, no per-tender detail
page). Re-checked directly against the real `<thead>` on 2026-09-06: the
only columns are Procedimiento/Objeto/Destino/Estado/Organismo. The one
"Fecha" string anywhere in the page is `Fecha de consulta` - a client-side
"as of" render timestamp for the whole page, not a per-record field.

Given that, `dateRange` cannot filter against anything real for this domain.
Faking it against `scraped_at` (identical for every row in a run - would
just pass or fail everything, never a meaningful per-tender distinction) or
`anioProcedimiento` (a full calendar year from free text - comparing a year
like "2025" to a 24h/7d/30d window is nonsensical) would be exactly the
"silently shipping a misleading filter" the retrofit brief warns against. So
`dateRange` is kept in the input schema (shape consistency with the rest of
the portfolio) but implemented as a disclosed no-op: `src/dateRangeFilter.ts`
logs a warning and returns every record unchanged whenever it's set. This is
a genuine architecture-driven deviation from the general contract, not a
shortcut - documented in the input schema description, the README, and here.

`test/delta.test.ts`'s dateRange coverage is adapted accordingly: instead of
"excludes out-of-window records" (impossible to test honestly - there is no
window-shaped field to exclude by), it asserts the actual, disclosed
behavior - records pass through unchanged for every window value.

### `record_id` and `event_type` choices

- **`record_id`**: reused the existing `id` field verbatim (same sha1 of
  `procedimiento|objeto|destino|organismo`, renamed, not rehashed). This
  actor's domain has no source-issued id at all - the site itself has none
  (see "Architecture" above) - so the pre-existing content hash already _is_
  this actor's closest equivalent to a natural id; this pass just gives it
  the standardized name rather than inventing a second one. One useful,
  slightly lucky property carried over unchanged: the hash excludes
  `estado`, so the same real-world procedure keeps the same `record_id`
  across a status change (e.g. "En proceso de Evaluación" -> "Realizada")
  instead of `onlyNew` treating a status update as a brand-new listing.
- **`event_type`**: constant `"NEW_LISTING"` for every record - see
  `src/constants.ts`. Considered and rejected a per-`estado` event type
  (e.g. something like `"AWARDED"` for `Realizada`) because that would be
  real state-transition/diff detection dressed up as a static label, and the
  retrofit brief explicitly scopes full field-level diffing out of this
  pass. This domain has exactly one record species (a tender listing row),
  unlike HSE's two-species split (convictions vs. notices), so a single
  constant is the honest fit here.

### `source_url`

No per-tender detail page or link exists anywhere in the source (re-confirmed
this pass, already known from the 2026-09-04 recon: zero `<a href>` inside
`#tabla-resultados`). `source_url` is set to the shared search-listing URL
(`src/constants.ts`'s `TARGET_URL`) on every record - the closest honest
answer, but explicitly NOT a unique per-record deep link; every row from a
given run shares this exact string. Disclosed in the dataset schema, README
and the field's own doc comment in `src/types.ts`.

### State sizing - deviated from the "a few thousand" default

`src/state.ts`'s `MAX_SEEN_IDS` is 10,000, not "a few thousand". The literal
spec value assumes a genuinely paginated, newest-first source where each run
only ever sees a bounded recent window, so evicting old ids from the cap is
safe (they'll never be re-fetched anyway). This actor is the opposite shape:
every run re-fetches the ENTIRE ~5505-row backlog, so a cap below that size
would evict real, still-active ids and make them spuriously reappear as
`is_new: true` forever - the exact bug delta mode exists to prevent. 10,000
stays comfortably above the current backlog with headroom for years of
organic growth (`test/state.test.ts` asserts the cap exceeds 5505).

Relatedly, since this source gives no real recency signal, `mergeSeenIds`
treats "reconfirmed present in this run's full fetch" as a stand-in for
"newest" when deciding what to keep at the front of the persisted array -
documented in its doc comment in `src/state.ts`.

### What actually gets marked "seen" - a real correctness trap avoided

The first draft of `src/main.ts` persisted every `record_id` `fetchTenders`
returned, regardless of `maxItems` or the charge-limit cutoff. That's wrong:
if a run fetches 5505 tenders but only pushes 1000 (`maxItems` default) or
stops early on `Actor.charge`'s `eventChargeLimitReached`, marking all 5505
as "seen" would make the un-pushed ~4500 permanently invisible to `onlyNew`
in every future run, even though the consumer never actually received them.
Fixed: only `record_id`s that were actually pushed this run go into the
seen-set (`pushedIds` in `src/main.ts`), so a record held back by `maxItems`
or a charge limit stays eligible - and correctly flagged `is_new` - next run.

### Gotcha: `npm run format` was already broken before this pass

Unrelated to this retrofit's own code: `prettier --write .` fails on every
file under `test/fixtures/*.html` with `SyntaxError: Void elements do not
have end tags "hr"` - the real site's own markup has a self-closed `<hr>`
immediately followed by a stray `</hr>` (verified: present in the byte-level
fixtures captured 2026-09-04, not a capture artifact). This is pre-existing
(confirmed via `git status`/`git diff` - these fixture files were untouched
by this pass) and simply wasn't caught before, since the "Verification
performed" section below only ever listed build/lint/test, never format.
Fixed by adding `test/fixtures/*.html` to `.prettierignore`: these are
byte-verified golden captures of a real (malformed) external response, not
source code prettier should be rewriting, and letting prettier "fix" them
would risk changing the exact bytes the parser tests assert against.

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
- `npm run format` / `format:check` (prettier) - clean (see the
  `.prettierignore` gotcha above under "Delta Engine retrofit").
- `npm test` - 38/38 green, including the original 4 live tests hitting the
  real target (not skipped, not mocked) plus the new `test/state.test.ts`
  and `test/delta.test.ts` added by the Delta Engine retrofit.
- `apify run --purge` - multiple real local runs, including the default
  unfiltered input (5505 rows parsed live, matching the count in this
  document) and a filtered `organismo=8` run that surfaced a real
  normalized "En proceso de Evaluación" row. Every pushed item's JSON was
  read back with `fs.readFileSync(path, 'utf-8')` + `JSON.parse` in Node
  (never a Windows Python pipe) and round-trips Spanish accents correctly.
- (2026-09-06, Delta Engine retrofit) A fresh live POST against the real
  target reconfirmed, independent of the fixtures: still 5505 rows, the
  same oldest-first-leaning year progression across the response, the same
  5-column `<thead>` with no date field, and zero real "Próxima Apertura"
  rows (the only "Apertura" string in the response is still the `<select>`
  dropdown's option text, not a database value) - none of this retrofit's
  architectural conclusions rest on the 2026-09-04 findings going stale.
