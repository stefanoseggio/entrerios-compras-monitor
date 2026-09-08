# Entre Rios Tenders Scraper & Monitor

**The tender-alert feed the Province of Entre Rios never shipped.** Extracts every public tender and contracting process from the Province of Entre Rios, Argentina's Unidad Central de Contrataciones portal (`entrerios.gov.ar/contrataciones/licitaciones.php`) - a large multi-year backlog (5505 rows verified live, spanning 2004-2025) with organism and objeto detail, in a single request - and keeps it fresh with a delta mode that reports what is genuinely **new, changed status, or closed**.

[![Entre Rios Tenders Scraper & Monitor](https://apify.com/actor-badge?actor=stefano_seggio/entrerios-compras-monitor)](https://apify.com/stefano_seggio/entrerios-compras-monitor)

- **Status changes, free.** `estado` (e.g. "En proceso de Evaluación" -> "Realizada") is already in every fetched row - a status change is detected at zero extra cost.
- **Knows when a tender leaves the register, always reliably.** Unlike sources with pagination, this one is a single request that always returns the entire backlog - so "a previously-tracked tender is now absent" is never a guess caused by a partial walk. It's reported as `CLOSED`.
- **No proxy, no browser, one request** - a plain PHP form POST, decoded correctly from the source's real (mislabeled) Windows-1252 bytes.

## Who uses Entre Rios procurement data

| Team | Question they ask | Fields that answer it | Decision |
| --- | --- | --- | --- |
| Suppliers to provincial organisms (health, education, judicial, roads) | Did a tracked tender get completed or fail, and is it still open? | `estado`, `event_type=STATUS_CHANGE`/`CLOSED`, `organismo` | Stop chasing a closed process, or re-check one that changed status |
| Bid consultants and gestores managing several clients | What changed across my clients' tracked tenders since yesterday? | `event_type`, `previousEstado`, `objeto` | Notify the client with the specific change |
| Regional tender-data resellers / LATAM procurement platforms | A structured, change-aware Entre Rios feed instead of a screen scrape | The whole envelope (`record_id`, `event_type`, `scraped_at`, `is_new`, `source_url`) | Buy vs. build a scraper that correctly handles the source's mislabeled encoding |
| Journalists, researchers, transparency groups | Which organisms run the most contracting processes, and how many fail/complete? | `organismo`, `estado`, `tipoLicitacion` (input filter) | Spending-pattern and outcome analysis across a 20-year backlog |

## Delta mode

Set `onlyNew: true` for recurring/scheduled monitoring and each run returns only tenders that are `NEW_LISTING`, `STATUS_CHANGE` (estado changed) or `CLOSED` (no longer in the register). `eventTypes` narrows which of the three you want. Every record also always carries `is_new` (computed even on a plain non-delta run).

**Note on `onlyNew`'s cost**: this source is fetched as a single unfiltered POST covering the entire ~5505-row backlog - there is no genuine pagination to short-circuit. `onlyNew` still fetches the whole backlog every run and filters the output afterward, so it reduces what you receive, not how long the run takes.

**Note on `dateRange`**: this input exists for consistency with the rest of this portfolio's monitor actors, but this particular source publishes no per-record date field at all (verified live - see `AGENTS.md`), so setting it has no effect here; the run logs a warning instead of silently applying a misleading filter.

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")
run = client.actor("stefano_seggio/entrerios-compras-monitor").call(run_input={"onlyNew": True})
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(item["record_id"], item["event_type"], item["estado"])
```

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_TOKEN' });
const run = await client.actor('stefano_seggio/entrerios-compras-monitor').call({ onlyNew: true });
const { items } = await client.dataset(run.defaultDatasetId).listItems();
```

To push new tenders straight into Slack/Zapier/Make/a custom endpoint whenever a scheduled run finishes, wire up an [Apify dataset webhook](https://docs.apify.com/platform/integrations/webhooks) on this actor rather than polling - no code change to this actor needed.

## What you get

| Field | Description |
| --- | --- |
| `record_id` | Stable hash of procedimiento+objeto+destino+organismo (the site has no native row id) |
| `procedimiento` | Raw procedure string, e.g. `"Solicitud De Cotizacion 54/2025"` |
| `anioProcedimiento` | Year extracted from the trailing `/NNNN` of `procedimiento`, or `null` |
| `objeto` | What is being procured |
| `destino` | Destination office/department |
| `organismo` | Issuing organism |
| `estado` | Status: `Realizada`, `Fracasada`, `En proceso de Evaluación` or `Próxima Apertura` |
| `event_type` | `NEW_LISTING` / `STATUS_CHANGE` / `UNCHANGED` / `CLOSED` |
| `previousEstado` | Set only for `STATUS_CHANGE`: the estado this record_id was last seen under |
| `scraped_at` | ISO timestamp of this run's extraction (same value for every record from one run) |
| `is_new` | `true` if `record_id` was not already returned by a prior run (see "Delta mode" above) |
| `source_url` | The shared search-listing page - this source has no per-tender detail link to give instead |

## Input

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `estado` | string | `""` (all) | `1`=Proxima Apertura, `2`=En proceso de Evaluacion, `3`=Realizada, `4`=Fracasada |
| `tipoLicitacion` | string | `""` (all) | `1`=Licitacion Privada, `2`=Licitacion Publica, `3`=Solicitud de Cotizacion, `4`=Contratacion Directa |
| `organismo` | string | `""` (all) | `1`=Unidad Central de Contrataciones, `3`=Min. Desarrollo Social, `4`=Consejo Gral. de Educacion, `5`=ATER, `6`=UADER, `7`=Poder Judicial, `8`=Min. de Salud, `9`=Direccion Prov. de Vialidad |
| `anio` | string | `""` (all) | Filter by year, e.g. `"2025"` |
| `palabra` | string | `""` | Free-text keyword filter |
| `maxItems` | integer | `1000` | Hard cap on tenders returned this run |
| `onlyNew` | boolean | `false` | Delta mode - new/status-changed/closed since a prior run. See Delta mode above |
| `eventTypes` | array | all three | Which of `NEW_LISTING`/`STATUS_CHANGE`/`CLOSED` to deliver when `onlyNew` is on |
| `dateRange` | string | `""` (none) | Has **no effect** for this actor; kept for input-shape consistency. See Delta mode above |

```json
{ "estado": "3", "organismo": "8", "maxItems": 500 }
```

Leaving every filter blank (the default) pulls the full backlog - **5505 rows** verified live, so raise `maxItems` if you want all of it in one run.

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

## How much does it cost to monitor Entre Rios tenders?

Pay per event, platform usage included:

| Event | Price | When |
| --- | --- | --- |
| `result` | **$0.003** per record | Every delivered record - this source has no detail/summary split, every record already has identical, complete content at identical cost |
| Actor start | $0.00005 | Once per run |

A daily monitor finding 10 changes across the full register costs about $0.03/day (~$0.90/month); a one-off pull of the full 5505-row backlog costs about $16.50.

## Known limitations

- The source declares `charset=UTF-8` but actually serves Windows-1252 - handled explicitly (see `AGENTS.md`), but if the site ever migrates to real UTF-8 without changing the header, decoding would need updating.
- One specific status label ("En proceso de Evaluación") has a permanent, unrecoverable encoding corruption in the source's own database, present in 100% of rows with that status - normalized back to the correct spelling; the analogous "Próxima Apertura" case could not be verified live (zero such rows existed at capture time) - see `AGENTS.md`.
- `procedimiento` is kept as free text, not split into type/number/year sub-fields - the real data is too inconsistently formatted for a reliable split (verified against all 5505 rows). Use the `tipoLicitacion`/`anio` input filters for structured filtering instead.
- No opening-date field or per-tender detail link exists anywhere in the source for this listing (verified live) - which is also why `dateRange` is a documented no-op and `source_url` points at the shared listing page rather than a per-record deep link.
- The source itself contains ~22 pairs of exact duplicate rows (verified live) - this is real upstream data duplication, not a parsing artifact. These duplicate rows share the same `record_id` (it's a content hash), so they collide in the seen-set by design too.
- **Deliberately no `UPDATED` event.** `record_id` is itself a hash of procedimiento+objeto+destino+organismo - any change to those fields produces a genuinely different id, indistinguishable from a new listing without a real source-issued id to correlate old and new rows. `estado` is the only field this source can ever say "the same record changed" about - see `AGENTS.md`.
- This source is fetched as a single unfiltered POST covering the entire backlog rather than genuine, reliably newest-first pagination (verified live - the same unfiltered pull runs oldest-first by year, not newest-first). `onlyNew` is therefore a safe post-filter over the full fetch, not a pagination early-stop.

Full technical detail, including the exact live-verified byte-level encoding findings and every correction to the initial recon pass, is in `AGENTS.md`.
