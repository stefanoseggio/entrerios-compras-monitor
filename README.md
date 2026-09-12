# Entre Rios Government Tenders Monitor - Argentina Public Procurement (Licitaciones)

## Executive Value Proposition

Checking whether a tender you care about has moved from "under evaluation" to "completed" or "failed" means opening the Province of Entre Rios' own listing page by hand, re-applying filters, and re-reading rows you've already looked at before - there is no official change-tracking feed or API on the Entre Rios side for its own Unidad Central de Contrataciones register. This Actor fetches that entire live register in one pass - 5,505 tender records verified live, with year data going back to at least 2004 - and, on a scheduled run, compares it against its own persisted memory of every record it has seen before, so it can surface exactly what's new, what changed status, and what dropped out of the register since the last check. It covers a genuinely large, multi-year backlog the Province itself gives no structured or monitorable access to, turning a manual daily re-read of a government listing page into a single scheduled dataset pull.

## Use Cases

- **Bid-status tracking for a specific organism.** A supplier bidding into Ministerio de Salud or Direccion Provincial de Vialidad processes sets `organismo` to that issuing body and watches `estado` move through "Proxima Apertura" to "Realizada" or "Fracasada," instead of re-opening the province's listing page to check by hand.
- **Delta monitoring for bid consultants and gestores.** A consultant tracking tenders across several client accounts runs the Actor on a schedule with `onlyNew: true`, and each run's dataset contains only the tenders that are genuinely new, that changed `estado`, or that closed since the previous run - so a client update reports the specific change, not a re-read of the whole listing.
- **Procurement-pattern research across the full backlog.** A researcher, journalist, or transparency group pulls the full unfiltered backlog and uses the `organismo`, `estado`, and `tipoLicitacion` fields together to see which provincial bodies run the most contracting processes and how often those processes complete versus fail - grounded in the fields the source actually publishes, not in contract value, which this source does not disclose anywhere.

## Input

```json
{
  "estado": "",
  "tipoLicitacion": "",
  "organismo": "8",
  "anio": "",
  "palabra": "",
  "maxItems": 6000,
  "onlyNew": true,
  "eventTypes": ["NEW_LISTING", "STATUS_CHANGE"],
  "dateRange": ""
}
```

This configuration leaves every content filter blank except `organismo` (so it tracks Ministerio de Salud specifically), raises `maxItems` above the current backlog size so nothing gets truncated, enables delta mode, and asks only for new listings and status changes.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `estado` | string (enum) | `""` | Filter by process status. Leave blank to pull every status in one request. Values: `""` All statuses, `"1"` Proxima Apertura (upcoming opening), `"2"` En proceso de Evaluacion (under evaluation), `"3"` Realizada (completed), `"4"` Fracasada (failed/void). |
| `tipoLicitacion` | string (enum) | `""` | Filter by contracting procedure type. Leave blank for all types. Values: `""` All types, `"1"` Licitacion Privada, `"2"` Licitacion Publica, `"3"` Solicitud de Cotizacion, `"4"` Contratacion Directa. |
| `organismo` | string (enum) | `""` | Filter by issuing organism. Leave blank for all organisms. Values: `""` All, `"1"` Unidad Central de Contrataciones, `"3"` Ministerio de Desarrollo Social, `"4"` Consejo General de Educacion, `"5"` Administradora Tributaria de Entre Rios, `"6"` UADER, `"7"` Oficina de Compras y Asesoramiento - Poder Judicial de Entre Rios, `"8"` Ministerio de Salud, `"9"` Direccion Provincial de Vialidad. |
| `anio` | string | `""` | Filter by year, e.g. `"2025"`. Leave blank for all years (data goes back to at least 2004). |
| `palabra` | string | `""` | Free-text keyword filter, matched server-side the same way the site's own "Palabra" search box works. |
| `maxItems` | integer | `1000` | Hard cap on the number of tenders returned this run. The full unfiltered backlog is over 5,000 rows - narrow with the filters above or raise this cap to pull all of it. |
| `onlyNew` | boolean | `false` | For recurring/scheduled runs: return only tenders that are new, changed `estado`, or closed since a prior run, tracked in a named key-value store scoped to this Actor. This source has no genuine pagination, so enabling this does not reduce fetch time or request volume - the full backlog is fetched every run regardless, and this only changes which records get pushed to the dataset afterward. |
| `eventTypes` | array (enum items) | `["NEW_LISTING","STATUS_CHANGE","CLOSED"]` | Which kinds of change to deliver when `onlyNew` is on (ignored when it is off). `NEW_LISTING` = never seen before. `STATUS_CHANGE` = seen before, `estado` changed. `CLOSED` = a previously-seen record is absent from this run's fetch - only computed on an unfiltered run. |
| `dateRange` | string (enum) | `""` | Present for input-shape consistency with the rest of this developer's monitor-actor portfolio. This source publishes no per-record date field anywhere - not on the listing, not on any detail page, because no detail page exists. Setting it has no effect on results; the Actor logs a warning instead of silently applying a misleading filter. |

