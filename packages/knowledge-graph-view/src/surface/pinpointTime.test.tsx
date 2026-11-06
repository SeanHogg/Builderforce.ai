// @vitest-environment jsdom
/** The ask bar's screenshot input and the header's time slider. */
import { describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { surfaceFixture } from '../testing';
import type { Commit, KnowledgeGraphSource, PinpointResult } from '../types';
import { PinpointInput } from './PinpointInput';
import { buildStations } from './stations';
import { TimeSlider, useHistory } from './TimeSlider';
import { MAX_IMAGE_BYTES } from './usePinpoint';

const graph = surfaceFixture();
const stations = buildStations(graph);
const base: KnowledgeGraphSource = { scopes: async () => [], load: async () => null };
const png = () => new File(['x'], 'shot.png', { type: 'image/png' });
const result: PinpointResult = {
    description: 'A card stuck on Judging',
    anchors: [{ text: 'Judging', provenance: 'vision' }],
    matches: [
        { ref: 'src:sys::api/routes.ts', why: 'exact string', provenance: 'exact' },
        { ref: 'src:sys::db/repo.ts', why: 'imported by routes', provenance: 'import' },
    ],
};

function mount(pinpoint: KnowledgeGraphSource['pinpoint'], rootId = 'sys') {
    const props = { onMatches: vi.fn(), onSelect: vi.fn(), onCompose: vi.fn(), onClear: vi.fn() };
    const view = render(
        <PinpointInput source={{ ...base, ...(pinpoint ? { pinpoint } : {}) }} rootId={rootId} graph={graph} stations={stations} labels={L} {...props}>
            <input aria-label="ask" />
        </PinpointInput>,
    );
    return { ...props, view };
}

const big = () => new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'big.png', { type: 'image/png' });

describe('PinpointInput', () => {
    it('is only the ask bar\'s own controls when the source cannot pinpoint', () => {
        mount(undefined);
        expect(screen.getByLabelText('ask')).toBeTruthy();
        expect(screen.queryByTestId('kg-pinpoint')).toBeNull();
    });

    it('reads a picked screenshot, shows the thumbnail state, the description, anchors and matches with provenance', async () => {
        const pinpoint = vi.fn().mockResolvedValue(result);
        const props = mount(pinpoint);
        fireEvent.change(screen.getByTestId('kg-pinpoint-file'), { target: { files: [png()] } });
        expect(pinpoint).toHaveBeenCalledWith(expect.any(File), 'sys');
        expect(await screen.findByText(result.description)).toBeTruthy();
        expect(document.querySelectorAll('[data-match]')).toHaveLength(2);
        expect(document.querySelector('[data-match="src:sys::db/repo.ts"]')!.textContent).toContain(L.surface.pinpointProvenance.import);
        expect(screen.getByText(L.surface.pinpointProvenance.vision)).toBeTruthy();
        expect(props.onMatches).toHaveBeenCalledWith(['src:sys::api/routes.ts', 'src:sys::db/repo.ts']);
    });

    it('catches a pasted image anywhere on the bar and a dropped one', async () => {
        const pinpoint = vi.fn().mockResolvedValue({ ...result, matches: [] });
        mount(pinpoint);
        fireEvent.paste(screen.getByLabelText('ask'), { clipboardData: { files: [png()] } });
        expect(await screen.findByText(L.surface.pinpoint.noMatch)).toBeTruthy();
        fireEvent.drop(screen.getByTestId('kg-pinpoint'), { dataTransfer: { files: [png()] } });
        await waitFor(() => expect(pinpoint).toHaveBeenCalledTimes(2));
    });

    it('does not send a file that is not an image, and shows an error state when the host fails', async () => {
        const pinpoint = vi.fn().mockRejectedValue(new Error('x'));
        mount(pinpoint);
        fireEvent.change(screen.getByTestId('kg-pinpoint-file'), { target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } });
        expect((await screen.findByRole('alert')).textContent).toBe(L.surface.pinpoint.notImage);
        expect(pinpoint).not.toHaveBeenCalled();
        fireEvent.change(screen.getByTestId('kg-pinpoint-file'), { target: { files: [png()] } });
        await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(L.surface.pinpoint.failed));
    });

    it('Diagnose with the agent composes the description, the matched path and its findings', async () => {
        const props = mount(vi.fn().mockResolvedValue(result));
        fireEvent.change(screen.getByTestId('kg-pinpoint-file'), { target: { files: [png()] } });
        fireEvent.click(await screen.findByRole('button', { name: L.surface.pinpoint.diagnose }));
        const text = props.onCompose.mock.calls[0]![0] as string;
        expect(text).toContain(result.description);
        expect(text).toContain('API → repositories');
        expect(text).not.toContain('{description}');
    });

    it('selecting a match goes through onSelect, and Clear empties the result', async () => {
        const props = mount(vi.fn().mockResolvedValue(result));
        fireEvent.change(screen.getByTestId('kg-pinpoint-file'), { target: { files: [png()] } });
        await screen.findByText(result.description);
        fireEvent.click(document.querySelector('[data-match="src:sys::api/routes.ts"] button')!);
        expect(props.onSelect).toHaveBeenCalledWith('src:sys::api/routes.ts');
        fireEvent.click(screen.getByRole('button', { name: L.surface.pinpoint.clearAria }));
        expect(screen.queryByText(result.description)).toBeNull();
    });
});

