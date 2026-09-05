/**
 * The framework's guard tests.
 *
 * Three failure modes, all of which look like a working product right up until
 * a customer hits them:
 *   1. a built-in template that does not survive the validator every published
 *      template is held to — shipped broken, discovered by a customer;
 *   2. an output kind a manifest may declare and nothing can install — the
 *      wizard completes, the install reports success, nothing is created;
 *   3. a binding an output uses that no step collects — the workflow installs
 *      with a silently empty field and quietly does nothing;
 *   4. the catalogue answering only signed-in callers — the menu of the product
 *      hidden behind a 401, which is what made `/api/templates` unreadable to
 *      every visitor who had not signed in yet.
 */

import { describe, it, expect } from 'vitest';
import {
  BUILTIN_TEMPLATE_LIST,
  BUILTIN_TEMPLATE_SOURCES,
  normalizeBuiltinTemplate,
} from './defaults';
import { registeredOutputKinds } from './outputKinds';
import { listTemplatesForTenant } from './templateRegistry';
import type { Db } from '../../infrastructure/database/connection';
import {
  parseTemplateManifest,
  validateTemplateManifest,
  TEMPLATE_OUTPUT_KINDS,
} from '../../domain/template/templateManifest';
import { referencedBindings } from '../../domain/guidedSetup/guidedPlan';
import { validateDefinition } from '../../domain/workflowGraph';

describe('built-in template catalogue', () => {
  it('every built-in survives the validator a published template gets', () => {
    for (const source of BUILTIN_TEMPLATE_SOURCES) {
      // Named per template rather than as one bulk assertion: a failure has to
      // say WHICH template and WHY, or the message is "the catalogue is broken".
      expect(() => normalizeBuiltinTemplate(source), `built-in "${source.key}"`).not.toThrow();
    }
  });

  it('keys are unique', () => {
    const keys = BUILTIN_TEMPLATE_LIST.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every workflow output compiles to a valid graph', () => {
    for (const template of BUILTIN_TEMPLATE_LIST) {
      for (const output of template.outputs) {
        if (output.kind !== 'workflow') continue;
        expect(validateDefinition(output.definition), `${template.key}/${output.id}`).toBeNull();
      }
    }
  });

  it('every binding an output uses is collected by a step', () => {
    for (const template of BUILTIN_TEMPLATE_LIST) {
      const collected = new Set(template.steps.map((s) => s.id));
      for (const ref of referencedBindings(template.outputs)) {
        expect(collected.has(ref), `${template.key} binds {{setup.${ref}}}`).toBe(true);
      }
    }
  });

  it('every required connector has a connect step', () => {
    for (const template of BUILTIN_TEMPLATE_LIST) {
      const connectSteps = new Set(
        template.steps.filter((s) => s.kind === 'connect').map((s) => s.connector),
      );
      for (const rc of template.requiredConnectors) {
        expect(connectSteps.has(rc.key), `${template.key} requires ${rc.key}`).toBe(true);
      }
    }
  });
});

describe('output kinds', () => {
  it('every declarable output kind has a registered materialiser', () => {
    // The contract between the shape (domain) and the effect (application). A
    // kind declared in one and absent from the other installs nothing and says
    // nothing, which is the worst available outcome.
    expect([...registeredOutputKinds()].sort()).toEqual([...TEMPLATE_OUTPUT_KINDS].sort());
  });
});

describe('manifest validation', () => {
  const base = {
    key: 'test-template',
    name: 'Test',
    summary: 'A test',
    category: 'other',
    requiredConnectors: [],
    steps: [{ id: 'name', kind: 'field', fieldType: 'text', title: 'Name' }],
    outputs: [{
      kind: 'workflow',
      id: 'wf',
      name: 'Test workflow',
      definition: { nodes: [{ id: 'n1', kind: 'trigger', label: 'Start', position: { x: 0, y: 0 }, config: {} }], edges: [] },
    }],
  };

  it('accepts a well-formed manifest', () => {
    expect(parseTemplateManifest(base).key).toBe('test-template');
  });

  it('rejects a binding no step collects', () => {
    const result = validateTemplateManifest({
      ...base,
      outputs: [{
        ...base.outputs[0],
        definition: {
          nodes: [{ id: 'n1', kind: 'llm', label: 'Draft', position: { x: 0, y: 0 }, config: { prompt: '{{setup.missing}}' } }],
          edges: [],
        },
      }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('setup.missing');
  });

  it('rejects a tasks output with nowhere to file its tickets', () => {
    const result = validateTemplateManifest({
      ...base,
      outputs: [{ kind: 'tasks', id: 't', label: 'Checklist', items: [{ title: 'Do the thing', description: '' }] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('resource step');
  });

  it('rejects an unknown step kind rather than ignoring it', () => {
    // Silently dropping the step would produce a wizard that never asks for the
    // answer an output goes on to bind — a template that installs empty.
    const result = validateTemplateManifest({
      ...base,
      steps: [{ id: 'x', kind: 'telepathy', title: 'Think of a number' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('unknown step kind');
  });

  it('rejects a workflow graph with a cycle', () => {
    const result = validateTemplateManifest({
      ...base,
      outputs: [{
        kind: 'workflow',
        id: 'wf',
        name: 'Looping',
        definition: {
          nodes: [
            { id: 'a', kind: 'trigger', label: 'A', position: { x: 0, y: 0 }, config: {} },
            { id: 'b', kind: 'llm', label: 'B', position: { x: 0, y: 0 }, config: {} },
          ],
          edges: [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'b', target: 'a' }],
        },
      }],
    });
    expect(result.ok).toBe(false);
  });
});


describe('the catalogue a signed-out visitor sees', () => {
  /** A query builder that records what it was asked for and answers nothing.
   *  Enough to prove which reads happen — which is the whole question here. */
  function recordingDb() {
    const selects: number[] = [];
    const chain = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve([]),
      then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
    };
    return {
      selects,
      db: { select: () => { selects.push(1); return chain; } } as unknown as Db,
    };
  }

  it('is the built-ins, with no workspace query', async () => {
    const { db, selects } = recordingDb();
    const entries = await listTemplatesForTenant(db, null);
    expect(entries.length).toBe(BUILTIN_TEMPLATE_LIST.length);
    expect(entries.every((e) => e.origin === 'builtin')).toBe(true);
    // ONE read — the public listings. A second would be the tenant-owned scan,
    // which has no tenant to scope it and must never be issued.
    expect(selects.length).toBe(1);
  });
});
