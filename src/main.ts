import { Actor, log } from 'apify';

import { applyDateRangeFilter } from './dateRangeFilter.js';
import { attachIsNew, filterOnlyNew } from './delta.js';
import { fetchTenders } from './fetchTenders.js';
import { loadDeltaState, mergeSeenIds, saveDeltaState } from './state.js';
import type { ActorInput } from './types.js';

const RESULT_EVENT_NAME = 'result';

await Actor.init();
await run();
await Actor.exit();

async function run(): Promise<void> {
    const input = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);
    const { maxItems = 1000, onlyNew = false, dateRange } = input;

    const previousState = await loadDeltaState();
    const previouslySeenIds = new Set(previousState.seenIds);

    // Always the full backlog, exactly as without `onlyNew` - this source
    // has no pagination to short-circuit (see AGENTS.md).
    const tenders = await fetchTenders(input);
    log.info(`Total licitaciones obtenidas: ${tenders.length}`);

    let items = attachIsNew(tenders, previouslySeenIds);
    items = applyDateRangeFilter(items, dateRange);

    if (onlyNew) {
        const beforeCount = items.length;
        items = filterOnlyNew(items);
        log.info(`onlyNew: ${items.length}/${beforeCount} registros son nuevos desde la corrida anterior.`);
    }

    let pushed = 0;
    const pushedIds: string[] = [];
    let chargeLimitReached = false;

    for (const item of items) {
        if (pushed >= maxItems) {
            log.info(`maxItems (${maxItems}) alcanzado - deteniendo.`);
            break;
        }

        await Actor.pushData(item);
        pushed += 1;
        pushedIds.push(item.record_id);

        const { eventChargeLimitReached } = await Actor.charge({ eventName: RESULT_EVENT_NAME, count: 1 });
        if (eventChargeLimitReached) {
            log.info('Limite de cobro alcanzado - deteniendo.');
            chargeLimitReached = true;
            break;
        }
    }

    // Only ids actually pushed this run are marked "seen" - a record that
    // was fetched but held back by `maxItems` or the charge limit must stay
    // eligible to be returned (and flagged `is_new`) by a future run, rather
    // than silently vanishing from delta mode without ever being delivered.
    await saveDeltaState({
        seenIds: mergeSeenIds(previousState.seenIds, pushedIds),
        lastRunAt: new Date().toISOString(),
    });

    if (!chargeLimitReached) {
        log.info(`Cargados ${pushed} items al dataset.`);
    }
}
