# Entre Rios Compras Monitor

Extracts **public tenders and contracting processes** from the Province of
Entre Rios, Argentina's Unidad Central de Contrataciones portal
(`entrerios.gov.ar/contrataciones/licitaciones.php`) - a large multi-year
backlog (5505 rows verified live, spanning 2004-2025) with organism and
objeto detail, in a single request.

## What you get

| Field               | Description                                                                           |
| ------------------- | ------------------------------------------------------------------------------------- |
| `id`                | Stable hash of procedimiento+objeto+destino+organismo (the site has no native row id) |
| `procedimiento`     | Raw procedure string, e.g. `"Solicitud De Cotizacion 54/2025"`                        |
| `anioProcedimiento` | Year extracted from the trailing `/NNNN` of `procedimiento`, or `null`                |
| `objeto`            | What is being procured                                                                |
| `destino`           | Destination office/department                                                         |
| `organismo`         | Issuing organism                                                                      |
| `estado`            | Status: `Realizada`, `Fracasada`, `En proceso de Evaluación` or `Próxima Apertura`    |
| `scrapedAt`         | ISO timestamp of extraction                                                           |

## Input

| Field            | Type    | Default    | Description                                                                                                                                                                                   |
| ---------------- | ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `estado`         | string  | `""` (all) | `1`=Proxima Apertura, `2`=En proceso de Evaluacion, `3`=Realizada, `4`=Fracasada                                                                                                              |
| `tipoLicitacion` | string  | `""` (all) | `1`=Licitacion Privada, `2`=Licitacion Publica, `3`=Solicitud de Cotizacion, `4`=Contratacion Directa                                                                                         |
| `organismo`      | string  | `""` (all) | `1`=Unidad Central de Contrataciones, `3`=Min. Desarrollo Social, `4`=Consejo Gral. de Educacion, `5`=ATER, `6`=UADER, `7`=Poder Judicial, `8`=Min. de Salud, `9`=Direccion Prov. de Vialidad |
| `anio`           | string  | `""` (all) | Filter by year, e.g. `"2025"`                                                                                                                                                                 |
| `palabra`        | string  | `""`       | Free-text keyword filter                                                                                                                                                                      |
| `maxItems`       | integer | `1000`     | Hard cap on tenders returned this run                                                                                                                                                         |

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
  source for this listing (verified live) - the 6 fields above are the
  entirety of what this endpoint publishes.
- The source itself contains ~22 pairs of exact duplicate rows (verified
  live) - this is real upstream data duplication, not a parsing artifact.

Full technical detail, including the exact live-verified byte-level
encoding findings and every correction to the initial recon pass, is in
`AGENTS.md`.
