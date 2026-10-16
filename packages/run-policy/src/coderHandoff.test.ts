import { describe, expect, it } from 'vitest';
import { coderHandoffBrief, isCoderReask } from './index.js';

describe('isCoderReask', () => {
  it('is a code request straight after a plan one, and nothing else', () => {
    expect(isCoderReask('code', 'plan')).toBe(true);
    expect(isCoderReask('code', 'code')).toBe(false);
    expect(isCoderReask('plan', 'plan')).toBe(false);
    expect(isCoderReask('code', undefined)).toBe(false);
  });
});

describe('coderHandoffBrief', () => {
  it('carries the findings and the change the planner was about to make', () => {
    const brief = coderHandoffBrief('  The bug is in parse().  ', [{ name: 'edit_file', args: '{"path":"a.ts"}' }]);
    expect(brief).toContain('HAND-OFF');
    expect(brief).toContain('The planner concluded:\nThe bug is in parse().');
    expect(brief).toContain('- edit_file {"path":"a.ts"}');
  });

  it('omits the findings line when the planner wrote nothing', () => {
    expect(coderHandoffBrief('', [{ name: 'write_file', args: '{}' }])).not.toContain('The planner concluded:');
  });

  it('caps each call and the whole brief', () => {
    const huge = 'x'.repeat(5_000);
    const one = coderHandoffBrief('', [{ name: 'write_file', args: huge }]);
    expect(one).toContain(`${'x'.repeat(2_000)}…`);
    const many = coderHandoffBrief('', Array.from({ length: 5 }, () => ({ name: 'write_file', args: huge })));
    expect(many.length).toBe(6_001);
  });
});
