import { describe, it, beforeEach } from 'vitest';
import {
  buildInlineSuggestionPrompt,
  generateInlineSuggestions,
  buildAutoFillPrompt,
  proposeAutoFill,
  detectGaps,
  acceptFeedback,
  wouldSettingsChange,
  getAiMetrics,
} from './aiAssistance.service';
import type { AiGenerator, RuntimeState } from './aiAssistance.service';

// Mock generator for unit tests
function mockGenerator(content: string, embedResult: number[] | null = null): AiGenerator {
  return {
    embed: async () => ({ embedding: embedResult ?? [1, 2, 3], tokenCount: 3 }),
    complete: async () => ({ id: 'mock-1', content, finishReason: 'stop' }),
  };
}

describe('buildInlineSuggestionPrompt', () => {
  it('includes system field constraint, context, and sensibility proxy', async () => {
    const ctx = {
      sourceField: 'project.priority',
      fieldTitle: 'Priority',
      currentValue: 'medium',
      recordId: '1',
      recordType: 'Project',
      siblingFields: {},
    };
    const prompt = await buildInlineSuggestionPrompt(ctx, null);
    expect(prompt).toContain('AI field-suggestion helper');
    expect(prompt).toContain('Priority');
    expect(prompt).toContain('medium');
    expect(prompt).toContain('Project');
  });

  it('respects sensitive PII opt-out constraint', async () => {
    const ctx = {
      sourceField: 'user.password',
      fieldTitle: 'Password',
      currentValue: 'Secret123!',
      recordId: '1',
      recordType: 'User',
      isSensitive: true,
      tenantOptedIn: false,
      siblingFields: {},
    };
    const prompt = await buildInlineSuggestionPrompt(ctx, null);
    expect(prompt).toContain('Do NOT suggest PII or sensitive values');
  });
});

describe('generateInlineSuggestions', () => {
  let mockGen: AiGenerator;

  beforeEach(() => {
    mockGen = mockGenerator(
      JSON.stringify(['High', 'Urgent', 'Critical']),
    );
  });

  it('returns valid suggestion objects with URI IDs', async () => {
    const ctx = {
      sourceField: 'ticket.priority',
      fieldTitle: 'Priority',
      currentValue: 'medium',
      recordId: 'proj-1',
      recordType: 'Ticket',
      generator: mockGen,
      tenantId: 1,
      siblingFields: {},
    };
    const result = await generateInlineSuggestions(ctx);
    expect(result.suggestions.length).toBeGreaterThan(0);
    const s = result.suggestions[0];
    expect(s).toMatchObject({
      id: expect.stringContaining('ticket.priority:proj-1:'),
      suggestion: expect.any(String),
      confidence: 'medium',
      rationale: 'LLM-generated inline suggestion',
    });
  });

  it('caps suggestions to 4 candidates for P95 latency', async () => {
    const more = Array.from({ length: 8 }, (_, i) => `Candidate ${i}`);
    const mockGenWithMore = mockGenerator(
      JSON.stringify([...more, 'Candidate 9']),
    );
    const ctx = {
      sourceField: 'field',
      fieldTitle: 'Field',
      currentValue: 'test',
      recordId: '1',
      recordType: 'Record',
      generator: mockGenWithMore,
      tenantId: 1,
      siblingFields: {},
    };
    const result = await generateInlineSuggestions(ctx);
    expect(result.suggestions).toHaveLength(4);
  });

  it('suppresses suggestions for sensitive fields without tenant opt-in', async () => {
    const ctx = {
      sourceField: 'ssn',
      fieldTitle: 'SSN',
      currentValue: '123-45-6789',
      recordId: '1',
      recordType: 'Person',
      fieldConfig: { isSensitive: true, tenantOptedIn: false },
      generator: mockGen,
      tenantId: 1,
      siblingFields: {},
    };
    const result = await generateInlineSuggestions(ctx);
    expect(result.suggestions).toHaveLength(0);
    expect(result.suppressed).toBe(true);
  });
});

