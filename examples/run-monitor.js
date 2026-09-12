// run-monitor.js
// Runs the Entre Rios Compras Monitor actor and prints newly detected tenders.
const { ApifyClient } = require('apify-client');

// Reads your Apify API token from the environment (never hardcode it).
const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

async function main() {
    const input = {
        estado: '',              // all statuses
        tipoLicitacion: '',      // all procedure types
        organismo: '8',          // Ministerio de Salud
        anio: '',                // all years
        palabra: '',
        maxItems: 6000,          // above the current ~5,505-row backlog
        onlyNew: true,           // delta mode: only new/changed/closed tenders
        eventTypes: ['NEW_LISTING', 'STATUS_CHANGE'],
        dateRange: '',           // no effect on this source, kept for input-shape parity
    };

    console.log('Starting entrerios-compras-monitor run...');
    const run = await client.actor('oiXeFzZGlIQ6mKgoo').call(input);
    console.log(`Run ${run.id} finished with status: ${run.status}`);

    // Pull the resulting dataset items (tender delta records).
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    console.log(`Retrieved ${items.length} tender records:`);
    for (const item of items) {
        console.log(`- [${item.event_type}] ${item.procedimiento} (${item.estado})`);
    }
}

main().catch((err) => {
    console.error('Run failed:', err);
    process.exit(1);
});
