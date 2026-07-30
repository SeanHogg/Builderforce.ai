import { describe, expect, it } from 'vitest';
import { inspectAgentSource } from './sourceQualityPolicy';

describe('inspectAgentSource', () => {
  it('blocks an untyped callback inside a conditional JSX prop', () => {
    const source = [
      'return <Panel',
      "  onSetVisibility={isOwner ? async (v) => update({ visibility: v }) : undefined}",
      '/>;',
    ].join('\n');
    expect(inspectAgentSource('src/Panel.tsx', source)).toEqual([expect.objectContaining({
      ruleId: 'typescript/explicit-conditional-jsx-callback',
      line: 2,
    })]);
  });

  it('accepts an explicitly typed inline callback', () => {
    const source = "return <Panel onSetVisibility={isOwner ? async (v: 'shared' | 'locked') => update(v) : undefined} />;";
    expect(inspectAgentSource('src/Panel.tsx', source)).toEqual([]);
  });

  it('accepts the preferred named callback typed from the prop contract', () => {
    const source = [
      "const setVisibility: NonNullable<Props['onSetVisibility']> = async (value) => update(value);",
      'return <Panel onSetVisibility={isOwner ? setVisibility : undefined} />;',
    ].join('\n');
    expect(inspectAgentSource('src/Panel.tsx', source)).toEqual([]);
  });

  it('does not police ordinary contextually typed callbacks', () => {
    expect(inspectAgentSource('src/list.ts', 'const ids = rows.map((row) => row.id);')).toEqual([]);
  });

  it('ignores non-source files', () => {
    expect(inspectAgentSource('README.md', 'onChange={ok ? (v) => save(v) : undefined}')).toEqual([]);
  });
});

