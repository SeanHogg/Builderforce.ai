import { describe, expect, it } from 'vitest';
import { sanitizeCreationObjectPatch } from './creationObjectRegistry';
import { emptyShellProblem } from './creationObjectAuthorship';
import { salvageUnrecognizedContent } from './unrecognizedContentSalvage';

/** The two calls refused on 2026-09-27 (ui 2026.9.39) for "show me evermind training". */
function addPath(kind: 'evermind' | 'trainingRun', fields: Record<string, unknown>, title: string) {
  const authored = sanitizeCreationObjectPatch(kind, { ...fields, title }) as Record<string, unknown>;
  return salvageUnrecognizedContent(kind, fields, authored);
}

describe('salvageUnrecognizedContent', () => {
  it('keeps an evermind authored under undeclared names instead of refusing it', () => {
    const { authored, folded } = addPath('evermind', {
      description: 'Evermind self-learning model training configuration',
      status: 'draft',
      trainingConfig: { baseModel: 'evermind-base', epochs: 10, learningRate: 0.001 },
      evaluationConfig: { metrics: ['accuracy', 'f1', 'perplexity'], validationSplit: 0.2 },
    }, 'Evermind Training Setup');
    expect(emptyShellProblem('evermind', authored)).toBeNull();
    expect(folded).toEqual(['description', 'trainingConfig', 'evaluationConfig']);
    expect(authored.content).toContain('**Training config**');
    expect(authored.content).toContain('**Learning rate:** 0.001');
    expect(authored.content).toContain('accuracy, f1, perplexity');
  });

  it('keeps a trainingRun authored under undeclared names instead of refusing it', () => {
    const { authored } = addPath('trainingRun', {
      modelId: '278b60f4', status: 'pending', config: { epochs: 10, optimizer: 'adamw' }, metrics: {},
    }, 'Evermind Training Run');
    expect(emptyShellProblem('trainingRun', authored)).toBeNull();
    expect(authored.content).toContain('**Optimizer:** adamw');
    // An empty object is not work; it is not rendered.
    expect(authored.content).not.toContain('Metrics');
  });

  it('still leaves a genuinely title-only object refused', () => {
    const { authored, folded } = addPath('evermind', {}, 'Evermind');
    expect(folded).toEqual([]);
    expect(emptyShellProblem('evermind', authored)).toContain('empty shell');
  });

  it('never carries a sensitive key into content', () => {
    const { authored } = addPath('evermind', { apiKey: 'sk-live', notes: 'Retrain weekly' }, 'Evermind');
    expect(authored.content).toContain('Retrain weekly');
    expect(authored.content).not.toContain('sk-live');
  });

  it('does not overwrite content the model did author', () => {
    const { authored, folded } = addPath('evermind', { content: 'Real body', description: 'Other' }, 'Evermind');
    expect(folded).toEqual([]);
    expect(authored.content).toBe('Real body');
  });
});
