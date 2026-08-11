import { assertSafeUrl, resolveAndAssertPublic } from '../net/ssrfGuard';
import type { CrawledResponse, CrawlerHttpPort } from '../../application/webSearch/ports';

const TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) throw new Error(`Response exceeds ${maxBytes} byte limit.`);
  const reader = response.body?.getReader();
  if (!reader) return (await response.text()).slice(0, maxBytes);
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new Error(`Response exceeds ${maxBytes} byte limit.`); }
    chunks.push(value);
  }
  const merged = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
}

export class CrawlerHttpClient implements CrawlerHttpPort {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}
  async fetch(startUrl: string, options: { accept?: string; maxBytes?: number } = {}): Promise<CrawledResponse> {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      let current = startUrl;
      for (let hop = 0; hop <= 5; hop++) {
        const safe = assertSafeUrl(current, { allowHttp: true });
        await resolveAndAssertPublic(safe.hostname);
        const response = await this.fetchImpl(current, { redirect: 'manual', signal: controller.signal, headers: {
          'User-Agent': 'BuilderforceSearchBot/1.0 (+https://builderforce.ai; search crawler)',
          Accept: options.accept ?? 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5',
        } });
        if (REDIRECTS.has(response.status) && response.headers.has('location')) {
          if (hop === 5) throw new Error('Too many redirects.');
          await response.body?.cancel(); current = new URL(response.headers.get('location')!, current).toString(); continue;
        }
        return { url: current, status: response.status, contentType: (response.headers.get('content-type') ?? '').toLowerCase(), body: await readBounded(response, options.maxBytes ?? DEFAULT_MAX_BYTES), headers: response.headers };
      }
      throw new Error('Too many redirects.');
    } finally { clearTimeout(timeout); }
  }
}

