/**
 * Authoring helpers for the built-in template catalogue.
 *
 * A template's whole value is that somebody else already got the details right,
 * which means the catalogue is where the details are written — and hand-writing
 * node ids, x/y positions and an edge list per template is where they get
 * written WRONG. `chain()` lays a linear graph out and wires it, so a template
 * file says what the steps ARE and nothing about where they sit.
 *
 * Nothing here validates: every built-in goes through `parseTemplateManifest`,
 * the same validator an untrusted published manifest gets, and `defaults.test`
 * fails the build if one of them does not survive it. A helper that also
 * validated would be a second, weaker check that disagrees with the real one.
 */

import type { WorkflowDefNode, WorkflowDefinition, WorkflowNodeKind } from '../../../domain/workflowGraph';
import type { GuidedStep, RequiredConnector } from '../../../domain/guidedSetup/guidedStep';
import type { TemplateManifest, TemplateTask } from '../../../domain/template/templateManifest';

/** Horizontal pitch between chained nodes on the builder canvas. */
const STEP_X = 220;
const ROW_Y = 120;
/** Nodes per row before the chain wraps, so a nine-step template stays on screen. */
const PER_ROW = 4;

export interface NodeSpec {
  kind: WorkflowNodeKind;
  label: string;
  config?: Record<string, unknown>;
}

export const trigger = (label: string, config: Record<string, unknown>): NodeSpec =>
  ({ kind: 'trigger', label, config });

export const llm = (label: string, config: Record<string, unknown>): NodeSpec =>
  ({ kind: 'llm', label, config: { provider: 'anthropic', temperature: 0.4, ...config } });

export const agent = (label: string, config: Record<string, unknown>): NodeSpec =>
  ({ kind: 'agent', label, config: { runtime: 'cloud', ...config } });

/** One action on a connected integration. `input` is templated at run time and
 *  `{{setup.x}}`-bound at install time, so both layers reach the same field. */
export const call = (
  label: string,
  connector: string,
  action: string,
  input: Record<string, unknown> = {},
): NodeSpec => ({ kind: 'connector', label, config: { connector, action, input } });

export const transform = (label: string, expression: string): NodeSpec =>
  ({ kind: 'transform', label, config: { expression } });

export const filter = (label: string, predicate: string): NodeSpec =>
  ({ kind: 'filter', label, config: { predicate } });

export const output = (label: string, target: string): NodeSpec =>
  ({ kind: 'output', label, config: { target } });

/** Lay a linear list of steps out and wire each to the next. */
export function chain(steps: readonly NodeSpec[]): WorkflowDefinition {
  const nodes: WorkflowDefNode[] = steps.map((spec, i) => ({
    id: `n${i + 1}`,
    kind: spec.kind,
    label: spec.label,
    position: { x: (i % PER_ROW) * STEP_X, y: Math.floor(i / PER_ROW) * ROW_Y },
    config: spec.config ?? {},
  }));
  const edges = nodes.slice(1).map((n, i) => ({ id: `e${i + 1}`, source: nodes[i]!.id, target: n.id }));
  return { nodes, edges };
}

/** A required connector, stated once and reused for both the "works with" row
 *  and the derived connect step. */
export const needs = (key: string, label: string, why: string): RequiredConnector => ({ key, label, why });

/** Checklist items, numbered in declaration order so a template never restates
 *  what position a task is in. */
export function checklist(
  items: readonly (readonly [title: string, description: string] | readonly [title: string, description: string, kind: 'setup' | 'build'])[],
): TemplateTask[] {
  return items.map(([title, description, kind], order) => ({
    title,
    description,
    order,
    kind: kind ?? 'setup',
  }));
}

/** A required short-text answer, the commonest step by a distance. */
export const ask = (
  id: string,
  title: string,
  help: string,
  placeholder?: string,
): GuidedStep => ({
  kind: 'field',
  fieldType: 'text',
  id,
  title,
  help,
  required: true,
  ...(placeholder ? { placeholder } : {}),
});

/** The project a template files its seeded work under. Every template that
 *  produces tickets declares one, and they all word it the same way. */
export const projectStep = (help: string): GuidedStep => ({
  kind: 'resource',
  resource: 'project',
  allowCreate: true,
  id: 'project',
  title: 'Where should this work live?',
  help,
  required: true,
});

/** Convenience for the catalogue's own shape — every built-in declares the same
 *  fields, and a missing one should be a type error, not a runtime surprise. */
export type BuiltinTemplate = Omit<TemplateManifest, 'requiredSecrets' | 'tags' | 'successCriteria'>
  & Partial<Pick<TemplateManifest, 'requiredSecrets' | 'tags' | 'successCriteria'>>;