describe('isScopeEnabled', () => {
  const basicPrefs: Parameters<typeof isScopeEnabled>[0] = {
    accountEnabled: true,
    recordType: true,
    field: {},
  };

  it('returns false if account is disabled', () => {
    const result = isScopeEnabled(
      { ...basicPrefs, accountEnabled: false },
      'account',
      'ticket',
    );
    expect(result).toBe(false);
  });

  it('respects record-type level disable', () => {
    const result = isScopeEnabled(
      basicPrefs,
      'record-type',
      'ticket',
      undefined,
    );
    expect(result).toBe(true);
  });

  it('respects field-level disable', () => {
    const result = isScopeEnabled(
      { ...basicPrefs, field: { 'project.priority': false } },
      'field',
      'priority',
      'project.priority',
    );
    expect(result).toBe(false);
  });

  it('uses recordType default for missing field config', () => {
    const result = isScopeEnabled(basicPrefs, 'field', 'priority', 'field');
    expect(result).toBe(true);
  });
});

describe('buildAutoFillPrompt', () => {
  it('includes context and strict constraints', async () => {
    const ctx = {
      sourceField: 'summary',
      fieldTitle: 'Summary',
      recordId: '1',
      recordType: 'Item',
    };
    const prompt = await buildAutoFillPrompt(ctx, null);
    expect(prompt).toContain('Summary');
    expect(prompt).toContain('Constraints (AUTO-FILL ONLY)');
    expect(prompt).toContain('Never overwrite an already-entered value');
  });

  it('pleads set constraints via prompt not code enforcement', async () => {
    const ctx = {
      sourceField: 'priority',
      fieldTitle: 'Priority',
      currentValue: 'medium',
      recordId: '1',
      recordType: 'Ticket',
    };
    const prompt = await buildAutoFillPrompt(ctx, null);
    expect(prompt).toContain('never overwrite an already-entered value');
  });
});

describe('proposeAutoFill', () => {
  let mockGen: AiGenerator;

  beforeEach(() => {
    mockGen = mockGenerator('High Priority for this issue');
  });

  it('returns successful proposition with rationale', async () => {
    const ctx = {
      sourceField: 'priority',
      fieldTitle: 'Priority',
      currentValue: '',
      recordId: '1',
      recordType: 'Ticket',
      generator: mockGen,
      tenantId: 1,
      siblingFields: {},
    };
    const result = await proposeAutoFill(ctx);
    expect(result.proposal).toBeDefined();
    expect(result.proposal?.value).not.toBe('');
    expect(result.proposal?.confidence).toMatch('high');
    expect(result.proposal?.rationale).toContain('LLM-generated auto-fill');
    expect(result.suppressed).toBeFalsy();
  });

  it('suppresses auto-fill for sensitive fields without opt-in', async () => {
    const ctx = {
      sourceField: 'password',
      fieldTitle: 'Password',
      currentValue: 'Secret',
      recordId: '1',
      recordType: 'User',
      fieldConfig: { isSensitive: true, tenantOptedIn: false },
      generator: mockGen,
      tenantId: 1,
      siblingFields: {},
    };
    const result = await proposeAutoFill(ctx);
    expect(result.proposal).toBeNull();
    expect(result.suppressed).toEqual('sensitiveOptOut');
  });

  it('outputs placeholder when no value available from LLM', async () => {
    const ctx = {
      sourceField: 'custom_field',
      fieldTitle: 'Custom',
      currentValue: '',
      recordId: '1',
      recordType: 'Record',
      generator: mockGenerator('---'),
      tenantId: 2,
      siblingFields: {},
    };
    const result = await proposeAutoFill(ctx);
    expect(result.proposal?.value).toBe('');
  });
});

