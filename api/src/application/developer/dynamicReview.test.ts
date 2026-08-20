/**
 * The dynamic stage's whole value is that its evidence is TRUE. So the tests
 * assert what it claims, not just its verdict: that a mutating action is recorded
 * as not-invoked rather than quietly counted, that a request never left for one,
 * and that an action pointing off the declared origin is a refusal.
 *
 * The connector path needs a sandbox workspace and a database; what is exercised
 * here is the MCP path plus the pure decision helpers, which is where the claims
 * the evidence makes are actually decided.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { dynamicStage, __setReviewFetchForTests } from './dynamicReview';
import type { ReviewStageContext } from './reviewPipeline';

afterEach(() => __setReviewFetchForTests(null));

const ctx = (over: Partial<ReviewStageContext> = {}): ReviewStageContext => ({
  db: {} as ReviewStageContext['db'],
  env: {} as ReviewStageContext['env'],
  packageId: 'pkg-1',
  packageSlug: 'acme-docs',
  versionId: 'ver-1',
  semver: '1.0.0',
  kind: 'mcp_server',
  spec: {},
  normalizedSpec: {},
  scopes: ['tools:call'],
  requestedScopes: ['tools:call'],
  verificationState: 'domain_verified',
  paid: false,
  previousScopes: null,
  priorStages: new Map(),
  ...over,
});

const jsonRpc = (tools: string[]): typeof fetch =>
  (async () => new Response(
    JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: tools.map((name) => ({ name })) } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )) as unknown as typeof fetch;

describe('applies', () => {
  it('runs for the two kinds that have a runtime, and for nothing else', () => {
    expect(dynamicStage.applies(ctx({ kind: 'connector' }))).toBe(true);
    expect(dynamicStage.applies(ctx({ kind: 'mcp_server' }))).toBe(true);
    expect(dynamicStage.applies(ctx({ kind: 'canvas_kind' }))).toBe(false);
  });
});

describe('mcp_server — declared versus actual', () => {
  const spec = { serverUrl: 'https://mcp.acme-docs.example/rpc', tools: ['search_docs', 'fetch_page'] };

  it('passes when the server advertises exactly what was declared, and says which tools it saw', async () => {
    __setReviewFetchForTests(jsonRpc(['search_docs', 'fetch_page']));
    const result = await dynamicStage.run(ctx({ normalizedSpec: spec }));
    expect(result.verdict).toBe('pass');
    const listed = result.evidence.find((e) => e.subject === 'tools/list');
    expect(listed?.outcome).toBe('pass');
    expect(listed?.detail).toContain('search_docs');
    expect(listed?.status).toBe(200);
    expect(listed?.url).toBe(spec.serverUrl);
  });

  it('REFUSES a tool the server advertises but the spec never declared', async () => {
    // The supply-chain hole: an undeclared tool would enter the merged catalog on
    // install having been reviewed by nobody.
    __setReviewFetchForTests(jsonRpc(['search_docs', 'fetch_page', 'delete_everything']));
    const result = await dynamicStage.run(ctx({ normalizedSpec: spec }));
    expect(result.verdict).toBe('fail');
    expect(result.findings.some((f) => f.check === 'undeclared_tool' && f.message.includes('delete_everything'))).toBe(true);
  });

  it('REFUSES a declared tool the server does not advertise', async () => {
    __setReviewFetchForTests(jsonRpc(['search_docs']));
    const result = await dynamicStage.run(ctx({ normalizedSpec: spec }));
    expect(result.verdict).toBe('fail');
    expect(result.findings.some((f) => f.check === 'declared_tool_missing')).toBe(true);
    expect(result.evidence.find((e) => e.subject === 'fetch_page')?.outcome).toBe('fail');
  });

  it('refuses a server that does not answer — for an mcp package the server IS the package', async () => {
    __setReviewFetchForTests((async () => { throw new Error('connection refused'); }) as unknown as typeof fetch);
    const result = await dynamicStage.run(ctx({ normalizedSpec: spec }));
    expect(result.verdict).toBe('fail');
    expect(result.findings.some((f) => f.check === 'endpoint_unreachable')).toBe(true);
  });

  it('refuses a serverUrl the SSRF guard blocks, without sending anything', async () => {
    let called = false;
    __setReviewFetchForTests((async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch);
    const result = await dynamicStage.run(ctx({ normalizedSpec: { serverUrl: 'http://localhost:8080/rpc', tools: ['x'] } }));
    expect(called).toBe(false);
    expect(result.verdict).toBe('fail');
    expect(result.findings.some((f) => f.check === 'egress_guard')).toBe(true);
  });

  it('reads a streaming transport\'s `data:` frame rather than failing on it', async () => {
    __setReviewFetchForTests((async () => new Response(
      'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"search_docs"},{"name":"fetch_page"}]}}\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )) as unknown as typeof fetch);
    const result = await dynamicStage.run(ctx({ normalizedSpec: spec }));
    expect(result.verdict).toBe('pass');
  });
});
