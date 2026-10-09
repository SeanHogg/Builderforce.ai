import { describe, expect, it } from 'vitest';
import { projectSubtitle } from './projectSubtitle';

describe('projectSubtitle', () => {
  it('hides a description that only continues the name it was derived from', () => {
    const prompt = 'Build me a marketing website for my bakery with a menu page';
    // A name derived from the prompt's first words, the way prompt-started projects are named.
    expect(projectSubtitle('Build me a marketing website for', prompt)).toBeNull();
  });

  it('hides it when the derived name was cut with an ellipsis', () => {
    const prompt = 'Supercalifragilisticexpialidocious '.repeat(4);
    const name = `${prompt.trim().slice(0, 59)}…`;
    expect(projectSubtitle(name, prompt)).toBeNull();
  });

  it('ignores case and whitespace runs', () => {
    expect(projectSubtitle('Todo  App', '  todo app with tags')).toBeNull();
  });

  it('keeps a description that says something the name does not', () => {
    expect(projectSubtitle('Acme storefront', 'Shopify replacement for the spring launch')).toBe('Shopify replacement for the spring launch');
  });

  it('returns null for an empty description', () => {
    expect(projectSubtitle('Acme', '   ')).toBeNull();
    expect(projectSubtitle('Acme', null)).toBeNull();
  });
});
