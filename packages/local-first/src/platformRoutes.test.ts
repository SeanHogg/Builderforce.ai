import { describe, expect, it } from 'vitest';
import { PLATFORM_ROUTE_RULES, classifyPlatformRequest, isContentRequest, platformRequestMethod, platformRequestUrl } from './index.js';

describe('platform route table', () => {
  it.each([
    ['/api/auth/tenant-api-key-token', 'POST', 'authenticate'],
    ['/api/vscode/tenants/7/token', 'POST', 'authenticate'],
    ['/llm/v1/chat/completions', 'POST', 'gateway-inference'],
    ['/llm/v1/models', 'POST', 'connected-feature'],
    ['/api/llm/models', 'GET', 'connected-feature'],
    ['/api/limbic/block', 'POST', 'connected-feature'],
    ['/api/projects/12/evermind/recall', 'POST', 'connected-feature'],
    ['/api/brain/tickets/search', 'POST', 'connected-feature'],
    ['/api/dashboards/query', 'POST', 'connected-feature'],
    ['/api/data-sources/abc/query', 'POST', 'connected-feature'],
    ['/api/vscode/connect', 'POST', 'connected-feature'],
    ['/api/runtime/attention', 'GET', 'connected-feature'],
    ['/api/brain/chats', 'POST', 'synchronize'],
    ['/api/tasks/4', 'PATCH', 'synchronize'],
    ['/api/tasks/4', 'DELETE', 'synchronize'],
    ['/llm/v1/run-outcome', 'POST', 'synchronize'],
    // The Brain's streamed turn is inference — it used to fall through to `synchronize`.
    ['/api/brain/stream', 'POST', 'gateway-inference'],
    ['/api/limbic/affect', 'POST', 'connected-feature'],
    ['/api/projects/12/evermind/learn', 'POST', 'connected-feature'],
    // The run.local-success head's fleet read (its push rides the learn door above).
    ['/api/projects/12/evermind/ml-head', 'GET', 'connected-feature'],
    ['/api/evermind/learn', 'POST', 'connected-feature'],
    ['/api/sync/push', 'POST', 'synchronize'],
    ['/api/sync/pull', 'GET', 'synchronize'],
    // Content-only rules keep the method's default capability.
    ['/api/brain/chats/9/messages', 'GET', 'connected-feature'],
    ['/api/brain/chats/9/messages', 'POST', 'synchronize'],
    ['/api/quality-ingest/product-report', 'POST', 'synchronize'],
  ] as const)('%s %s → %s', (path, method, capability) => {
    expect(classifyPlatformRequest(path, method)).toBe(capability);
  });

  it('matches whole segments, never a substring', () => {
    expect(classifyPlatformRequest('/api/limbicx/block', 'POST')).toBe('synchronize');
    expect(classifyPlatformRequest('/api/projects/1/evermindx/recall', 'POST')).toBe('synchronize');
    expect(classifyPlatformRequest('/api/research', 'POST')).toBe('synchronize');
    expect(classifyPlatformRequest('/api/syncing', 'POST')).toBe('synchronize');
    expect(isContentRequest('/api/syncing', 'GET')).toBe(false);
    expect(isContentRequest('/api/brain/streams', 'POST')).toBe(false);
  });

  describe('content', () => {
    it.each([
      ['/llm/v1/chat/completions', 'POST'],
      ['/api/brain/stream', 'POST'],
      ['/api/projects/12/evermind', 'GET'],
      ['/api/projects/12/evermind/recall', 'POST'],
      // A head delta carries this device's turn features; Local only sends neither it nor the read.
      ['/api/projects/12/evermind/learn', 'POST'],
      ['/api/projects/12/evermind/ml-head', 'GET'],
      ['/api/evermind/stats', 'GET'],
      ['/api/limbic/block', 'POST'],
      ['/api/limbic/affect', 'PUT'],
      ['/api/sync/push', 'POST'],
      ['/api/sync/pull', 'GET'],
      ['/api/brain/chats/9/messages', 'GET'],
      ['/api/chats/9/messages', 'POST'],
      ['/api/brain/upload', 'POST'],
      ['/api/brain/fetch-url', 'POST'],
      ['/api/quality-ingest/product-report', 'POST'],
      ['/api/guest/research/search', 'POST'],
      ['/api/guest/career/score_resume', 'POST'],
      ['/api/creation-sessions/abc/ws', 'GET'],
      ['/api/guest/rooms/XY12/ws', 'GET'],
      ['/api/agile/ceremonies/rooms/4/ws', 'GET'],
      ['/api/meetings/rooms/k/ws', 'GET'],
      ['/api/runtime/executions/9/stream', 'GET'],
      ['/api/agent-hosts/3/ws', 'GET'],
    ] as const)("%s %s carries the person's content", (path, method) => {
      expect(isContentRequest(path, method)).toBe(true);
    });

    it.each([
      ['/api/projects', 'GET'],
      ['/api/tasks/4', 'PATCH'],
      ['/api/brain/chats', 'GET'],
      ['/api/llm/models', 'GET'],
      ['/api/guest/session', 'POST'],
      ['/api/auth/me', 'GET'],
      ['/api/dashboards/query', 'POST'],
      // "Something changed" sockets carry no content — the page refetches.
      ['/api/guest/messages/ws', 'GET'],
      ['/api/agile/retros/5/ws', 'GET'],
    ] as const)('%s %s is ordinary page data', (path, method) => {
      expect(isContentRequest(path, method)).toBe(false);
    });

    it('a content-only rule never decides the capability', () => {
      expect(PLATFORM_ROUTE_RULES.filter((rule) => !rule.capability).every((rule) => rule.content === true)).toBe(true);
    });
  });

  it('reads only the exact token-exchange path as authenticate — never any path ending in /token', () => {
    expect(classifyPlatformRequest('/api/vscode/tenants/7/token', 'POST')).toBe('authenticate');
    expect(classifyPlatformRequest('/api/projects/7/token', 'POST')).toBe('synchronize');
    expect(classifyPlatformRequest('/api/admin/tenants/7/token', 'POST')).toBe('synchronize');
    expect(classifyPlatformRequest('/api/vscode/tenants/7/token/extra', 'POST')).toBe('synchronize');
  });

  it('every rule documents why it exists', () => {
    expect(PLATFORM_ROUTE_RULES.every((rule) => rule.note.length > 0)).toBe(true);
  });

  it('reads a fetch call\'s url and method in any input shape', () => {
    expect(platformRequestUrl(new URL('https://a.test/x'))).toBe('https://a.test/x');
    expect(platformRequestMethod('https://a.test/x', { method: 'post' })).toBe('POST');
    expect(platformRequestMethod(new Request('https://a.test/x', { method: 'PUT' }))).toBe('PUT');
    expect(platformRequestMethod('https://a.test/x')).toBe('GET');
  });
});
