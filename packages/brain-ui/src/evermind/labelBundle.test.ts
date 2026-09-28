import { describe, expect, it } from 'vitest';
import { evermindLabelsFromBundle } from './labelBundle';

describe('evermindLabelsFromBundle', () => {
  it('maps static strings and fills named placeholders in the parametric ones', () => {
    const labels = evermindLabelsFromBundle({
      'ev.tabTeach': 'Lehren',
      'ev.statusSeeded': 'Lernt · v{version}',
      'ev.flushedN': '{merged} in v{version}',
      'ev.importDone': '{absorbed}/{compacted} v{version} ~{savedKb} KB',
      'ev.taughtTeacherFault': '{model}: {reason}',
      'other.key': 'ignored',
    });
    expect(labels.tabTeach).toBe('Lehren');
    expect(labels.statusSeeded?.(7)).toBe('Lernt · v7');
    expect(labels.flushedN?.(3, 12)).toBe('3 in v12');
    expect(labels.importDone?.(5, 9, 4, '1.2')).toBe('5/4 v9 ~1.2 KB');
    expect(labels.taughtTeacherFault?.('gpt', 'timeout')).toBe('gpt: timeout');
    expect(Object.keys(labels)).not.toContain('key');
  });

  it('leaves out what the bundle lacks, so the console keeps its English default', () => {
    const labels = evermindLabelsFromBundle({});
    expect(labels).toEqual({});
  });
});
