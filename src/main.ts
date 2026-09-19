import { Actor, log } from 'apify';

import { applyDateRangeFilter } from './dateRangeFilter.js';
import { attachEnvelope, filterEventTypes, filterOnlyNew, findClosed, isSuspectedFetchFailure, isUnfilteredInput } from './delta.js';
import { fetchTenders } from './fetchTenders.js';
import { loadDeltaState, mergeSeenEntries, saveDeltaState } from './state.js';
import type { ActorInput, DatasetItem } from './types.js';

const RESULT_EVENT_NAME = 'result';

await Actor.init();
try {
    await run();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.exception(error instanceof Error ? error : new Error(message), 'Run failed');
    await Actor.setValue('LAST_ERROR', { message, at: new Date().toISOString() });
    await Actor.fail(`Entre Rios licitaciones extraction failed: ${message}`);
}
await Actor.exit();

async function run(): Promise<void> {
    const input = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);
    const { maxItems = 1000, onlyNew = false, eventTypes, dateRange } = input;

    const previousState = await loadDeltaState();
    const scrapedAt = new Date().toISOString();

    // Always the full backlog, exactly as without `onlyNew` - this source
    // has no pagination to short-circuit (see AGENTS.md).
    const rows = await fetchTenders(input);
    log.info(`Total licitaciones obtenidas: ${rows.length}`);

    let items: DatasetItem[] = attachEnvelope(rows, previousState);
    items = applyDateRangeFilter(items, dateRange);

    // CLOSED is only safe to compute against an UNFILTERED run (see AGENTS.md "Delta engine
    // v2" - this was found and fixed during cloud verification, not assumed safe from the
    // design alone): this fetch is the entire backlog only when estado/tipoLicitacion/
    // organismo/anio/palabra are all blank. Any filter applied means the fetch is a SUBSET of
    // the register, so a previously-seen id absent from it may simply be outside this run's
    // filter, not actually gone - reporting it CLOSED in that case would be a false positive
    // (confirmed live: a follow-up run narrowed to estado=3 wrongly reported 37 records from
    // other estados as CLOSED). Skip CLOSED entirely on a filtered run rather than risk that.
    const previousTrackedCount = Object.keys(previousState.entries).length;
    if (isUnfilteredInput(input)) {
        // Guard against the fetch technically "succeeding" (HTTP 200, nothing thrown) while
        // actually returning garbage: a bot-check/interstitial page, a dropped session, or the
        // documented GET-with-querystring empty-state shape returned by mistake, all of which
        // parseTenders reads as "0 rows" the same way it reads a real empty backlog (see
        // isSuspectedFetchFailure's doc comment in delta.ts). Without this check, that 0 (or
        // near-0) row count would flow straight into findClosed and every previously-tracked
        // record would be reported CLOSED and dropped from state in one run - a real bug caught
        // by code audit, not observed live yet. See AGENTS.md "Delta engine v2".
        if (isSuspectedFetchFailure(previousTrackedCount, rows.length)) {
            log.warning(
                `SUSPECTED FETCH FAILURE, not a real mass closure: this unfiltered run returned only ${rows.length} ` +
                    `licitacion(es) vs ${previousTrackedCount} previously-tracked record(s) (see isSuspectedFetchFailure ` +
                    'in src/delta.ts). Skipping CLOSED detection entirely this run and leaving every previously-tracked ' +
                    "id untouched in state - they are NOT being marked closed. If the source is genuinely down to that " +
                    'few, a future run with a healthy fetch will report them CLOSED correctly then.',
            );
        } else {
            const fetchedIds = new Set(rows.map((r) => r.record_id));
            const closed = findClosed(previousState, fetchedIds, scrapedAt).map((record) => ({ ...record, is_new: false }));
            items = [...items, ...closed];
        }
    } else if (previousTrackedCount > 0) {
        log.info('Skipping CLOSED detection this run: a filter is applied, so this fetch is not the full register. Run with no filters to enable it.');
    }

    if (onlyNew) {
        const beforeCount = items.length;
        items = filterOnlyNew(items);
        log.info(`onlyNew: ${items.length}/${beforeCount} registros son nuevos, cambiaron de estado o cerraron desde la corrida anterior.`);
    }
    items = filterEventTypes(items, eventTypes);

    let pushed = 0;
    const byEventType: Record<string, number> = {};
    const pushedNonClosed: { id: string; estado: string }[] = [];
    const pushedClosedIds: string[] = [];
    let chargeLimitReached = false;

    for (const item of items) {
        if (pushed >= maxItems) {
            log.info(`maxItems (${maxItems}) alcanzado - deteniendo.`);
            break;
        }

        await Actor.pushData(item);
        pushed += 1;
        byEventType[item.event_type] = (byEventType[item.event_type] ?? 0) + 1;
        if (item.event_type === 'CLOSED') pushedClosedIds.push(item.record_id);
        else pushedNonClosed.push({ id: item.record_id, estado: item.estado });

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
        for (const id of pushedClosedIds) delete entries[id];
    }
    await saveDeltaState({ entries, lastRunAt: scrapedAt });

    if (!chargeLimitReached) {
        log.info(
            `Cargados ${pushed} items al dataset (${Object.entries(byEventType)
                .map(([type, count]) => `${type}=${count}`)
                .join(', ')}).`,
        );
    }
}
