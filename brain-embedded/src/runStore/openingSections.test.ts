import { describe, expect, it } from 'vitest';
import { assembleOpening, renderWorkspaceRules } from './openingSections';

describe('assembleOpening', () => {
  it('leaves the host prompt untouched with no opening, or an opening that carries nothing', () => {
    expect(assembleOpening('BASE', undefined)).toBe('BASE');
    expect(assembleOpening('BASE', {})).toBe('BASE');
    expect(assembleOpening('BASE', { gates: [], rules: '   ' })).toBe('BASE');
  });

  it('orders governance, then workspace rules, then the host prompt', () => {
    const out = assembleOpening('BASE', {
      gates: [{ id: 'g', effect: 'block', tool: 'git_push', reason: 'frozen' }],
      rules: 'Always write tests.',
    });
    const governance = out.indexOf('Governance');
    const rules = out.indexOf('Always write tests.');
    expect(governance).toBe(0);
    expect(rules).toBeGreaterThan(governance);
    expect(out.endsWith('\n\nBASE')).toBe(true);
  });

  it('builds the IDE persona, map, project, editor context, composer switches and limbic text after the host prompt, in that order', () => {
    const out = assembleOpening('HOST', {
      hasWorkspace: true,
      grounding: 'MAPBODY',
      project: { id: 7, name: 'Acme' },
      editorContext: { activeFile: 'src/a.ts' },
      composer: { web: true },
      limbic: 'LIMBICBLOCK',
    });
    const at = (s: string): number => out.indexOf(s);
    expect(at('HOST')).toBe(0);
    expect(at('You are BuilderForce')).toBeGreaterThan(at('HOST'));
    expect(at('MAPBODY')).toBeGreaterThan(at('You are BuilderForce'));
    expect(at('projectId 7')).toBeGreaterThan(at('MAPBODY'));
    expect(at('src/a.ts')).toBeGreaterThan(at('projectId 7'));
    expect(at('builtin_web_fetch')).toBeGreaterThan(at('src/a.ts'));
    expect(out.endsWith('LIMBICBLOCK')).toBe(true);
  });

  it('adds no IDE persona or map when the host prompt carries its own (hasWorkspace absent)', () => {
    const out = assembleOpening('HOST', { grounding: 'MAPBODY' });
    expect(out).toBe('HOST');
  });

  it('layers a modality persona over the IDE persona, and states no persona for the default one', () => {
    expect(assembleOpening('', { hasWorkspace: false, persona: { choice: 'default', agents: [] } })).not.toContain('Persona for this conversation');
    expect(assembleOpening('', { hasWorkspace: false, persona: { choice: 'modality:voice', agents: [] } })).toContain('Persona for this conversation');
  });

  it('names an assigned agent persona', () => {
    const out = assembleOpening('', { hasWorkspace: true, persona: { choice: 'agent:cloud:a1', agents: [{ kind: 'cloud', ref: 'a1', name: 'Bob' }] } });
    expect(out).toContain('"Bob" agent');
  });

  it('states shipping once: the IDE persona defers to the ship policy contract', () => {
    const out = assembleOpening('', { hasWorkspace: true });
    expect(out).not.toContain('Report the commit hash');
    expect(out).toContain('SHIP POLICY');
  });
});

describe('renderWorkspaceRules', () => {
  it('names its source and truncates an oversized file', () => {
    expect(renderWorkspaceRules('Use pnpm.')).toContain('.builderforce/rules.md');
    expect(renderWorkspaceRules('x'.repeat(20_000))).toContain('(rules truncated)');
  });
});
