import { Actor, log } from 'apify';

import { fetchTenders } from './fetchTenders.js';
import type { ActorInput } from './types.js';

const RESULT_EVENT_NAME = 'result';

await Actor.init();
await run();
await Actor.exit();

async function run(): Promise<void> {
    const input = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);
    const { maxItems = 1000 } = input;

    const tenders = await fetchTenders(input);
    log.info(`Total licitaciones obtenidas: ${tenders.length}`);

    let pushed = 0;
    for (const tender of tenders) {
        if (pushed >= maxItems) {
            log.info(`maxItems (${maxItems}) alcanzado - deteniendo.`);
            break;
        }

        await Actor.pushData(tender);
        pushed += 1;

        const { eventChargeLimitReached } = await Actor.charge({ eventName: RESULT_EVENT_NAME, count: 1 });
        if (eventChargeLimitReached) {
            log.info('Limite de cobro alcanzado - deteniendo.');
            return;
        }
    }

    log.info(`Cargados ${pushed} items al dataset.`);
}