describe('detectGaps', () => {
  it('detects empty fields as blocking gaps when gap rules are on', async () => {
    const ctx = {
      fieldTitle: 'title',
      currentValue: '',
      recordType: 'Ticket',
    };
    const result = await detectGaps(ctx, null);
    const gap = result.gaps.find((g) => g.fieldId === 'title');
    expect(gap).toBeDefined();
    expect(gap?.severity).toBe('blocking');
    expect(gap?.action).toBe('jump');
  });

  it('respects gapRulesEnabled = false', async () => {
    const ctx = {
      fieldTitle: 'custom',
      currentValue: 'test',
      recordType: 'Item',
      fieldConfig: {
        suggestionsEnabled: false,
        gapRulesEnabled: false,
      },
    };
    const result = await detectGaps(ctx, null);
    expect(result.gaps).toHaveLength(0);
  });

  it('flags frequency vocabulary as warning gap for rich field verbosity', async () => {
    const ctx = {
      fieldTitle: 'name',
      currentValue: 'Annual quarterly monthly meeting plan',
      recordType: 'Reset',
    };
    const result = await detectGaps(ctx, null);
    const warns = result.gaps.filter((g) => g.severity === 'warning');
    expect(warns.length).toBeGreaterThan(0);
    const w = warns.find((g) => g.action === 'info');
    expect(w?.description).toContain('frequency keyword');
  });

  it('does not flag irrelevant words as frequency gap', async () => {
    const ctx = {
      fieldTitle: 'description',
      currentValue: 'The annual meeting happened once a quarter',
      recordType: 'Event',
    };
    const result = await detectGaps(ctx, null);
    const indicates = result.gaps.filter((g) => g.action === 'info');
    expect(indicates.find((g) => g.description.includes('frequency'))).toBeUndefined();
  });
});

describe('acceptFeedback', () => {
  let state: RuntimeState;

  beforeEach(() => {
    state = { runId: 'run-1', rejectedSuggestions: new Map() };
  });

  it('stores rejection for the correct runId and suggestionId', () => {
    acceptFeedback(state, {
      runId: 'run-1',
      suggestionId: 'sugg-1',
      rating: 'thumbs-down',
    });
    const runMap = state.rejectedSuggestions.get('run-1');
    expect(runMap?.has('sugg-1')).toBe(true);
  });

  it('creates a nested map if the runId does not exist', () => {
    acceptFeedback(
      { runId: 'run-new', rejectedSuggestions: new Map() },
      {
        runId: 'run-new',
        suggestionId: 'snew-1',
        rating: 'thumbs-down',
      },
    );
    expect(state.rejectedSuggestions.get('run-new')?.size).toBe(1);
  });
});

describe('wouldSettingsChange', () => {
  const baseline = { accountEnabled: true, recordType: true, field: {} };

  it('flags account-level toggle as a change', () => {
    const result = wouldSettingsChange(baseline, { ...baseline, accountEnabled: false });
    expect(result).toBe(true);
  });

  it('ignores identical snapshots', () => {
    const result = wouldSettingsChange(baseline, baseline);
    expect(result).toBe(false);
  });

  it('flags record-type toggle as a change', () => {
    const result = wouldSettingsChange(baseline, { ...baseline, recordType: false });
    expect(result).toBe(true);
  });

  it('flags field toggle as a change', () => {
    const changed: Parameters<typeof wouldSettingsChange>[1] = {
      ...baseline,
      field: { 'field.two': false },
    };
    const result = wouldSettingsChange(baseline, changed);
    expect(result).toBe(true);
  });
});

describe('getAiMetrics', () => {
  it('returns plausible metric ranges (0-100)', () => {
    const metrics = getAiMetrics();
    expect(metrics.acceptanceRate).toBeGreaterThanOrEqual(0);
    expect(metrics.acceptanceRate).toBeLessThanOrEqual(100);
    expect(metrics.rejectionRate).toBeGreaterThanOrEqual(0);
    expect(metrics.rejectionRate).toBeLessThanOrEqual(100);
    expect(metrics.editAfterAcceptRate).toBeGreaterThanOrEqual(0);
    expect(metrics.editAfterAcceptRate).toBeLessThanOrEqual(100);
  });

  it('includes lastUpdated which is reasonably recent', () => {
    const metrics = getAiMetrics();
    const updated = new Date(metrics.lastUpdated);
    const now = Date.now();
    expect(updated.getTime()).toBeLessThan(now + 60000); // within a minute
  });
});