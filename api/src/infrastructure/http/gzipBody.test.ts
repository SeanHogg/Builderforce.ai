import { describe, expect, it } from 'vitest';
import { gzip, isGzip, readJsonBody } from './gzipBody';

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const post = (body: Uint8Array, headers: Record<string, string> = {}): Request =>
  new Request('https://api.test/internal/container-op', { method: 'POST', body, headers });

describe('gzip request bodies', () => {
  const payload = { executionId: 7, token: 't', op: 'llm', args: { messages: [{ role: 'user', content: 'x'.repeat(5000) }] } };

  it('reads a plain JSON body (older container images)', async () => {
    expect(await readJsonBody(post(encode(payload)), 1024 * 1024)).toEqual(payload);
  });

  it('reads a gzipped body by its magic bytes, with or without the header', async () => {
    const zipped = await gzip(encode(payload));
    expect(isGzip(zipped)).toBe(true);
    expect(zipped.byteLength).toBeLessThan(encode(payload).byteLength);
    expect(await readJsonBody(post(zipped, { 'Content-Encoding': 'gzip' }), 1024 * 1024)).toEqual(payload);
    expect(await readJsonBody(post(zipped), 1024 * 1024)).toEqual(payload);
  });

  it('refuses a body that inflates past the ceiling', async () => {
    const zipped = await gzip(encode(payload));
    await expect(readJsonBody(post(zipped), 1000)).rejects.toThrow(/inflates past/);
  });

  it('refuses non-JSON like request.json() does', async () => {
    await expect(readJsonBody(post(new TextEncoder().encode('not json')), 1000)).rejects.toThrow();
  });
});
