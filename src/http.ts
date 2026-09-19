import { log } from 'apify';
import { Impit, type RequestInit as ImpitRequestInit } from 'impit';

// One Impit instance per actor run: it holds the connection pool and TLS
// session cache, and gives every request a real, internally-consistent
// Chrome TLS/HTTP2 fingerprint instead of Node's native (and distinctively
// bot-shaped) one - see AGENTS.md for why this was added.
const impit = new Impit({ browser: 'chrome' });

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export class HttpError extends Error {
    constructor(
        public readonly status: number,
        public readonly url: string,
    ) {
        super(`HTTP ${status} for ${url}`);
        this.name = 'HttpError';
    }
}

function isRetriableStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

// No proxy needed - verified live 2026-09-04: reachable from a plain
// datacenter IP (curl and fetch both succeed directly, 200 OK, no TLS or
// network-level block encountered - unlike pba-tenders-monitor's and
// cordoba-compras-monitor's targets).
//
// Retries with exponential backoff on network errors, timeouts, and
// 408/425/429/5xx only - other non-2xx statuses (e.g. a malformed POST) are
// deterministic and surface immediately as HttpError so the caller can
// decide, rather than being retried pointlessly. Each attempt carries its
// own AbortSignal timeout so a hung connection cannot stall the run past
// timeoutMs on any single attempt.
//
// Returns the raw ArrayBuffer rather than parsed text: the response's real
// bytes are Windows-1252, not the UTF-8 its own Content-Type header claims
// (verified live - see AGENTS.md), so callers must decode explicitly with
// `decodeWin1252` instead of `Response.text()`, which would assume UTF-8.
export async function fetchWithRetry(
    url: string,
    init: ImpitRequestInit,
    maxRetries = 4,
    baseDelayMs = 1000,
    timeoutMs = 45_000,
): Promise<ArrayBuffer> {
    let lastError: Error = new Error('unreachable');
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await impit.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
            if (response.ok) return await response.arrayBuffer();
            if (!isRetriableStatus(response.status)) throw new HttpError(response.status, url);
            lastError = new HttpError(response.status, url);
        } catch (error) {
            if (error instanceof HttpError && !isRetriableStatus(error.status)) throw error;
            lastError = error instanceof Error ? error : new Error(String(error));
        }
        if (attempt < maxRetries) {
            const delay = baseDelayMs * 2 ** attempt;
            log.debug(`Retrying ${url} in ${delay}ms after: ${lastError.message}`);
            await sleep(delay);
        }
    }
    throw lastError;
}
