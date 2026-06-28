import { describe, it, expect } from 'vitest';
import { compile } from './index';
import { mergeSpecs } from './mergeSpecs';
import type { LlmComplete } from './types';
import type { WorkflowDefinition } from '../../domain/workflowGraph';
import type { ToolResult } from '../tools/toolTypes';

describe('compile() registry', () => {
  it('prose: extracts identity from a plain-language need (injected LLM)', async () => {
    const llm: LlmComplete = async () =>
      '{"name":"Billing Triage Agent","title":"Support triage","bio":"Triages billing tickets.","skills":["triage","refunds"]}';
    const spec = await compile({ modality: 'prose', text: 'an agent that triages billing tickets from our docs' }, { llm });
    expect(spec.identity.name).toBe('Billing Triage Agent');
    expect(spec.identity.skills).toEqual(['triage', 'refunds']);
    expect(spec.model?.autoRoute).toBe(true);
    expect(spec.surfaces).toContain('cloud-durable');
  });

  it('prose: degrades to a usable spec when no LLM is supplied (never throws)', async () => {
    const spec = await compile({ modality: 'prose', text: 'answer support questions' });
    expect(spec.identity.name).toBeTruthy();
    expect(spec.identity.bio).toContain('answer support');
  });

  it('prose: degrades to a usable spec when extraction returns garbage', async () => {
    const llm: LlmComplete = async () => 'not json at all';
    const spec = await compile({ modality: 'prose', text: 'do a thing' }, { llm });
    expect(spec.identity.name).toBe('Custom Agent');
  });

  it('persona: lowers compiled directives + exec levers onto the spec', async () => {
    const spec = await compile({
      modality: 'persona',
      directives: ['Be methodical and verify before done.'],
      execParams: { thinkLevel: 'high', temperature: 0.3 },
    });
    expect(spec.persona?.directives).toEqual(['Be methodical and verify before done.']);
    expect(spec.persona?.execParams?.thinkLevel).toBe('high');
  });

  it('process-chart: lowers a graph into ordered steps + workflow surface', async () => {
    const def: WorkflowDefinition = {
      nodes: [
        { id: 'n1', kind: 'trigger', label: 'Start', position: { x: 0, y: 0 }, config: {} },
        { id: 'n2', kind: 'agent', label: 'Do work', position: { x: 1, y: 0 }, config: { agentRole: 'engineer' } },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    };
    const spec = await compile({ modality: 'process-chart', definition: def });
    expect((spec.steps?.length ?? 0)).toBeGreaterThan(0);
    expect(spec.surfaces).toContain('workflow-node');
  });

  it('diagnostic: turns recommendations into a chained improvement process', async () => {
    const findings: ToolResult = {
      headline: 'Maturity: developing',
      summary: 'Two gaps found.',
      metrics: [],
      recommendations: [
        { title: 'Add CI gates', detail: 'Block merges on red tests.' },
        { title: 'Adopt code review', detail: 'Require one approval.' },
      ],
    };
    const spec = await compile({ modality: 'diagnostic', findings, subject: 'Delivery' });
    expect(spec.steps).toHaveLength(2);
    const steps = spec.steps as Array<{ nodeId: string; dependsOnNodeIds: string[] }>;
    expect(steps[1]!.dependsOnNodeIds).toEqual(['diag-step-1']);
    expect(spec.identity.name).toContain('Delivery');
  });

  it('policy: lowers gates onto the spec', async () => {
    const spec = await compile({
      modality: 'policy',
      gates: [{ id: 'g1', effect: 'block', tool: 'shell', reason: 'no shell in prod' }],
    });
    expect(spec.policy?.gates).toHaveLength(1);
  });

  it('stacks modalities into ONE spec (dataset + persona + policy merge)', async () => {
    const spec = await compile([
      { modality: 'dataset', identity: { name: 'Support Bot', title: 'Support' }, modelRef: 'builderforce/workforce-42', recalledContext: 'Refunds within 30 days.' },
      { modality: 'persona', directives: ['Be warm and concise.'], execParams: { temperature: 0.7 } },
      { modality: 'policy', gates: [{ id: 'g1', effect: 'require-approval', tool: 'issue_refund' }] },
    ]);
    expect(spec.identity.name).toBe('Support Bot');
    expect(spec.model?.ref).toBe('builderforce/workforce-42');
    expect(spec.memory?.recalledContext).toContain('Refunds');
    expect(spec.persona?.directives).toContain('Be warm and concise.');
    expect(spec.policy?.gates).toHaveLength(1);
  });

  it('throws on an empty need list', async () => {
    await expect(compile([])).rejects.toThrow();
  });
});

describe('mergeSpecs', () => {
  it('returns the single spec unchanged', () => {
    const s = { identity: { name: 'A' } };
    expect(mergeSpecs([s])).toBe(s);
  });
  it('later identity wins; directives accumulate', () => {
    const merged = mergeSpecs([
      { identity: { name: 'A' }, persona: { directives: ['x'] } },
      { identity: { name: 'B' }, persona: { directives: ['y'] } },
    ]);
    expect(merged.identity.name).toBe('B');
    expect(merged.persona?.directives).toEqual(['x', 'y']);
  });
});