describe('PinpointInput limits and cleanup', () => {
    it('rejects an image over 8 MB with its own message and sends nothing', async () => {
        const pinpoint = vi.fn().mockResolvedValue(result);
        mount(pinpoint);
        fireEvent.change(screen.getByTestId('kg-pinpoint-file'), { target: { files: [big()] } });
        expect((await screen.findByRole('alert')).textContent).toBe(fillTemplate(L.surface.imageTooLarge, { size: 8 }));
        expect(pinpoint).not.toHaveBeenCalled();
    });

    it('releases the thumbnail when it is replaced, cleared and when the input goes away; Clear also tells the root', async () => {
        let n = 0;
        const revoke = vi.fn();
        Object.assign(URL, { createObjectURL: vi.fn(() => `blob:t${++n}`), revokeObjectURL: revoke });
        const { onClear, view } = mount(vi.fn().mockResolvedValue(result));
        fireEvent.change(screen.getByTestId('kg-pinpoint-file'), { target: { files: [png()] } });
        await screen.findByText(result.description);
        fireEvent.change(screen.getByTestId('kg-pinpoint-file'), { target: { files: [png()] } });
        expect(revoke).toHaveBeenCalledWith('blob:t1');
        await screen.findByText(result.description);
        fireEvent.click(screen.getByRole('button', { name: L.surface.pinpoint.clearAria }));
        expect(revoke).toHaveBeenCalledWith('blob:t2');
        expect(onClear).toHaveBeenCalledTimes(1);
        fireEvent.change(screen.getByTestId('kg-pinpoint-file'), { target: { files: [png()] } });
        await screen.findByText(result.description);
        view.unmount();
        expect(revoke).toHaveBeenCalledWith('blob:t3');
    });

    it('forgets the old screenshot when the root changes', async () => {
        const pinpoint = vi.fn().mockResolvedValue(result);
        const props = { onMatches: vi.fn(), onSelect: vi.fn() };
        const el = (rootId: string) => (
            <PinpointInput source={{ ...base, pinpoint }} rootId={rootId} graph={graph} stations={stations} labels={L} {...props}><input aria-label="ask" /></PinpointInput>
        );
        const { rerender } = render(el('a'));
        fireEvent.change(screen.getByTestId('kg-pinpoint-file'), { target: { files: [png()] } });
        await screen.findByText(result.description);
        rerender(el('b'));
        expect(screen.queryByText(result.description)).toBeNull();
    });

    it('shows the drop state only for a drag that carries files', () => {
        mount(vi.fn().mockResolvedValue(result));
        const bar = screen.getByTestId('kg-pinpoint');
        // jsdom has no DataTransfer and ignores relatedTarget in an event init: put both on the event itself.
        const drag = (type: 'dragOver' | 'dragLeave', props: Record<string, unknown>) => {
            const event = createEvent[type](bar);
            for (const [key, value] of Object.entries(props)) Object.defineProperty(event, key, { value });
            fireEvent(bar, event);
        };
        drag('dragOver', { dataTransfer: { types: ['text/plain'] } });
        expect(screen.queryByText(L.surface.pinpoint.dropHere)).toBeNull();
        drag('dragOver', { dataTransfer: { types: ['Files'] } });
        expect(screen.getByText(L.surface.pinpoint.dropHere)).toBeTruthy();
        drag('dragLeave', { relatedTarget: screen.getByLabelText('ask') });
        expect(screen.getByText(L.surface.pinpoint.dropHere)).toBeTruthy(); // moving onto a child is not leaving
        drag('dragLeave', { relatedTarget: document.body });
        expect(screen.queryByText(L.surface.pinpoint.dropHere)).toBeNull();
    });
});

