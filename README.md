# Entre Rios Compras Monitor

Extracts **public tenders and contracting processes** from the Province of
Entre Rios, Argentina's Unidad Central de Contrataciones portal
(`entrerios.gov.ar/contrataciones/licitaciones.php`) - a large multi-year
backlog (5505 rows verified live, spanning 2004-2025) with organism and
objeto detail, in a single request.

## Delta mode

This isn't just a one-off dump - run it on a daily/hourly Apify schedule with
`onlyNew: true` and it becomes a recurring B2B monitor: each run returns only
the tenders it hasn't returned before, so a downstream system only ever sees
genuinely new procurement activity. State is tracked in a key-value store
scoped to this actor (not the run's own default store, which does not
survive between scheduled runs).

Every record also carries `is_new` regardless of `onlyNew`, so a full,
non-delta run still tells you which of its results are new since the last
time you ran it.

**Python**

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")
run = client.actor("stefano_seggio/entrerios-compras-monitor").call(run_input={"onlyNew": True})
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(item["record_id"], item["procedimiento"], item["estado"])
```

**Node.js**

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_TOKEN' });
const run = await client.actor('stefano_seggio/entrerios-compras-monitor').call({ onlyNew: true });
const { items } = await client.dataset(run.defaultDatasetId).listItems();
```

To push new tenders straight into Slack/Zapier/Make/a custom endpoint
whenever a scheduled run finishes, wire up an
[Apify dataset webhook](https://docs.apify.com/platform/integrations/webhooks)
on this actor rather than polling - no code change to this actor needed.

**Note on `onlyNew`'s cost**: this source is fetched as a single unfiltered
POST covering the entire ~5505-row backlog (see "Known limitations" below) -
there is no genuine pagination to short-circuit. `onlyNew` still fetches the
whole backlog every run and filters the output afterward, so it reduces
what you receive, not how long the run takes or how much it costs to run.

**Note on `dateRange`**: this input exists for consistency with the rest of
this portfolio's monitor actors, but this particular source publishes no
per-record date field at all (verified live - see `AGENTS.md`), so setting
it has no effect here; the run logs a warning instead of silently applying a
misleading filter.

## What you get

| Field               | Description                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `record_id`         | Stable hash of procedimiento+objeto+destino+organismo (the site has no native row id)      |
| `procedimiento`     | Raw procedure string, e.g. `"Solicitud De Cotizacion 54/2025"`                             |
| `anioProcedimiento` | Year extracted from the trailing `/NNNN` of `procedimiento`, or `null`                     |
| `objeto`            | What is being procured                                                                     |
| `destino`           | Destination office/department                                                              |
| `organismo`         | Issuing organism                                                                           |
| `estado`            | Status: `Realizada`, `Fracasada`, `En proceso de Evaluación` or `Próxima Apertura`         |
| `event_type`        | Always `"NEW_LISTING"` for this actor - see `AGENTS.md`                                    |
| `scraped_at`        | ISO timestamp of this run's extraction (same value for every record from one run)          |
| `is_new`            | `true` if `record_id` was not already returned by a prior run (see "Delta mode" above)     |
| `source_url`        | The shared search-listing page - this source has no per-tender detail link to give instead |

## Input

| Field            | Type    | Default     | Description                                                                                                                                                                                     |
| ---------------- | ------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `estado`         | string  | `""` (all)  | `1`=Proxima Apertura, `2`=En proceso de Evaluacion, `3`=Realizada, `4`=Fracasada                                                                                                                |
| `tipoLicitacion` | string  | `""` (all)  | `1`=Licitacion Privada, `2`=Licitacion Publica, `3`=Solicitud de Cotizacion, `4`=Contratacion Directa                                                                                           |
| `organismo`      | string  | `""` (all)  | `1`=Unidad Central de Contrataciones, `3`=Min. Desarrollo Social, `4`=Consejo Gral. de Educacion, `5`=ATER, `6`=UADER, `7`=Poder Judicial, `8`=Min. de Salud, `9`=Direccion Prov. de Vialidad   |
| `anio`           | string  | `""` (all)  | Filter by year, e.g. `"2025"`                                                                                                                                                                   |
| `palabra`        | string  | `""`        | Free-text keyword filter                                                                                                                                                                        |
| `maxItems`       | integer | `1000`      | Hard cap on tenders returned this run                                                                                                                                                           |
| `onlyNew`        | boolean | `false`     | Delta mode - return only tenders not already returned by a prior run. See "Delta mode" above. Does not reduce fetch time/cost for this source (no pagination to short-circuit).                 |
| `dateRange`      | string  | `""` (none) | `"24h"`\|`"7d"`\|`"30d"` - has **no effect** for this actor; this source has no per-record date field. Kept for input-shape consistency with the rest of the portfolio. See "Delta mode" above. |

```json
{ "estado": "3", "organismo": "8", "maxItems": 500 }
```

Leaving every filter blank (the default) pulls the full backlog - **5505
rows** verified live, so raise `maxItems` if you want all of it in one run.

## Usage

```bash
curl "https://api.apify.com/v2/acts/stefano_seggio~entrerios-compras-monitor/run-sync-get-dataset-items?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"estado": "3", "maxItems": 500}'
```

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")
run = client.actor("stefano_seggio/entrerios-compras-monitor").call(run_input={"estado": "3", "maxItems": 500})
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(item["procedimiento"], "-", item["organismo"], "-", item["estado"])
```

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_TOKEN' });
const run = await client.actor('stefano_seggio/entrerios-compras-monitor').call({ estado: '3', maxItems: 500 });
const { items } = await client.dataset(run.defaultDatasetId).listItems();
```

## Known limitations

- The source declares `charset=UTF-8` but actually serves Windows-1252 -
  handled explicitly (see `AGENTS.md`), but if the site ever migrates to
  real UTF-8 without changing the header, decoding would need updating.
- One specific status label ("En proceso de Evaluación") has a permanent,
  unrecoverable encoding corruption in the source's own database, present
  in 100% of rows with that status - normalized back to the correct
  spelling; the analogous "Próxima Apertura" case could not be verified
  live (zero such rows existed at capture time) - see `AGENTS.md`.
- `procedimiento` is kept as free text, not split into type/number/year
  sub-fields - the real data is too inconsistently formatted for a reliable
  split (verified against all 5505 rows). Use the `tipoLicitacion`/`anio`
  input filters for structured filtering instead.
- No opening-date field or per-tender detail link exists anywhere in the
  source for this listing (verified live) - which is also why `dateRange`
  is a documented no-op and `source_url` points at the shared listing page
  rather than a per-record deep link (see "Delta mode" above).
- The source itself contains ~22 pairs of exact duplicate rows (verified
  live) - this is real upstream data duplication, not a parsing artifact.
  Note for delta mode: these duplicate rows share the same `record_id`
  (it's a content hash), so they collide in the seen-set by design too.
- This source is fetched as a single unfiltered POST covering the entire
  backlog rather than genuine, reliably newest-first pagination (verified
  live - the same unfiltered pull runs oldest-first by year, not
  newest-first). `onlyNew` is therefore a safe post-filter over the full
  fetch, not a pagination early-stop - see `AGENTS.md` for the evidence.
- No field-level diffing/update detection: `event_type` is always
  `"NEW_LISTING"` and `is_new` only reflects whether `record_id` was seen
  before, not whether a previously-seen tender's `estado` (or anything
  else) changed since - see `AGENTS.md`.

Full technical detail, including the exact live-verified byte-level
encoding findings and every correction to the initial recon pass, is in
`AGENTS.md`.
