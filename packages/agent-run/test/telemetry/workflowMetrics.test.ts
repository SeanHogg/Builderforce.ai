import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { WORKFLOW_STAGES } from '../../src/telemetry/workflowMetrics.js';
import { beginWorkflowStage, measureWorkflow, summarizeWorkflow, workflowMetricOf, type WorkflowMetric } from '../../src/telemetry/workflowMetrics.js';
import { tapEvents } from '../../src/tapEvents.js';
import { openRun } from '../../src/openRun.js';
import type { RunPorts } from '../../src/contract.js';
import { TEST_POLICY, TEST_TASK, schemas } from '../support/policyContext.js';

const scope = { runId: 'run-1', entryPoint: 'vscode', step: 2 };

describe('workflow measurements', () => {
  it('covers every node in the implemented-workflow diagram', () => {
    const map = readFileSync(new URL('../../../../docs/specs/_scratch-agent-pipeline-map.md', import.meta.url), 'utf8');
    const diagram = map.split('## 5. Implemented workflow')[1]!.split('```mermaid')[1]!.split('```')[0]!;
    const ids = [...diagram.matchAll(/\b([A-Z][A-Za-z]*)[\[({]/g)].map((m) => m[1]!.toLowerCase());
    expect([...new Set(ids)].sort()).toEqual([...WORKFLOW_STAGES].sort());
  });
  it('measures exactly once, deduplicates durable/live copies, and preserves unknown durations', () => {
    const metrics: WorkflowMetric[] = [];
    let time = 100;
    const done = beginWorkflowStage({ workflow: (m) => { metrics.push(m); } }, scope, 'dispatch', () => time);
    time = 125;
    done('failed');
    done('completed');
    expect(metrics).toHaveLength(2);
    const report = summarizeWorkflow([metrics[1]!, metrics[0]!, ...metrics]);
    expect(report.stages.find((s) => s.stage === 'dispatch')).toMatchObject({ attempts: 1, failed: 1, totalMs: 25, maxMs: 25 });
    expect(report.stages.find((s) => s.stage === 'grade')).toMatchObject({ status: 'not_observed', totalMs: null });
    expect(report.runIds).toEqual(['run-1']);
  });

  it('reports incomplete captures without claiming that a stage succeeded or is still running', () => {
    const metrics: WorkflowMetric[] = [];
    beginWorkflowStage({ workflow: (m) => { metrics.push(m); } }, scope, 'kernel');
    expect(summarizeWorkflow(metrics).stages.find((s) => s.stage === 'kernel')).toMatchObject({ status: 'incomplete', completed: 0, running: 1, totalMs: null });
  });

  it('retains the actual exception and identifies cancellation', async () => {
    const metrics: WorkflowMetric[] = [];
    const controller = new AbortController();
    const failure = new Error('stopped');
    await expect(measureWorkflow({ workflow: (m) => { metrics.push(m); } }, scope, 'dispatch', () => {
      controller.abort(); throw failure;
    }, undefined, controller.signal)).rejects.toBe(failure);
    expect(metrics.at(-1)?.status).toBe('cancelled');
    const resolved = new AbortController();
    expect(await measureWorkflow({ workflow: (m) => { metrics.push(m); } }, scope, 'dispatch', () => {
      resolved.abort(); return { stopped: true };
    }, undefined, resolved.signal)).toEqual({ stopped: true });
    expect(metrics.at(-1)?.status).toBe('cancelled');
  });

  it('a broken metrics sink cannot fail an action or cause it to run twice', async () => {
    const action = vi.fn(async () => 42);
    expect(await measureWorkflow({ workflow: async () => { throw new Error('offline'); } }, scope, 'outcome', action)).toBe(42);
    expect(action).toHaveBeenCalledOnce();
    expect(await measureWorkflow({ workflow() {} }, scope, 'grade', async () => 43, undefined, undefined, () => { throw new Error('bad counter'); })).toBe(43);
  });

  it('ignores malformed traces and sanitizes numeric counters', () => {
    expect(workflowMetricOf({ stage: 'kernel' })).toBeNull();
    expect(workflowMetricOf({ schemaVersion: 1, ...scope, id: 'bad', stage: 'grade', status: 'completed', startedAt: 10, endedAt: 5, durationMs: -5 })).toBeNull();
    const metric = workflowMetricOf({ schemaVersion: 1, ...scope, id: 'ok', stage: 'grade', status: 'completed', startedAt: 10, endedAt: 20, durationMs: 10, counters: { assigned: 2, secret: 'omit', infinite: Infinity } });
    expect(metric?.counters).toEqual({ assigned: 2 });
  });

  it('event taps preserve the separate workflow channel', () => {
    const workflow = vi.fn();
    const metrics: WorkflowMetric[] = [];
    beginWorkflowStage({ workflow: (m) => { metrics.push(m); } }, scope, 'route');
    tapEvents({ emit() {}, workflow }, {}).workflow!(metrics[0]!);
    expect(workflow).toHaveBeenCalledWith(metrics[0]);
  });

  it('the production entry records stages without changing semantic events and does not repeat opening on resume', async () => {
    const metrics: WorkflowMetric[] = [];
    const events: string[] = [];
    let turns = 0;
    const ports: RunPorts = {
      model: { complete: async () => ++turns === 1 ? { content: 'Reading.', toolCalls: [{ id: 'call-1', name: 'read_file', arguments: '{}' }] } : { content: 'The answer.' } },
      platform: { closed: true, schemas: () => schemas(['read_file']), selection: { query: '', limit: 50, required: new Set<string>() }, execute: async () => ({ data: 'read' }) },
      store: { load: () => undefined, save() { throw new Error('store unavailable'); } }, context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
      human: { ask: async () => ({ kind: 'paused' }) },
      events: { emit: (e) => { events.push(e.kind); }, workflow: (m) => { metrics.push(m); }, outcome() {} },
    };
    const input = { task: { ...TEST_TASK, runId: 'resume-1', prompt: 'Read the file' }, policy: TEST_POLICY, ports };
    const first = await openRun({ ...input, maxSteps: 1 });
    expect(first.kind, first.kind === 'failed' ? first.reason : '').toBe('yielded');
    const second = await openRun({ ...input, resume: first.state });
    expect(second.kind).toBe('finished');
    const summary = summarizeWorkflow(metrics);
    for (const stage of ['start', 'route', 'compose', 'work', 'opening', 'kernel', 'dispatch', 'settle', 'grade', 'outcome']) {
      expect(summary.stages.find((s) => s.stage === stage)?.attempts, stage).toBeGreaterThan(0);
    }
    expect(summary.stages.find((s) => s.stage === 'opening')?.attempts).toBe(1);
    expect(summary.stages.find((s) => s.stage === 'kernel')?.attempts).toBe(2);
    expect(summary.stages.find((s) => s.stage === 'kernel')?.operations).toContainEqual(expect.objectContaining({ operation: 'model_request', attempts: 2, completed: 2 }));
    expect(summary.stages.find((s) => s.stage === 'settle')?.operations).toContainEqual(expect.objectContaining({ operation: 'store_save', attempts: 2, failed: 2 }));
    expect(events.filter((e) => e === 'run.started')).toHaveLength(1);
    expect(events.filter((e) => e === 'run.finished')).toHaveLength(1);
    expect(events).not.toContain('workflow.stage');
  });
});
