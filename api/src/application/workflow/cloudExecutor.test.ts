import { describe, it, expect } from 'vitest';
import { renderTemplate } from './cloudExecutor';

describe('renderTemplate', () => {
  it('substitutes {{input}} with the upstream text', () => {
    expect(renderTemplate('Summarize: {{input}}', 'hello world')).toBe('Summarize: hello world');
  });
  it('tolerates inner whitespace and multiple occurrences', () => {
    expect(renderTemplate('{{ input }} / {{input}}', 'X')).toBe('X / X');
  });
  it('leaves text without the token unchanged', () => {
    expect(renderTemplate('no placeholder here', 'X')).toBe('no placeholder here');
  });
});
