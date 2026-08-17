/**
 * The outbound-port seam — the ONE change `executeCloudNode` needed for the
 * Stage Sandbox's `system` dry-run to be possible without a second executor.
 *
 * These assertions guard the two properties that matter: a supplied stub
 * intercepts BEFORE the real path's own preconditions (so a dry-run needs no
 * tenant context at all), and an OMITTED port — every live caller today —
 * changes nothing about how a pure node behaves.
 */

import { describe, expect, it } from 'vitest';
import { executeCloudNode, type CloudExecutorEnv } from './cloudExecutor';
import { sandboxOutboundPort } from './sandboxOutboundPort';

const env = {} as CloudExecutorEnv;

describe('executeCloudNode — outbound port', () => {
  it('a stubbed gmail node needs no usageCtx at all', async () => {
    const result = await executeCloudNode(env, { kind: 'gmail', config: { to: 'x@example.test' } }, '', undefined, sandboxOutboundPort());
    const parsed = JSON.parse(result.output);
    expect(parsed.stubbed).toBe(true);
    expect(parsed.kind).toBe('gmail');
  });

  it('a stubbed connector node needs no usageCtx and never validates its config', async () => {
    // No `connector`/`action` keys at all — the real path would refuse this,
    // and the stub never gets that far.
    const result = await executeCloudNode(env, { kind: 'connector', config: {} }, '', undefined, sandboxOutboundPort());
    expect(JSON.parse(result.output)).toMatchObject({ stubbed: true, kind: 'connector' });
  });

  it('a stubbed mcp node needs no usageCtx', async () => {
    const result = await executeCloudNode(env, { kind: 'mcp', config: {} }, '', undefined, sandboxOutboundPort());
    expect(JSON.parse(result.output)).toMatchObject({ stubbed: true, kind: 'mcp' });
  });

  it('a stubbed llm node spends no tokens and calls no proxy', async () => {
    const result = await executeCloudNode(env, { kind: 'llm', config: { prompt: 'hello' } }, '', undefined, sandboxOutboundPort());
    expect(JSON.parse(result.output)).toMatchObject({ stubbed: true, kind: 'llm' });
  });

  it('a stubbed web-search node makes no real vendor call', async () => {
    const result = await executeCloudNode(env, { kind: 'web-search', config: { query: 'weather' } }, '', undefined, sandboxOutboundPort());
    expect(JSON.parse(result.output)).toMatchObject({ stubbed: true, kind: 'webSearch' });
  });

  it('a stubbed web-fetch node makes no real network call', async () => {
    const result = await executeCloudNode(env, { kind: 'web-fetch', config: { url: 'https://example.com' } }, '', undefined, sandboxOutboundPort());
    expect(JSON.parse(result.output)).toMatchObject({ stubbed: true, kind: 'webFetch' });
  });

  it('a stubbed google-drive node needs no usageCtx', async () => {
    const result = await executeCloudNode(env, { kind: 'google-drive', config: {} }, '', undefined, sandboxOutboundPort());
    expect(JSON.parse(result.output)).toMatchObject({ stubbed: true, kind: 'googleDrive' });
  });

  it('a stubbed analyze-image node makes no real vision call', async () => {
    const result = await executeCloudNode(env, { kind: 'analyze-image', config: { url: 'https://example.com/x.png' } }, '', undefined, sandboxOutboundPort());
    expect(JSON.parse(result.output)).toMatchObject({ stubbed: true, kind: 'llm' });
  });

  it('a stubbed extract-document-data node makes no real vision call', async () => {
    const result = await executeCloudNode(env, { kind: 'extract-document-data', config: { url: 'https://example.com/invoice.png' } }, '', undefined, sandboxOutboundPort());
    expect(JSON.parse(result.output)).toMatchObject({ stubbed: true, kind: 'llm' });
  });

  it('a stubbed transcribe-audio node makes no real Whisper call', async () => {
    const result = await executeCloudNode(env, { kind: 'transcribe-audio', config: { url: 'https://example.com/a.mp3' } }, '', undefined, sandboxOutboundPort());
    expect(JSON.parse(result.output)).toMatchObject({ stubbed: true, kind: 'transcribeAudio' });
  });

  it('without a real usageCtx, an UNSTUBBED gmail node still refuses exactly as before', async () => {
    await expect(executeCloudNode(env, { kind: 'gmail', config: {} }, ''))
      .rejects.toThrow(/tenant context/);
  });

  it('the outbound param is a no-op for pure ETL nodes', async () => {
    const withoutPort = await executeCloudNode(env, { kind: 'transform', config: { expression: '' } }, 'hello');
    const withPort = await executeCloudNode(env, { kind: 'transform', config: { expression: '' } }, 'hello', undefined, sandboxOutboundPort());
    expect(withoutPort).toEqual(withPort);
  });

  it('a filter node behaves identically with or without a stub port', async () => {
    const withoutPort = await executeCloudNode(env, { kind: 'filter', config: { predicate: 'true' } }, '{}');
    const withPort = await executeCloudNode(env, { kind: 'filter', config: { predicate: 'true' } }, '{}', undefined, sandboxOutboundPort());
    expect(withoutPort).toEqual(withPort);
  });
});
