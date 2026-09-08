async function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
// Native fetch(), no proxy needed - verified live 2026-09-04: reachable from
// a plain datacenter IP (curl and fetch both succeed directly, 200 OK, no
// TLS or network-level block encountered - unlike pba-tenders-monitor's and
// cordoba-compras-monitor's targets).
//
// Returns the raw ArrayBuffer rather than parsed text: the response's real
// bytes are Windows-1252, not the UTF-8 its own Content-Type header claims
// (verified live - see AGENTS.md), so callers must decode explicitly with
// `decodeWin1252` instead of `Response.text()`, which would assume UTF-8.
export async function fetchWithRetry(url, init, maxRetries = 4, baseDelayMs = 1000) {
    let lastError = new Error('unreachable');
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, init);
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            return await response.arrayBuffer();
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < maxRetries) {
                await sleep(baseDelayMs * 2 ** attempt);
            }
        }
    }
    throw lastError;
}
//# sourceMappingURL=http.js.map