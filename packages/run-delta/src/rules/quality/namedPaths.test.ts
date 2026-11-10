import { describe, expect, it } from 'vitest';
import { extractNamedPaths, listingOf, MAX_CANDIDATES, pathCandidates } from './namedPaths.js';

const listing = listingOf(['src/a.ts', 'src/billing/invoice.ts', 'lib/deep/x.test.ts', 'README.md', 'docs/guide.md']);

describe('extractNamedPaths (C8.3 planned paths from plan / ticket text)', () => {
    it('keeps real files and folders, drops prose and paths that do not exist', () => {
        const text = [
            'Fix the bug in `src/a.ts` and update ./docs/guide.md.',
            'Also refactor the billing module (see src/billing/) and src/missing.ts.',
            'Mentioned in passing: e.g. v1.2.3, https://example.com/a/b.ts, @scope/pkg, /etc/passwd, ../outside.ts.',
        ].join('\n');
        expect(extractNamedPaths(text, listing)).toEqual(['docs/guide.md', 'src/a.ts', 'src/billing/']);
    });

    it('a folder named without a trailing slash resolves to the folder; prose words never do', () => {
        expect(extractNamedPaths('Touch src/billing only; the billing module is fine.', listing)).toEqual(['src/billing/']);
        expect(extractNamedPaths('the billing module and the docs', listing)).toEqual([]);
    });

    it('a glob is kept when its static folder exists', () => {
        expect(extractNamedPaths('Update lib/**/*.test.ts and nowhere/**/*.ts and *.md', listing)).toEqual(['*.md', 'lib/**/*.test.ts']);
    });

    it('is deterministic (sorted, deduplicated) and capped', () => {
        expect(pathCandidates('b/x.ts a/y.ts b/x.ts')).toEqual(['a/y.ts', 'b/x.ts']);
        const many = Array.from({ length: 200 }, (_, i) => `f${String(i).padStart(3, '0')}/x.ts`).join(' ');
        expect(pathCandidates(many)).toHaveLength(MAX_CANDIDATES);
        expect(pathCandidates(`${many}`)).toEqual(pathCandidates(many.split(' ').reverse().join(' ')));
    });

    it('backslash paths normalize to POSIX', () => {
        expect(extractNamedPaths('edit src\\a.ts', listing)).toEqual(['src/a.ts']);
    });
});
