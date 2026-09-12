"""run_monitor.py
Runs the Entre Rios Compras Monitor actor and prints newly detected tenders.
"""
import os
from apify_client import ApifyClient

# Reads your Apify API token from the environment (never hardcode it).
client = ApifyClient(os.environ["APIFY_API_TOKEN"])

run_input = {
    "estado": "",              # all statuses
    "tipoLicitacion": "",      # all procedure types
    "organismo": "8",          # Ministerio de Salud
    "anio": "",                # all years
    "palabra": "",
    "maxItems": 6000,          # above the current ~5,505-row backlog
    "onlyNew": True,           # delta mode: only new/changed/closed tenders
    "eventTypes": ["NEW_LISTING", "STATUS_CHANGE"],
    "dateRange": "",           # no effect on this source, kept for input-shape parity
}

print("Starting entrerios-compras-monitor run...")
run = client.actor("oiXeFzZGlIQ6mKgoo").call(run_input=run_input)
print(f"Run {run['id']} finished with status: {run['status']}")

# Pull the resulting dataset items (tender delta records).
dataset = client.dataset(run["defaultDatasetId"])
items = list(dataset.iterate_items())
print(f"Retrieved {len(items)} tender records:")
for item in items:
    print(f"- [{item['event_type']}] {item['procedimiento']} ({item['estado']})")
