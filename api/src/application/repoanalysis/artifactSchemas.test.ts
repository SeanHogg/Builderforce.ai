import { describe, it, expect } from 'vitest';
import { artifactResponseFormat } from './artifactSchemas';
import { analysisPlanConfig, partitionRetryableArtifacts, planAllowsArtifact } from './analysisPlan';
import { ARTIFACT_KINDS, FREE_ARTIFACT_KINDS } from './types';

/**
 * The Architect's generation contract. Two invariants are worth pinning:
 *
 *  1. Every artifact kind gets a schema that OpenAI-family strict mode will
 *     actually accept — every object closed, every property required. A schema
 *     that violates that is not rejected loudly; the gateway silently downgrades
 *     it back to json_object, which is the exact behaviour these schemas exist
 *     to replace, so the regression would be invisible in production.
 *  2. Plan entitlement has ONE answer. The runner and the retry path both ask
 *     "does this plan cover this kind?", and a retry that disagreed with the run
 *     would either re-spend tokens on a withheld kind or refuse to fill it in.
 */

/** Walk every `type: 'object'` node in a schema, however deeply nested. */
function objectNodes(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!node || typeof node !== 'object') return out;
  const n = node as Record<string, unknown>;
  if (n.type === 'object') out.push(n);
  for (const value of Object.values(n)) {
    if (Array.isArray(value)) value.forEach((v) => objectNodes(v, out));
    else objectNodes(value, out);
  }
  return out;
}

describe('artifactResponseFormat', () => {
  it('returns a strict json_schema envelope for every artifact kind', () => {
    for (const kind of ARTIFACT_KINDS) {
      const rf = artifactResponseFormat(kind);
      expect(rf.type).toBe('json_schema');
      expect(rf.json_schema.strict).toBe(true);
      expect(rf.json_schema.name).toMatch(/^[a-z0-9_]+$/);
      expect(rf.json_schema.schema.type).toBe('object');
    }
  });

  it('names each schema distinctly so a trace says which artifact was generated', () => {
    const names = ARTIFACT_KINDS.map((k) => artifactResponseFormat(k).json_schema.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('closes every object and requires every property — what strict mode demands', () => {
    for (const kind of ARTIFACT_KINDS) {
      for (const node of objectNodes(artifactResponseFormat(kind).json_schema.schema)) {
        expect(node.additionalProperties, `${kind}: additionalProperties`).toBe(false);
        const properties = Object.keys((node.properties ?? {}) as Record<string, unknown>);
        expect(node.required, `${kind}: required`).toEqual(properties);
      }
    }
  });

  it('constrains the fields the renderer branches on to their real enums', () => {
    const diagnostic = artifactResponseFormat('diagnostic').json_schema.schema as
      { properties: { suggestedModality: { enum: string[] } } };
    expect(diagnostic.properties.suggestedModality.enum).toEqual(['designer', 'architect', 'developer']);

    const recommendation = artifactResponseFormat('recommendation').json_schema.schema as
      { properties: { recommendation: { enum: string[] } } };
    expect(recommendation.properties.recommendation.enum).toEqual(['brownfield', 'greenfield', 'parallel']);
  });

  it('keeps the principles schema carrying the four scores the diagnostic scorer reads', () => {
    const schema = artifactResponseFormat('principles').json_schema.schema as
      { properties: Record<string, { properties: Record<string, unknown> }> };
    expect(Object.keys(schema.properties)).toEqual(['dry', 'solid', 'ddd', 'patterns']);
    // Only `patterns` names the concrete patterns it found — the scorer reads it.
    expect(Object.keys(schema.properties.patterns!.properties)).toContain('detected');
    expect(Object.keys(schema.properties.dry!.properties)).not.toContain('detected');
  });
});

describe('analysisPlanConfig', () => {
  it('caps Free to the two artifacts every plan produces', () => {
    expect(analysisPlanConfig('free').artifactKinds).toEqual(FREE_ARTIFACT_KINDS);
    expect(analysisPlanConfig('free').artifactKinds).not.toContain('arch_4plus1');
  });

  it('gives paid plans the whole report and a far larger token budget', () => {
    for (const plan of ['pro', 'teams']) {
      expect(analysisPlanConfig(plan).artifactKinds).toEqual([...ARTIFACT_KINDS]);
      expect(analysisPlanConfig(plan).tokenBudget).toBeGreaterThan(analysisPlanConfig('free').tokenBudget);
    }
  });

  it('treats an unknown plan string as Free rather than as entitled', () => {
    expect(analysisPlanConfig('enterprise-ultra').artifactKinds).toEqual(FREE_ARTIFACT_KINDS);
  });

  it('answers entitlement per kind consistently with the kind list', () => {
    for (const kind of ARTIFACT_KINDS) {
      expect(planAllowsArtifact('free', kind)).toBe(FREE_ARTIFACT_KINDS.includes(kind));
      expect(planAllowsArtifact('pro', kind)).toBe(true);
    }
  });
});

describe('partitionRetryableArtifacts', () => {
  /** A Free run: the two funded kinds landed, the other four were withheld. */
  const freeRun = [
    { kind: 'diagnostic', status: 'complete' },
    { kind: 'recommendation', status: 'complete' },
    { kind: 'business', status: 'skipped' },
    { kind: 'arch_4plus1', status: 'skipped' },
    { kind: 'antipatterns', status: 'skipped' },
    { kind: 'principles', status: 'skipped' },
  ];

  it('never re-queues an artifact that already landed', () => {
    const { retryable } = partitionRetryableArtifacts(freeRun, 'free');
    expect(retryable).not.toContain('diagnostic');
    expect(retryable).not.toContain('recommendation');
  });

  it('offers a Free run nothing, and locks the four it cannot afford', () => {
    const { retryable, locked } = partitionRetryableArtifacts(freeRun, 'free');
    expect(retryable).toEqual([]);
    expect(locked).toEqual(['business', 'arch_4plus1', 'antipatterns', 'principles']);
  });

  it('turns the same withheld run into four retryable kinds once the plan covers them', () => {
    const { retryable, locked } = partitionRetryableArtifacts(freeRun, 'pro');
    expect(retryable).toEqual(['business', 'arch_4plus1', 'antipatterns', 'principles']);
    expect(locked).toEqual([]);
  });

  it('retries a failed artifact regardless of plan — a crash is not an entitlement', () => {
    const rows = [
      { kind: 'diagnostic', status: 'complete' },
      { kind: 'recommendation', status: 'failed' },
    ];
    expect(partitionRetryableArtifacts(rows, 'free').retryable).toEqual(['recommendation']);
  });

  it('returns kinds in pipeline order, not row order, so priors are generated first', () => {
    const rows = [
      { kind: 'principles', status: 'failed' },
      { kind: 'diagnostic', status: 'failed' },
    ];
    expect(partitionRetryableArtifacts(rows, 'pro').retryable).toEqual(['diagnostic', 'principles']);
  });

  it('has nothing to say about a run whose artifacts were never written', () => {
    expect(partitionRetryableArtifacts([], 'pro')).toEqual({ retryable: [], locked: [] });
  });
});
