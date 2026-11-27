/**
 * The diagram picker: the C4 drill-down (selecting an element opens the next level for it; picking from the list clears
 * the anchor) and the views the 3D stage already draws (picking one switches the camera and opens no board).
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { pathOf } from '../../graphModel';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import type { DiagramId } from '../../surface/diagrams/catalog';
import { buildStations } from '../../surface/stations';
import { surfaceFixture } from '../../testing';
import type { ViewMode } from '../../types';
import { DiagramPicker } from './DiagramPicker';

const base = surfaceFixture();
const tag = (path: string): Partial<KNode> =>
    path.startsWith('web/') ? { system: 'ui', app: 'web' } : path.startsWith('api/') ? { system: 'srv', app: 'api' }
        : path.startsWith('db/') ? { system: 'srv', app: 'db' } : {};
const graph = { ...base, nodes: base.nodes.map((node) => ({ ...node, ...tag(pathOf(node.ref) ?? '') })) } as typeof base;
const stations = buildStations(graph).stations;
const t = L.surface.code;

function Harness({ start = null, project = graph, scope = null, onCamera, cameras, onLoadSymbols }: {
    start?: DiagramId | null; scope?: string | null; project?: typeof graph; onCamera?: (mode: ViewMode) => void;
    cameras?: readonly ViewMode[]; onLoadSymbols?: (ref: string) => void;
}) {
    const [active, setActive] = useState<DiagramId | null>(start);
    return <DiagramPicker active={active} onPick={setActive} graph={project} records={[]} scope={scope} stations={stations}
        labels={L} onOpen={vi.fn()} onCamera={onCamera} cameras={cameras} onLoadSymbols={onLoadSymbols} />;
}

const select = () => screen.getByRole('combobox', { name: t.diagramUml }) as HTMLSelectElement;
const optionOf = (id: string) => select().querySelector(`option[value="${id}"]`);

describe('DiagramPicker C4 drill-down', () => {
    it('opens the next level, scoped to the element selected, and a pick from the list clears that scope', () => {
        const onLoadSymbols = vi.fn();
        render(<Harness start="c4Context" onLoadSymbols={onLoadSymbols} />);
        expect(screen.getByRole('button', { name: 'ui' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'srv' }));
        expect(select().value).toBe('c4Containers');
        expect(screen.getByRole('button', { name: 'api' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'web' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'api' }));
        expect(select().value).toBe('c4Components');
        expect(screen.queryByRole('button', { name: 'db' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'api' }));
        expect(select().value).toBe('c4Code');
        expect(onLoadSymbols).toHaveBeenCalledOnce();

        fireEvent.change(select(), { target: { value: 'c4Context' } });
        fireEvent.change(select(), { target: { value: 'c4Containers' } });
        expect(screen.getByRole('button', { name: 'web' })).toBeTruthy();
    });

    it('discards the drill position across projects, even when returning to the first project', () => {
        const { rerender } = render(<Harness start="c4Context" />);
        fireEvent.click(screen.getByRole('button', { name: 'srv' }));
        expect(screen.queryByRole('button', { name: 'web' })).toBeNull();
        const anotherProject = { ...graph, scope: { ...graph.scope, rootId: `${graph.scope.rootId}-second` as typeof graph.scope.rootId } };
        rerender(<Harness project={anotherProject} />);
        expect(screen.getByRole('button', { name: 'web' })).toBeTruthy();
        rerender(<Harness />);
        expect(screen.getByRole('button', { name: 'web' })).toBeTruthy();
    });
});

describe('DiagramPicker drill position', () => {
    it('keeps the drill position through a camera pick, which closes the board', () => {
        const onCamera = vi.fn();
        const { container } = render(<Harness start="c4Context" onCamera={onCamera} cameras={['sequence']} />);
        fireEvent.click(screen.getByRole('button', { name: 'srv' }));
        expect(select().value).toBe('c4Containers');
        fireEvent.change(select(), { target: { value: 'sequenceDiagram' } });
        expect(onCamera).toHaveBeenCalledWith('sequence');
        expect(select().value).toBe('');
        expect(container.querySelector('[data-diagram-pane]')).toBeNull();
    });

    it('ends the drill position when the scope on the stage changes', () => {
        const { rerender } = render(<Harness start="c4Context" />);
        fireEvent.click(screen.getByRole('button', { name: 'srv' }));
        expect(screen.queryByRole('button', { name: 'web' })).toBeNull();
        rerender(<Harness scope="elsewhere" />);
        expect(screen.getByRole('button', { name: 'web' })).toBeTruthy();
    });
});

describe('DiagramPicker stage views', () => {
    it('switches the camera and opens no board when the stage draws the view', () => {
        const onCamera = vi.fn();
        const { container } = render(<Harness start="dsm" onCamera={onCamera} cameras={['sequence', '3d']} />);
        fireEvent.change(select(), { target: { value: 'sequenceDiagram' } });
        expect(onCamera).toHaveBeenCalledWith('sequence');
        expect(container.querySelector('[data-diagram-pane]')).toBeNull();
        expect(select().value).toBe('');

        fireEvent.change(select(), { target: { value: 'codeCity' } });
        expect(onCamera).toHaveBeenLastCalledWith('3d');
        expect(container.querySelector('[data-diagram-pane]')).toBeNull();
    });

    it('omits them without a camera switch, or when the camera is not available', () => {
        const { unmount } = render(<Harness />);
        for (const id of ['sequenceDiagram', 'msc', 'codeCity']) expect(optionOf(id)).toBeNull();
        expect(optionOf('communicationDiagram')).not.toBeNull();
        unmount();

        render(<Harness onCamera={vi.fn()} cameras={['sequence']} />);
        expect(optionOf('sequenceDiagram')).not.toBeNull();
        expect(optionOf('msc')).not.toBeNull();
        expect(optionOf('codeCity')).toBeNull();
    });
});
