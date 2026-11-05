import { describe, expect, it } from 'vitest';
import { ownerOf, ownersFor, parseCodeOwners } from './codeOwners.js';

const RULES = parseCodeOwners([
  '# comment',
  '* @default',
  '/docs/ @docs-team',
  '*.ts @ts-team @other   # trailing comment',
  '/src/api/ @api',
  '/gen/',
  '',
].join('\n'));

describe('CODEOWNERS', () => {
  it('last matching pattern wins and the badge is its first owner', () => {
    expect(ownerOf('README.md', RULES)).toBe('@default');
    expect(ownerOf('docs/a.md', RULES)).toBe('@docs-team');
    expect(ownerOf('docs/a.ts', RULES)).toBe('@ts-team');
    expect(ownerOf('src/x/y.ts', RULES)).toBe('@ts-team');
    expect(ownerOf('src/api/y.ts', RULES)).toBe('@api');
  });

  it('a pattern with no owners un-owns the path', () => {
    expect(ownerOf('gen/a.ts', RULES)).toBeUndefined();
  });

  it('anchors a pattern with a slash and matches a bare name at any depth', () => {
    const rules = parseCodeOwners('/build/out.ts @a\nutil.ts @b\napps/web/ @c');
    expect(ownerOf('build/out.ts', rules)).toBe('@a');
    expect(ownerOf('x/build/out.ts', rules)).toBeUndefined();
    expect(ownerOf('deep/er/util.ts', rules)).toBe('@b');
    expect(ownerOf('apps/web/page.tsx', rules)).toBe('@c');
  });

  it('a wildcard tail (`docs/*`) owns direct files only; a plain folder name owns what is below it', () => {
    const rules = parseCodeOwners('docs/* @docs\n/apps/web @web');
    expect(ownerOf('docs/a.md', rules)).toBe('@docs');
    expect(ownerOf('docs/guide/a.md', rules)).toBeUndefined();
    expect(ownerOf('apps/web/src/a.ts', rules)).toBe('@web');
  });

  it('ownersFor leaves unowned paths out, and everything out without a file', () => {
    expect([...ownersFor(['a.ts', 'gen/b.ts'], RULES)]).toEqual([['a.ts', '@ts-team']]);
    expect(ownersFor(['a.ts'], []).size).toBe(0);
  });
});
