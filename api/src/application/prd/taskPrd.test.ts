import { describe, expect, it } from 'vitest';
import { stripPrdMarkdownFence } from './taskPrd';

describe('stripPrdMarkdownFence', () => {
  it('returns clean markdown unchanged (trimmed)', () => {
    const doc = '# Product Requirements\n\nProblem & Goal.';
    expect(stripPrdMarkdownFence(doc)).toBe(doc);
    expect(stripPrdMarkdownFence(`\n${doc}\n`)).toBe(doc);
  });

  it('unwraps a whole-document ```markdown fence', () => {
    const raw = '```markdown\n# PRD\n\n## Scope\n```';
    expect(stripPrdMarkdownFence(raw)).toBe('# PRD\n\n## Scope');
  });

  it('recognizes a bare ```md fence and is case-insensitive', () => {
    expect(stripPrdMarkdownFence('```md\n# PRD\n```')).toBe('# PRD');
    expect(stripPrdMarkdownFence('```MARKDOWN\n# PRD\n```')).toBe('# PRD');
  });

  it('unwraps an unlabelled whole-document fence', () => {
    expect(stripPrdMarkdownFence('```\n# PRD\n```')).toBe('# PRD');
  });

  it('is idempotent', () => {
    const once = stripPrdMarkdownFence('```markdown\n# PRD\n```');
    expect(stripPrdMarkdownFence(once)).toBe(once);
  });

  it('leaves a PRD whose body merely contains a code block intact', () => {
    // Inner code fence is not the whole document, so nothing is stripped.
    const doc = '# PRD\n\n```ts\nconst x = 1;\n```\n\nDone.';
    expect(stripPrdMarkdownFence(doc)).toBe(doc);
  });
});
