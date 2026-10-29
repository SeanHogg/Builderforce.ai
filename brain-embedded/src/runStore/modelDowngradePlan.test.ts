import { describe, expect, it } from 'vitest';
import { priceBookFromPrices } from '@builderforce/model-catalog';
import type { BrainTraceEvent } from '../brainTriage';
import { MODEL_DOWNGRADE_LABEL, modelDowngradeEvent } from './modelDowngrade';

/**
 * PRD 35 E7: an AUTO-ROUTED plan-phase turn that lands on a Flash-class model leaves a
 * trace even when no BYO signal rode the turn — the tier rule is the preflight's.
 */
const TS = '2026-10-28T00:00:00.000Z';
const BOOK = priceBookFromPrices([
  ['acme/flash', { input: 1e-7, output: 4e-7 }],
  ['acme/sonnet', { input: 3e-6, output: 1.5e-5 }],
]);

describe('modelDowngradeEvent — auto-routed plan phase on a Flash-class model', () => {
  it('fires once per served model while the run has changed no code', () => {
    const e = modelDowngradeEvent({ requested: 'default', resolved: 'acme/flash', planPhase: true, book: BOOK, step: 0, ts: TS, events: [] })!;
    expect(e.label).toBe(MODEL_DOWNGRADE_LABEL);
    expect(e.args).toEqual({ requestedModel: 'default', model: 'acme/flash', step: 0, planTier: 'STANDARD' });
    expect(String(e.result)).toContain('Flash-class');
    const events: BrainTraceEvent[] = [e];
    expect(modelDowngradeEvent({ requested: 'default', resolved: 'acme/flash', planPhase: true, book: BOOK, step: 1, ts: TS, events })).toBeNull();
  });

  it('stays quiet after code changed, for an agentic-tier model, and for an unpriced one', () => {
    expect(modelDowngradeEvent({ requested: 'default', resolved: 'acme/flash', planPhase: false, book: BOOK, step: 3, ts: TS, events: [] })).toBeNull();
    expect(modelDowngradeEvent({ requested: 'default', resolved: 'acme/sonnet', planPhase: true, book: BOOK, step: 0, ts: TS, events: [] })).toBeNull();
    expect(modelDowngradeEvent({ requested: 'default', resolved: 'local/qwen-7b', planPhase: true, book: BOOK, step: 0, ts: TS, events: [] })).toBeNull();
  });

  it('a BYO signal still names the account, not the tier', () => {
    const e = modelDowngradeEvent({ requested: 'default', resolved: 'acme/flash', byoUnresolved: 'anthropic:expired', planPhase: true, book: BOOK, step: 0, ts: TS, events: [] })!;
    expect(e.args).toEqual({ requestedModel: 'default', model: 'acme/flash', step: 0, byoUnresolved: 'anthropic:expired' });
  });
});
