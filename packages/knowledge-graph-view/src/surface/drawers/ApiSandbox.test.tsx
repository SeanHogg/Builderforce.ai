// @vitest-environment jsdom
/** The API drawer's detail and sandbox through the real panel: Send only where the source offers it. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import { surfaceFixture } from '../../testing';
import type { KnowledgeGraphSource, TryRequest, TryResponse } from '../../types';
import { useSurface } from '../useSurface';
import { ApiPanel } from './ApiPanel';

const base = surfaceFixture();
const testNode = { ...base.nodes.find((n) => n.label === 'api/routes.ts')!, ref: 'src:sys::api/routes.test.ts' as const, label: 'routes.test.ts', badges: {} };
const graph = { ...base, nodes: [...base.nodes, testNode], edges: [...base.edges, { ...base.edges[0]!, from: testNode.ref, to: 'src:sys::api/routes.ts' as const }] };
const t = L.surface.api;

const sourceWith = (tryRequest?: (req: TryRequest) => Promise<TryResponse>): KnowledgeGraphSource => ({ scopes: async () => [], load: async () => null, ...(tryRequest ? { tryRequest } : {}) });

const onShow = vi.fn();

function mount(source: KnowledgeGraphSource, onCompose: ((text: string) => void) | null = vi.fn()) {
    function Harness() {
        const surface = useSurface(graph, null);
        return <ApiPanel graph={graph} labels={L} surface={surface} source={source} onShow={onShow} onClose={vi.fn()} onCompose={onCompose ?? undefined} />;
    }
    render(<Harness />);
    return onCompose;
}

const open = (route: string) => fireEvent.click(document.querySelector(`[data-endpoint="${route}"] [data-action="select"]`)!);

describe('API drawer detail', () => {
    it('groups undocumented endpoints and shows params, tested state and caller files', () => {
        mount(sourceWith());
        expect(document.querySelector('[data-bucket="undocumented"] h3')!.textContent).toBe(fillTemplate(t.groupUndocumented, { count: 2 }));
        expect(document.querySelector('[data-bucket="contract"]')).toBeNull();
        open('GET /users/:id');
        expect(document.querySelector('[data-param="path:id"]')).not.toBeNull();
        expect(document.querySelector('[data-tested="true"]')!.textContent).toBe(t.testedYes);
        expect(document.querySelector('[data-file="src:sys::web/page.tsx"]')).not.toBeNull();
    });

    it('limits contract tests to the ticked endpoints', () => {
        const onCompose = mount(sourceWith());
        fireEvent.click(screen.getByLabelText(fillTemplate(t.selectEndpoint, { route: 'GET /users/:id' })));
        expect(screen.getByTestId('kg-api-selected').textContent).toBe(fillTemplate(t.selectedCount, { selected: 1, endpoints: '2 endpoints' }));
        fireEvent.click(screen.getByRole('button', { name: t.contractTests }));
        expect(onCompose).toHaveBeenCalledWith(fillTemplate(t.contractTestsText, { routes: 'POST /users' }));
        fireEvent.click(screen.getByLabelText(fillTemplate(t.selectEndpoint, { route: 'POST /users' })));
        expect((screen.getByRole('button', { name: t.contractTests }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByTestId('kg-api-selected').textContent).toBe(t.selectAtLeastOne);
    });
});

describe('API drawer master-detail', () => {
    it('shows ONE card for the selected endpoint, with four KPIs and coloured method badges', () => {
        mount(sourceWith());
        expect(document.querySelectorAll('[data-testid="kg-api-card"]')).toHaveLength(1);
        open('POST /users');
        const card = screen.getByTestId('kg-api-card');
        expect(card.getAttribute('aria-label')).toBe('POST /users');
        expect(card.querySelectorAll('[data-method]').length).toBe(1);
        expect(within(card).getAllByText(t.kpiParams).length).toBeGreaterThan(0);
        expect(within(card).getAllByText(t.kpiCallers).length).toBeGreaterThan(0);
        expect(within(card).getAllByText(t.kpiTests).length).toBeGreaterThan(0);
        expect(within(card).getAllByText(t.kpiContract).length).toBeGreaterThan(0);
        expect(document.querySelector('[data-endpoint="POST /users"]')!.getAttribute('data-active')).toBe('true');
    });

    it('selects the caller file on the map when its chip is chosen', () => {
        onShow.mockClear();
        mount(sourceWith());
        open('GET /users/:id');
        fireEvent.click(document.querySelector('button[data-file="src:sys::web/page.tsx"]')!);
        expect(onShow).toHaveBeenCalledWith(['src:sys::web/page.tsx']);
    });

    it('says the contract-tests control is not available here when there is no composer', () => {
        mount(sourceWith(), null);
        expect(screen.getByTestId('kg-api-compose-unavailable')).toBeTruthy();
    });
});

describe('API drawer sandbox', () => {
    it('offers no Send without the port, and says where it is available', () => {
        mount(sourceWith());
        open('POST /users');
        expect(screen.queryByRole('button', { name: t.send })).toBeNull();
        expect(screen.getByTestId('kg-api-send-unavailable').textContent).toBe(t.sendUnavailable);
        expect(screen.getByRole('button', { name: t.copyCurl })).toBeTruthy();
    });

    it('sends the built request to the typed base URL and shows status, time and body', async () => {
        const tryRequest = vi.fn().mockResolvedValue({ status: 201, headers: { 'content-type': 'application/json' }, body: '{"id":1}', ms: 12.4 });
        mount(sourceWith(tryRequest));
        open('POST /users');
        expect((screen.getByLabelText(t.baseUrl) as HTMLInputElement).value).toBe('http://localhost:3000');
        fireEvent.click(screen.getByRole('button', { name: t.send }));
        await waitFor(() => expect(screen.getByTestId('kg-api-result')).toBeTruthy());
        expect(tryRequest).toHaveBeenCalledWith({ method: 'POST', url: 'http://localhost:3000/users', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        expect(screen.getByTestId('kg-api-result').textContent).toContain(fillTemplate(t.resultStatus, { status: 201, ms: 12 }));
        expect(screen.getByTestId('kg-api-result').textContent).toContain('{"id":1}');
    });

    it('does not send until a path value is typed, and shows the host refusal', async () => {
        const tryRequest = vi.fn().mockRejectedValue(new Error('Only localhost'));
        mount(sourceWith(tryRequest));
        open('GET /users/:id');
        fireEvent.click(screen.getByRole('button', { name: t.send }));
        expect(screen.getByRole('alert').textContent).toBe(fillTemplate(t.paramMissing, { name: 'id' }));
        expect(tryRequest).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText(fillTemplate(t.paramValue, { name: 'id' })), { target: { value: '7' } });
        fireEvent.click(screen.getByRole('button', { name: t.send }));
        const failed = await screen.findByTestId('kg-api-send-failed');
        expect(failed.textContent).toBe(fillTemplate(t.sendFailed, { message: 'Only localhost' }));
    });

    it('clears the problem as soon as a field is edited', () => {
        mount(sourceWith(vi.fn()));
        open('GET /users/:id');
        fireEvent.click(screen.getByRole('button', { name: t.send }));
        expect(screen.getByRole('alert')).toBeTruthy();
        fireEvent.change(screen.getByLabelText(fillTemplate(t.paramValue, { name: 'id' })), { target: { value: '1' } });
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('survives a port that throws before it returns a promise', async () => {
        const tryRequest = vi.fn(() => { throw new Error('sync boom'); });
        mount(sourceWith(tryRequest as unknown as (req: TryRequest) => Promise<TryResponse>));
        open('POST /users');
        fireEvent.click(screen.getByRole('button', { name: t.send }));
        const failed = await screen.findByTestId('kg-api-send-failed');
        expect(failed.textContent).toBe(fillTemplate(t.sendFailed, { message: 'sync boom' }));
    });
});