## Output

```json
{
  "record_id": "a1e4f9c2d7b6803e5f18c4a9b2d6e701",
  "procedimiento": "Solicitud De Cotizacion 54/2025",
  "anioProcedimiento": "2025",
  "objeto": "Adquisicion de insumos descartables para centros de salud del interior provincial",
  "destino": "Direccion de Suministros - Ministerio de Salud",
  "organismo": "Ministerio de Salud",
  "estado": "Realizada",
  "event_type": "STATUS_CHANGE",
  "previousEstado": "En proceso de Evaluacion",
  "scraped_at": "2026-09-08T09:15:42.118Z",
  "is_new": false,
  "source_url": "https://www.entrerios.gov.ar/contrataciones/licitaciones.php"
}
```

| Field | Type | Description |
| --- | --- | --- |
| `record_id` | string | Stable hash of `procedimiento+objeto+destino+organismo` - the source has no native row id. Deliberately excludes `estado`, so the same procedure keeps this id across status changes. |
| `procedimiento` | string | Raw procedure identifier as published by the source (e.g. "Solicitud De Cotizacion 54/2025"). |
| `anioProcedimiento` | string \| null | Year extracted from the procedure string. |
| `objeto` | string | What is being procured. |
| `destino` | string | Destination office or department. |
| `organismo` | string | Issuing organism. |
| `estado` | string | Current status of the process. |
| `event_type` | string | `NEW_LISTING`, `STATUS_CHANGE`, `UNCHANGED` (only emitted when `onlyNew` is off), or `CLOSED`. |
| `previousEstado` | string \| null | Set only when `event_type` is `STATUS_CHANGE`: the `estado` this record was last seen under. |
| `scraped_at` | string | ISO timestamp of this run's extraction (same value for every record from one run). |
| `is_new` | boolean | True if `record_id` was not in the persisted seen-set when this run started. |
| `source_url` | string | The shared search-listing page - this source has no per-tender detail link. |

The dataset ships with two views: "Overview" (the listing-style fields) and "Status changes & closures" (`record_id`, `event_type`, `previousEstado`, `estado`, `organismo`, `objeto`, `scraped_at`).

## Reliability

Every request to the source goes through a shared retry helper with exponential backoff: up to 4 retries (5 attempts total), starting at a 1-second delay and doubling on each subsequent attempt, triggered on both network-level errors and any non-2xx HTTP response. Cross-run identity is not held in the Actor's ephemeral per-run storage; it is persisted in a named key-value store dedicated to this Actor, which survives between runs of a scheduled task. Each seen `record_id` is stored together with the `estado` it was last observed under, capped at the 10,000 most-recently-confirmed ids - comfortably above the current ~5,505-row backlog. `CLOSED` detection carries a correctness gate rather than applying unconditionally: it only runs on a fully unfiltered fetch, because a filtered fetch is a subset of the register and a previously-seen tender missing from it may simply be outside that run's filter rather than actually gone. That gate exists because live testing caught the real failure mode it prevents - an early, ungated version of this logic wrongly flagged 37 unrelated records as closed on a filtered follow-up run. Because the source has no pagination (a single request returns the entire backlog every time), there is no early-stop mechanism to short-circuit; `onlyNew` changes only which fetched records get written to the dataset, not how much is fetched.

## Pricing

This Actor uses Apify's pay-per-event pricing model with two event types:

| Event | Price | Meaning |
| --- | --- | --- |
| `result` | $0.003 per record | Charged once for every tender record delivered into the dataset. |
| `apify-actor-start` | $0.00005 | Charged once per run, regardless of how many records that run delivers. |

A one-off unfiltered pull of the current full backlog (5,505 rows) costs approximately 5,505 x $0.003 + $0.00005, or roughly $16.52. A scheduled `onlyNew: true` monitor bills only for records that are actually pushed to the dataset - genuinely new, status-changed, or closed tenders - since an unchanged record is filtered out before it ever becomes a chargeable event.

## Support & Enterprise SLA

This Actor is built and maintained by an independent developer, not a staffed vendor team - there is no dedicated support desk or contractual uptime SLA on offer. Questions, bugs, or source-coverage requests are handled through the Apify Store's Issues tab and are typically addressed within about 48 hours.
