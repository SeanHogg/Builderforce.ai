import { describe, expect, it } from 'vitest';
import { projectNameFromPrompt } from './useStartStudioProject';

describe('projectNameFromPrompt', () => {
  it('takes the first few words of the prompt', () => {
    expect(projectNameFromPrompt('  A   todo app with tags and due dates and reminders', 'Untitled')).toBe('A todo app with tags and');
  });

  it('caps the length', () => {
    const name = projectNameFromPrompt(`${'x'.repeat(100)} more`, 'Untitled');
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name.endsWith('…')).toBe(true);
  });

  it('falls back when the prompt is empty', () => {
    expect(projectNameFromPrompt('   ', 'Untitled')).toBe('Untitled');
  });
});
