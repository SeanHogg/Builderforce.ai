import { describe, expect, it } from 'vitest';
import { AFFINITY_MIN, MIN_DOMAIN_SIZE, proposeDomainLayout, stemOf, type DomainLayoutInput } from './domainLayout.js';

const input = (files: string[], edges: DomainLayoutInput['edges'] = [], extra: Partial<DomainLayoutInput> = {}): DomainLayoutInput => ({ folder: 'src', files, edges, ...extra });
const toOf = (layout: ReturnType<typeof proposeDomainLayout>, from: string) => layout.moves.find((m) => m.from === from)?.to;

describe('stemOf', () => {
    it('takes the first token of the name, tests and extensions stripped', () => {
        expect(stemOf('attachmentDownload.ts')).toBe('attachment');
        expect(stemOf('attachmentLimits.test.ts')).toBe('attachment');
        expect(stemOf('git-status_view.tsx')).toBe('git');
        expect(stemOf('HTTPServer.ts')).toBe('http');
    });
});

describe('proposeDomainLayout', () => {
    const tokens = ['tokenA.ts', 'tokenB.ts', 'tokenC.ts'].map((f) => `src/${f}`);

    it('makes a folder of a stem shared by MIN_DOMAIN_SIZE modules, and not of fewer', () => {
        expect(tokens.length).toBe(MIN_DOMAIN_SIZE);
        const layout = proposeDomainLayout(input([...tokens, 'src/lonelyA.ts', 'src/lonelyB.ts']));
        expect(layout.domains).toEqual([{ id: 'token', isNew: true, files: ['src/token/tokenA.ts', 'src/token/tokenB.ts', 'src/token/tokenC.ts'] }]);
        expect(layout.unassigned).toEqual(['src/lonelyA.ts', 'src/lonelyB.ts']);
        expect(layout.moves.every((m) => m.reason === 'name')).toBe(true);
    });

    it('maps a stem onto an existing folder, in any case and with a trailing s', () => {
        const layout = proposeDomainLayout(input(['src/Tools/x.ts', 'src/toolRunner.ts', 'src/toolsList.ts']));
        expect(toOf(layout, 'src/toolRunner.ts')).toBe('src/Tools/toolRunner.ts');
        expect(toOf(layout, 'src/toolsList.ts')).toBe('src/Tools/toolsList.ts');
        expect(layout.moves[0]!.reason).toBe('existing-folder');
        expect(layout.domains[0]).toMatchObject({ id: 'Tools', isNew: false });
    });

    it('a test follows its subject, and does not count towards a new folder', () => {
        const layout = proposeDomainLayout(input([...tokens, 'src/tokenA.test.ts', 'src/zebra.test.ts', 'src/zebraOne.test.ts']));
        expect(layout.moves.find((m) => m.from === 'src/tokenA.test.ts')).toMatchObject({ to: 'src/token/tokenA.test.ts', reason: 'test-subject' });
        expect(layout.unassigned).toEqual(['src/zebra.test.ts', 'src/zebraOne.test.ts']);
        const subjectless = proposeDomainLayout(input(['src/Tools/x.ts', 'src/runner.ts', 'src/runner.test.ts'], [{ from: 'src/runner.ts', to: 'src/Tools/x.ts' }]));
        expect(subjectless.moves.find((m) => m.from === 'src/runner.test.ts')).toMatchObject({ to: 'src/Tools/runner.test.ts', reason: 'test-subject' });
    });

    it('votes by imports when most of the weight goes to one domain, and not below AFFINITY_MIN', () => {
        const base = ['src/Tools/a.ts', 'src/Chat/b.ts', 'src/helper.ts', 'src/mixed.ts'];
        const layout = proposeDomainLayout(input(base, [
            { from: 'src/helper.ts', to: 'src/Tools/a.ts', weight: 3 }, { from: 'src/helper.ts', to: 'src/Chat/b.ts', weight: 1 },
            { from: 'src/mixed.ts', to: 'src/Tools/a.ts' }, { from: 'src/mixed.ts', to: 'src/Chat/b.ts' },
        ]));
        expect(AFFINITY_MIN).toBe(0.5);
        expect(layout.moves.find((m) => m.from === 'src/helper.ts')).toMatchObject({ to: 'src/Tools/helper.ts', reason: 'imports' });
        // 50/50 is exactly AFFINITY_MIN and breaks alphabetically: Chat.
        expect(layout.moves.find((m) => m.from === 'src/mixed.ts')?.domain).toBe('Chat');
        const split = proposeDomainLayout(input(['src/Tools/a.ts', 'src/Chat/b.ts', 'src/Run/c.ts', 'src/x.ts'], [
            { from: 'src/x.ts', to: 'src/Tools/a.ts' }, { from: 'src/x.ts', to: 'src/Chat/b.ts' }, { from: 'src/x.ts', to: 'src/Run/c.ts' },
        ]));
        expect(split.unassigned).toEqual(['src/x.ts']);
    });

    it('lets a vote ripple through files placed by an earlier pass', () => {
        const layout = proposeDomainLayout(input(['src/Tools/a.ts', 'src/one.ts', 'src/two.ts'], [{ from: 'src/one.ts', to: 'src/Tools/a.ts' }, { from: 'src/two.ts', to: 'src/one.ts' }]));
        expect(layout.moves.map((m) => m.to)).toEqual(['src/Tools/one.ts', 'src/Tools/two.ts']);
    });

    it('never votes a file into a sub-folder that is no valid domain id', () => {
        const layout = proposeDomainLayout(input(['src/__mocks__/a.ts', 'src/one.ts'], [{ from: 'src/one.ts', to: 'src/__mocks__/a.ts' }]));
        expect(layout.moves).toEqual([]);
        expect(layout.unassigned).toEqual(['src/one.ts']);
    });

    it('reports a target that already exists (any case) as a conflict, and keeps entry files and declarations put', () => {
        const layout = proposeDomainLayout(input(['src/Tools/Runner.ts', 'src/toolRunner.ts', 'src/Tools/toolrunner.ts', 'src/extension.ts', 'src/types.d.ts', 'src/toolsEntry.ts']));
        expect(layout.conflicts).toEqual([{ from: 'src/toolRunner.ts', to: 'src/Tools/toolRunner.ts' }]);
        expect(layout.moves.map((m) => m.from)).toEqual(['src/toolsEntry.ts']);
        expect(layout.unassigned).toEqual([]);
        const kept = proposeDomainLayout(input(['src/Tools/a.ts', 'src/toolMain.ts'], [], { keepAtRoot: ['toolMain.ts'] }));
        expect(kept.moves).toEqual([]);
    });

    it('counts the file links that cross domains before and after', () => {
        const files = ['src/Tools/a.ts', 'src/toolB.ts', 'src/other.ts'];
        const layout = proposeDomainLayout(input(files, [{ from: 'src/toolB.ts', to: 'src/Tools/a.ts' }, { from: 'src/other.ts', to: 'src/Tools/a.ts' }]));
        expect(layout.crossEdges).toEqual({ before: 2, after: 0 });
    });

    it('is deterministic whatever the order of the input', () => {
        const files = [...tokens, 'src/tokenA.test.ts', 'src/Tools/a.ts', 'src/toolsB.ts'];
        const edges = [{ from: 'src/toolsB.ts', to: 'src/Tools/a.ts' }];
        expect(proposeDomainLayout(input([...files].reverse(), edges))).toEqual(proposeDomainLayout(input(files, edges)));
    });
});
