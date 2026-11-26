import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Finding, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as LABELS } from '../../labels';
import { DuplicateCopyCards, type CopyFix } from './DuplicateCopyCard';
import { duplicateCopyOf } from './duplicateCopy';

const finding = (extra: Partial<Finding['params']> = {}): Finding => ({
    id: 'dc:1', kind: 'duplicate-copy', pack: 'code', nodes: ['src:r::bf-copy' as Finding['nodes'][number]], severity: 'warn',
    params: { copy: 'bf-copy', original: 'Builderforce.ai', similarity: 0.93, reason: 'no-git', ...extra },
});
const fix = (over: Partial<CopyFix> = {}): CopyFix => ({ exclude: vi.fn().mockResolvedValue(undefined), rereview: vi.fn(), busy: false, ...over });
const show = () => render(<DuplicateCopyCards findings={[finding()]} labels={LABELS} fix={undefined} onShow={() => {}} />);

describe('DuplicateCopyCards', () => {
    it('reads the finding: a fraction and a percent both mean whole percent', () => {
        expect(duplicateCopyOf(finding())).toMatchObject({ copy: 'bf-copy', original: 'Builderforce.ai', similarity: 93, reason: 'no-git' });
        expect(duplicateCopyOf(finding({ similarity: 91 }))!.similarity).toBe(91);
    });

    it('draws nothing when the host cannot exclude a folder', () => {
        const { container } = show();
        expect(container.innerHTML).toBe('');
    });

    it('says which folder is a copy of which and why', () => {
        render(<DuplicateCopyCards findings={[finding({ reason: 'later-name' })]} labels={LABELS} fix={fix()} onShow={() => {}} />);
        expect(screen.getByText(/bf-copy looks like a stray copy of Builderforce\.ai \(93% /)).toBeTruthy();
        expect(screen.getByText(LABELS.surface.duplicateCopy.reasonLaterName)).toBeTruthy();
    });

    it('excludes the folder, then starts the Re-review', async () => {
        const f = fix();
        render(<DuplicateCopyCards findings={[finding()]} labels={LABELS} fix={f} onShow={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /Exclude bf-copy/ }));
        await waitFor(() => expect(f.rereview).toHaveBeenCalledTimes(1));
        expect(f.exclude).toHaveBeenCalledWith('bf-copy');
    });

    it('is disabled while a review is in flight', () => {
        render(<DuplicateCopyCards findings={[finding()]} labels={LABELS} fix={fix({ busy: true })} onShow={() => {}} />);
        expect((screen.getByRole('button', { name: /Exclude bf-copy/ }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows the host\'s refusal and does not start a review', async () => {
        const f = fix({ exclude: vi.fn().mockRejectedValue(new Error('Cannot write the ignore file')) });
        render(<DuplicateCopyCards findings={[finding()]} labels={LABELS} fix={f} onShow={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /Exclude bf-copy/ }));
        expect((await screen.findByRole('alert')).textContent).toBe('Cannot write the ignore file');
        expect(f.rereview).not.toHaveBeenCalled();
    });

    it('Show lights the copy\'s file nodes, not the finding\'s folder refs', () => {
        const node = (path: string, system: string) => ({ ref: `src:r::${path}`, kind: 'file', label: path, pack: 'code', system, importance: 0.5, origin: 'extracted' });
        const graph = { scope: { rootId: 'r', packs: [], digest: 'd' }, nodes: [node('bf-copy/a.ts', 'bf-copy'), node('bf-copy/b.ts', 'bf-copy'), node('orig/a.ts', 'orig')], edges: [], findings: [] } as unknown as KnowledgeGraph;
        const onShow = vi.fn();
        render(<DuplicateCopyCards findings={[finding()]} labels={LABELS} fix={fix()} graph={graph} onShow={onShow} />);
        fireEvent.click(document.querySelector('[data-act="show-copy"]')!);
        expect(onShow).toHaveBeenCalledWith(['src:r::bf-copy/a.ts', 'src:r::bf-copy/b.ts']);
    });
});