const commits: Commit[] = [
    { sha: 'a1', title: 'first', at: '2026-01-01', refs: ['src:sys::db/repo.ts'] },
    { sha: 'b2', title: 'second', at: '2026-01-02', refs: ['src:sys::web/page.tsx'] },
];

describe('TimeSlider', () => {
    it('draws nothing without commits', () => {
        const { container } = render(<TimeSlider commits={[]} picked={null} labels={L} onPick={vi.fn()} changedStations={0} />);
        expect(container.innerHTML).toBe('');
    });

    it('a dot per commit; picking one reports it, picking it again goes back to Now; arrows step', () => {
        const onPick = vi.fn();
        const { rerender } = render(<TimeSlider commits={commits} picked={null} labels={L} onPick={onPick} changedStations={0} />);
        fireEvent.click(screen.getByRole('button', { name: fillTemplate(L.surface.time.commitAria, { title: 'first', at: '2026-01-01' }) }));
        expect(onPick).toHaveBeenLastCalledWith('a1');
        rerender(<TimeSlider commits={commits} picked="a1" labels={L} onPick={onPick} changedStations={1} />);
        expect(screen.getByRole('status').textContent).toBe(fillTemplate(L.surface.time.changed, { count: 1 }));
        fireEvent.keyDown(screen.getByTestId('kg-time'), { key: 'ArrowRight' });
        expect(onPick).toHaveBeenLastCalledWith('b2');
        fireEvent.click(screen.getByRole('button', { name: L.surface.time.now }));
        expect(onPick).toHaveBeenLastCalledWith(null);
    });

    it('useHistory yields nothing for a source with no history, and the commits oldest first otherwise', async () => {
        const seen: Array<ReturnType<typeof useHistory>> = [];
        function Probe({ source }: { source: KnowledgeGraphSource }) { seen.push(useHistory(source, 'sys')); return null; }
        render(<Probe source={base} />);
        // No history port: nothing to load, so never "loading".
        expect(seen.at(-1)).toEqual({ commits: [], total: 0, loading: false });
        render(<Probe source={{ ...base, history: async () => ({ commits: [...commits].reverse() }) }} />);
        await waitFor(() => expect(seen.at(-1)!.commits.map((c) => c.sha)).toEqual(['a1', 'b2']));
    });

    it('says out loud when only the latest commits are drawn', () => {
        render(<TimeSlider commits={commits} capped={commits.length + 60} picked={null} labels={L} onPick={vi.fn()} changedStations={0} />);
        expect(screen.getByTestId('kg-time-capped').textContent).toBe(fillTemplate(L.surface.historyCapped, { count: commits.length }));
        expect(screen.queryByTestId('kg-time-capped')).not.toBeNull();
    });
});
