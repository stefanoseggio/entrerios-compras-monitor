import { Actor, log } from 'apify';
import { applyDateRangeFilter } from './dateRangeFilter.js';
import { attachEnvelope, filterEventTypes, filterOnlyNew, findClosed } from './delta.js';
import { fetchTenders } from './fetchTenders.js';
import { loadDeltaState, mergeSeenEntries, saveDeltaState } from './state.js';
const RESULT_EVENT_NAME = 'result';
await Actor.init();
await run();
await Actor.exit();
async function run() {
    const input = (await Actor.getInput()) ?? {};
    const { maxItems = 1000, onlyNew = false, eventTypes, dateRange } = input;
    const previousState = await loadDeltaState();
    const scrapedAt = new Date().toISOString();
    // Always the full backlog, exactly as without `onlyNew` - this source
    // has no pagination to short-circuit (see AGENTS.md).
    const rows = await fetchTenders(input);
    log.info(`Total licitaciones obtenidas: ${rows.length}`);
    let items = attachEnvelope(rows, previousState);
    items = applyDateRangeFilter(items, dateRange);
    // Trustworthy here (unlike a paginated source): this fetch always covers the ENTIRE
    // backlog, so a previously-seen id absent from it has genuinely left the register.
    const fetchedIds = new Set(rows.map((r) => r.record_id));
    const closed = findClosed(previousState, fetchedIds, scrapedAt).map((record) => ({ ...record, is_new: false }));
    items = [...items, ...closed];
    if (onlyNew) {
        const beforeCount = items.length;
        items = filterOnlyNew(items);
        log.info(`onlyNew: ${items.length}/${beforeCount} registros son nuevos, cambiaron de estado o cerraron desde la corrida anterior.`);
    }
    items = filterEventTypes(items, eventTypes);
    let pushed = 0;
    const byEventType = {};
    const pushedNonClosed = [];
    const pushedClosedIds = [];
    let chargeLimitReached = false;
    for (const item of items) {
        if (pushed >= maxItems) {
            log.info(`maxItems (${maxItems}) alcanzado - deteniendo.`);
            break;
        }
        await Actor.pushData(item);
        pushed += 1;
        byEventType[item.event_type] = (byEventType[item.event_type] ?? 0) + 1;
        if (item.event_type === 'CLOSED')
            pushedClosedIds.push(item.record_id);
        else
            pushedNonClosed.push({ id: item.record_id, estado: item.estado });
        const { eventChargeLimitReached } = await Actor.charge({ eventName: RESULT_EVENT_NAME, count: 1 });
        if (eventChargeLimitReached) {
            log.info('Limite de cobro alcanzado - deteniendo.');
            chargeLimitReached = true;
            break;
        }
    }
    // Only ids actually pushed this run are marked "seen"/"forgotten" - a record that was
    // fetched (or found closed) but held back by `maxItems` or the charge limit must stay
    // eligible - correctly flagged next run - rather than silently vanishing from delta mode
    // without ever being delivered. See AGENTS.md "What actually gets marked seen".
    let entries = mergeSeenEntries(previousState.entries, pushedNonClosed);
    if (pushedClosedIds.length > 0) {
        entries = { ...entries };
        for (const id of pushedClosedIds)
            delete entries[id];
    }
    await saveDeltaState({ entries, lastRunAt: scrapedAt });
    if (!chargeLimitReached) {
        log.info(`Cargados ${pushed} items al dataset (${Object.entries(byEventType)
            .map(([type, count]) => `${type}=${count}`)
            .join(', ')}).`);
    }
}
//# sourceMappingURL=main.js.map