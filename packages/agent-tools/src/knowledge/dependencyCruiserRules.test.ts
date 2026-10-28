import { describe, expect, it, vi } from 'vitest';
import { createAnalyzeCodebaseTool, dependencyCruiserConfig } from '../codeAnalysisTool.js';
import { CODE_LAYERS } from './codePack.js';
import { toDependencyCruiserRules } from './dependencyCruiserRules.js';

const byName = (name: string) => toDependencyCruiserRules(CODE_LAYERS).find((r) => r.name === name)!;

describe('toDependencyCruiserRules', () => {
  it('generates one rule per disallowed layer pair of CODE_LAYERS, severity by verdict', () => {
    const rules = toDependencyCruiserRules(CODE_LAYERS);
    expect(rules.map((r) => [r.name, r.severity])).toEqual([
      ['kg-layer-presentation-to-infrastructure', 'warn'],
      ['kg-layer-application-to-presentation', 'error'],
      ['kg-layer-application-to-infrastructure', 'warn'],
      ['kg-layer-domain-to-presentation', 'error'],
      ['kg-layer-domain-to-application', 'error'],
      ['kg-layer-domain-to-infrastructure', 'warn'],
      ['kg-layer-infrastructure-to-presentation', 'error'],
    ]);
  });

  it('compiles the globs to path regexes that match the layer', () => {
    const rule = byName('kg-layer-presentation-to-infrastructure');
    expect(new RegExp(rule.from.path).test('frontend/src/routes/orders.ts')).toBe(true);
    expect(new RegExp(rule.from.path).test('src/components/Button.tsx')).toBe(true);
    expect(new RegExp(rule.to.path).test('api/src/infrastructure/db.ts')).toBe(true);
    expect(new RegExp(rule.to.path).test('api/src/db/client.ts')).toBe(true);
    expect(new RegExp(rule.to.path).test('api/src/domain/order.ts')).toBe(false);
    expect(rule.from.pathNot).toBeUndefined();
  });

  it('keeps first-match-wins: a later layer excludes the paths an earlier one claims', () => {
    const rule = byName('kg-layer-infrastructure-to-presentation');
    // `app/db/x.ts` is presentation (first match), so it is not infrastructure.
    expect(new RegExp(rule.from.path).test('src/app/db/x.ts')).toBe(true);
    expect(new RegExp(rule.from.pathNot!).test('src/app/db/x.ts')).toBe(true);
    expect(new RegExp(rule.from.pathNot!).test('src/db/x.ts')).toBe(false);
  });

  it('yields nothing for a registry without `allow` (no verdicts)', () => {
    expect(toDependencyCruiserRules({ partitions: CODE_LAYERS.partitions })).toEqual([]);
  });
});

describe('dependency-cruiser config wiring', () => {
  it('is unchanged without a registry and gains the forbidden rules with one', () => {
    expect(dependencyCruiserConfig()).toEqual({
      options: { exclude: { path: '(^|/)(node_modules|[.]git|[.]builderforce|dist|out|build)(/|$)' } },
    });
    expect(dependencyCruiserConfig(CODE_LAYERS)['forbidden']).toEqual(toDependencyCruiserRules(CODE_LAYERS));
  });

  it('hands the generated rules to the dependency-cruiser run', async () => {
    const run = vi.fn(async () => ({ ok: true, exitCode: 0, stdout: '' }));
    const tool = createAnalyzeCodebaseTool({ partitions: CODE_LAYERS });
    await tool.execute({}, { caps: { shell: { run }, repoRead: { readFile: async () => ({ ok: true, content: '' }) } } } as never);
    const write = (run.mock.calls as unknown as string[][]).map(([c]) => c!).find((c) => c.includes('dependencies.json'))!;
    const encoded = /Buffer\.from\('([A-Za-z0-9+/=]+)','base64'\)/.exec(write)![1]!;
    const written = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    expect(written).toEqual(dependencyCruiserConfig(CODE_LAYERS));
  });
});
