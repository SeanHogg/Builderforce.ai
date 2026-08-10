import { describe, expect, it } from 'vitest';
import { executionRole, isCodePath, summarizeTaskActivity } from './taskActivity';

const at = (hour: number) => new Date(`2026-08-10T${String(hour).padStart(2, '0')}:00:00.000Z`);

describe('task activity summary', () => {
  it('distinguishes a PM-authored PRD from implementation evidence', () => {
    const summary = summarizeTaskActivity('in_review', [{
      id: 1, agentRef: 'ada', payload: JSON.stringify({ actAsRole: 'product-manager' }),
      status: 'completed', produced: true, createdAt: at(10), completedAt: at(11),
    }], [{ executionId: 1, path: 'PRD.md' }], true);

    expect(summary).toMatchObject({
      executionsCount: 1,
      lastExecutionAgentRef: 'ada',
      lastExecutionRole: 'product-manager',
      lastExecutionProducedCode: false,
      lastCoderRunProducedCode: false,
      staleImplementation: true,
    });
    expect(summary.pullRequestActor).toMatchObject({ role: 'product-manager', inferred: true });
  });

  it('clears staleness only when a coder execution changed non-documentation files', () => {
    const summary = summarizeTaskActivity('in_review', [
      { id: 2, agentRef: 'bob', payload: JSON.stringify({ roleKey: 'developer' }), status: 'completed', produced: true, createdAt: at(12), completedAt: at(13) },
      { id: 1, agentRef: 'ada', payload: JSON.stringify({ actAsRole: 'business-analyst' }), status: 'completed', produced: true, createdAt: at(10), completedAt: at(11) },
    ], [
      { executionId: 1, path: 'specs/tasks/task-1.md' },
      { executionId: 2, path: 'api/src/application/example.ts' },
    ], true);

    expect(summary.lastCoderRunProducedCode).toBe(true);
    expect(summary.lastCoderExecutionAt).toBe(at(13).toISOString());
    expect(summary.staleImplementation).toBe(false);
    expect(summary.pullRequestActor).toMatchObject({ executionId: 2, role: 'developer' });
  });

  it('normalizes role payloads and documentation paths', () => {
    expect(executionRole(JSON.stringify({ role: 'engineer' }))).toBe('engineer');
    expect(executionRole('not-json')).toBeNull();
    expect(isCodePath('README.md')).toBe(false);
    expect(isCodePath('docs/guide.mdx')).toBe(false);
    expect(isCodePath('frontend/src/App.tsx')).toBe(true);
  });

  it('reports whether the latest coder run produced code without forgetting older delivery evidence', () => {
    const summary = summarizeTaskActivity('in_review', [
      { id: 2, agentRef: 'bob', payload: JSON.stringify({ role: 'developer' }), status: 'completed', produced: true, createdAt: at(14), completedAt: at(15) },
      { id: 1, agentRef: 'bob', payload: JSON.stringify({ role: 'developer' }), status: 'completed', produced: true, createdAt: at(12), completedAt: at(13) },
    ], [
      { executionId: 2, path: 'specs/tasks/task-1.md' },
      { executionId: 1, path: 'api/src/example.ts' },
    ], true);

    expect(summary.lastCoderRunProducedCode).toBe(false);
    expect(summary.staleImplementation).toBe(false);
  });
});
