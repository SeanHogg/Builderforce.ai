import { describe, it, expect } from 'vitest';
import { renderTemplate, dispositionFromDeps } from './cloudExecutor';

describe('renderTemplate', () => {
  it('substitutes {{input}} with the upstream text', () => {
    expect(renderTemplate('Summarize: {{input}}', 'hello world')).toBe('Summarize: hello world');
  });
  it('tolerates inner whitespace and multiple occurrences', () => {
    expect(renderTemplate('{{ input }} / {{input}}', 'X')).toBe('X / X');
  });
  it('leaves text without the token unchanged', () => {
    expect(renderTemplate('no placeholder here', 'X')).toBe('no placeholder here');
  });
});

describe('dispositionFromDeps (prune/cascade semantics)', () => {
  it('runs a root task with no dependencies', () => {
    expect(dispositionFromDeps([])).toBe('run');
  });
  it('runs once every dependency has completed', () => {
    expect(dispositionFromDeps(['completed', 'completed'])).toBe('run');
  });
  it('waits while any dependency is still pending/running', () => {
    expect(dispositionFromDeps(['completed', 'pending'])).toBe('wait');
    expect(dispositionFromDeps(['running'])).toBe('wait');
  });
  it('fails when any dependency failed (real error propagates)', () => {
    expect(dispositionFromDeps(['completed', 'failed'])).toBe('fail');
  });
  it('cancels (not fails) when an upstream filter pruned the path', () => {
    expect(dispositionFromDeps(['completed', 'cancelled'])).toBe('cancel');
  });
  it('prefers fail over cancel when both are present', () => {
    // A genuine error outranks a prune so the workflow still ends `failed`.
    expect(dispositionFromDeps(['failed', 'cancelled'])).toBe('fail');
  });
  it('cancels a join as soon as one path is pruned, even if another is still pending', () => {
    // The prune outranks the still-pending path so the cone collapses promptly.
    expect(dispositionFromDeps(['cancelled', 'pending'])).toBe('cancel');
  });
});
