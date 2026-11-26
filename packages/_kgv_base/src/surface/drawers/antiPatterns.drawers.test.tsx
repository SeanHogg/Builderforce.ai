// @vitest-environment jsdom
/** The grouped anti-pattern list, its multiselect, the preview and the ONE batched Apply. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Finding, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { surfaceFixture } from '../../testing';
import type { KnowledgeGraphSource } from '../../types';
import { useSurface, type SurfaceModel } from '../useSurface';
import { PatternsPanel } from './PatternsPanel';

const base = surfaceFixture();
const ref = (p: string) => `src:sys::${p}` as Finding['nodes'][number];
const violations: Finding[] = Array.from({ length: 40 }, (_, i) => ({
    id: `pv${i}`, kind: 'partition-violation', pack: 'code', nodes: [ref(`web/main.tsx`), ref(i % 2 ? 'api/useCase.ts' : 'api/routes.ts')],
    severity: 'error', params: { verdict: 'upward', from: 'domain', to: 'application', kind: 'references' },
}));
const unused: Finding = { id: 'ue1', kind: 'unused-export', pack: 'code', nodes: [ref('db/repo.ts')], severity: 'info', params: {} };
const graph: KnowledgeGraph = { ...base, findings: [...violations, unused] };
const seen: { surface?: SurfaceModel } = {};

function mount(source?: KnowledgeGraphSource, over: Partial<{ onCompose: ((t: string) => void) | undefined }> = {}) {
    const props = { onShow: vi.fn(), onCompose: vi.fn(), onClose: vi.fn(), onCamera: vi.fn(), onChanged: vi.fn() };
    function Harness() {
        const surface = useSurface(graph, null);
        seen.surface = surface;
        return <PatternsPanel graph={graph} labels={L} surface={surface} cameras={['3d']} source={source} {...props} {...('onCompose' in over ? { onCompose: over.onCompose } : {})} />;
    }
    render(<Harness />);
    return props;
}

const card = (id: string) => document.querySelector(`[data-anti="${id}"]`) as HTMLElement;
const LAYER_GROUP = 'partition-violation:upward:domain>application';

describe('PatternsPanel anti-pattern groups', () => {
    it('folds the findings into one card per group, with the layer pair, the count, the arrow and the reason', () => {
        mount();
        expect(document.querySelectorAll('[data-anti]')).toHaveLength(2);
        const layer = card(LAYER_GROUP);
        expect(layer.textContent).toContain('Domain → Application');
        expect(layer.textContent).toContain('40 links in 3 files');
        expect(layer.querySelector('[data-diagram="layerArrow"]')).not.toBeNull();
        expect(layer.textContent).toContain('should not depend on');
        expect(screen.getByTestId('kg-anti-total').textContent).toContain('41 anti-patterns');
    });

    it('selects groups, counts them in the footer and previews; Apply sends ONE batched compose and the host applies codemod kinds', async () => {
        const applyFix = vi.fn(async () => ({ changed: ['db/repo.ts'], fixId: 'x' }));
        const props = mount({ scopes: async () => [], load: async () => null, applyFix });
        const preview = screen.getByRole('button', { name: /Preview 0 fixes/ }) as HTMLButtonElement;
        expect(preview.disabled).toBe(true);
        fireEvent.click(within(card(LAYER_GROUP)).getByRole('checkbox'));
        fireEvent.click(within(card('unused-export')).getByRole('checkbox'));
        expect(screen.getByTestId('kg-anti-selected').textContent).toBe('2 groups selected');
        fireEvent.click(screen.getByRole('button', { name: 'Preview 2 fixes' }));
        expect(screen.getByTestId('kg-patterns-preview')).toBeTruthy();
        expect(document.querySelectorAll('[data-testid="kg-before-after"]')).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: 'Apply 2 fixes' }));
        await waitFor(() => expect(seen.surface!.panel).toBe('resolve'));
        expect(props.onCompose).toHaveBeenCalledTimes(1);
        const text = props.onCompose.mock.calls[0]![0] as string;
        expect(text).toContain('+30 more of this kind');
        expect(text.split('\n').length).toBeLessThan(20);
        expect(applyFix).toHaveBeenCalledTimes(1);
        expect(applyFix).toHaveBeenCalledWith(unused);
        expect(props.onChanged).toHaveBeenCalled();
    });

    it('changing the layer filter or the kind chip clears the selection', () => {
        mount();
        fireEvent.click(within(card(LAYER_GROUP)).getByRole('checkbox'));
        expect(screen.getByTestId('kg-anti-selected').textContent).toBe('1 group selected');
        fireEvent.click(document.querySelectorAll('[data-anti-cell] button')[0]!);
        expect(screen.getByTestId('kg-anti-selected').textContent).toBe('0 groups selected');
        fireEvent.click(screen.getByRole('button', { name: L.surface.patterns.clearFilter }));
        fireEvent.click(within(card(LAYER_GROUP)).getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /^Unused exports? ·/ }));
        expect(screen.getByTestId('kg-anti-selected').textContent).toBe('0 groups selected');
    });

    it('a codemod that fails with no composer is reported, not lost, and Resolve is offered for it', async () => {
        const applyFix = vi.fn(async () => { throw new Error('nope'); });
        mount({ scopes: async () => [], load: async () => null, applyFix }, { onCompose: undefined });
        fireEvent.click(within(card('unused-export')).getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Preview 1 fix' }));
        fireEvent.click(screen.getByRole('button', { name: 'Apply 1 fix' }));
        const failed = await screen.findByTestId('kg-apply-failed');
        expect(failed.textContent).toContain('1 fix could not be applied');
        expect((screen.getByRole('button', { name: 'Apply 1 fix' }) as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(within(failed).getByRole('button'));
        expect(seen.surface!.resolving?.id).toBe('ue1');
    });

    it('shows an error line and frees the Apply button when applying throws', async () => {
        const onCompose = vi.fn(() => { throw new Error('composer down'); });
        mount(undefined, { onCompose });
        fireEvent.click(within(card(LAYER_GROUP)).getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Preview 1 fix' }));
        fireEvent.click(screen.getByRole('button', { name: 'Apply 1 fix' }));
        await screen.findByTestId('kg-apply-error');
        expect((screen.getByRole('button', { name: 'Apply 1 fix' }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('Back returns to the list; clicking an Anti-pattern cell narrows the list to that layer', () => {
        mount();
        fireEvent.click(within(card(LAYER_GROUP)).getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Preview 1 fix' }));
        fireEvent.click(screen.getByRole('button', { name: L.surface.patterns.backToPatterns }));
        expect(screen.getByTestId('kg-anti-list')).toBeTruthy();
        const cells = document.querySelectorAll('[data-anti-cell] button');
        expect(cells.length).toBeGreaterThan(0);
        fireEvent.click(cells[0]!);
        expect(screen.getByRole('button', { name: L.surface.patterns.clearFilter })).toBeTruthy();
    });
});
