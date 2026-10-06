import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import type { Edge } from '@xyflow/react';
import { fetchSite, type SiteInfo, type SitePublishResult } from '@/lib/api';
import { notifySitePublished } from '@/lib/sitePublishEvents';
import { readinessSignals } from '@/lib/canvasPhaseReadiness';
import type { CreationFlowNode } from '../CreationNode';
import { useRecordAppDeployments, type UseRecordAppDeploymentsDeps } from './useRecordAppDeployments';

vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), fetchSite: vi.fn() }));

/**
 * A publish from the App surface's Publish panel — or a site that was already live — puts
 * a deployment card on the board, so the board stops saying "nothing deployed" about an
 * app that is on the web.
 */
const t = ((key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key)) as unknown as UseRecordAppDeploymentsDeps['t'];
const app: CreationFlowNode = { id: 'app', type: 'creation', position: { x: 100, y: 100 }, data: { kind: 'build', title: 'Yard app', ideProjectId: 7, storageProjectId: 70 } as CreationFlowNode['data'] };
const published: SitePublishResult = { subdomain: 'yard', versionToken: 'v2', assetCount: 3, totalBytes: 900, url: 'https://yard.builderforce.app', pathUrl: 'https://builderforce.app/s/yard' };
const site = (url: string): SiteInfo => ({ subdomain: 'yard', mode: 'static', status: 'live', versionToken: 'v1', assetCount: 3, totalBytes: 900, publishedAt: '2026-09-01T00:00:00Z', url, pathUrl: url });

function renderBoard(initial: CreationFlowNode[], options: { editable?: boolean; edges?: Edge[] } = {}) {
  const setNotice = vi.fn();
  const hook = renderHook(() => {
    const [nodes, setNodes] = useState(initial);
    const [edges, setEdges] = useState<Edge[]>(options.edges ?? []);
    const placeAppendedRef = useRef((_current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => [...additions]);
    useRecordAppDeployments({ editable: options.editable ?? true, edges, nodes, placeAppendedRef, setEdges, setNodes, setNotice, t });
    return { nodes, edges };
  });
  return { ...hook, setNotice };
}

const deployments = (nodes: readonly CreationFlowNode[]) => nodes.filter((node) => node.data.kind === 'deployment');

describe('useRecordAppDeployments', () => {
  beforeEach(() => {
    vi.mocked(fetchSite).mockReset();
    vi.mocked(fetchSite).mockResolvedValue(null);
  });

  it('records a publish as a live deployment card connected to its app, and says so', async () => {
    const { result, setNotice } = renderBoard([app]);
    await waitFor(() => expect(fetchSite).toHaveBeenCalledWith(70));
    expect(readinessSignals(result.current.nodes).isLive).toBe(false);

    act(() => notifySitePublished(70, published));

    const [card] = deployments(result.current.nodes);
    expect(card?.data).toMatchObject({ kind: 'deployment', url: 'https://yard.builderforce.app', version: 'v2', environmentName: 'production', status: 'live' });
    expect(result.current.edges).toEqual([expect.objectContaining({ source: 'app', target: card!.id, data: { connectionKind: 'delivery' } })]);
    expect(readinessSignals(result.current.nodes).isLive).toBe(true);
    expect(setNotice).toHaveBeenCalledWith('appPublish.recorded:{"url":"https://yard.builderforce.app"}');
  });

  it('a re-publish updates the same card', async () => {
    const { result } = renderBoard([app]);
    await waitFor(() => expect(fetchSite).toHaveBeenCalled());
    act(() => notifySitePublished(70, published));
    act(() => notifySitePublished(70, { ...published, versionToken: 'v3' }));
    expect(deployments(result.current.nodes)).toHaveLength(1);
    expect(deployments(result.current.nodes)[0]!.data.version).toBe('v3');
  });

  it('ignores a publish of a project that is not one of this board’s apps', async () => {
    const { result, setNotice } = renderBoard([app]);
    await waitFor(() => expect(fetchSite).toHaveBeenCalled());
    act(() => notifySitePublished(999, published));
    expect(deployments(result.current.nodes)).toHaveLength(0);
    expect(setNotice).not.toHaveBeenCalled();
  });

  it('records an app that was ALREADY live when the board opened, quietly', async () => {
    vi.mocked(fetchSite).mockResolvedValue(site('https://already.example'));
    const { result, setNotice } = renderBoard([app]);
    await waitFor(() => expect(deployments(result.current.nodes)).toHaveLength(1));
    expect(deployments(result.current.nodes)[0]!.data).toMatchObject({ url: 'https://already.example', deployedAt: '2026-09-01T00:00:00Z' });
    expect(setNotice).not.toHaveBeenCalled();
  });

  it('costs no request for an app whose card is already on the board', async () => {
    const card: CreationFlowNode = { id: 'd1', type: 'creation', position: { x: 0, y: 0 }, data: { kind: 'deployment', title: 'Prod', url: 'https://a.example' } as CreationFlowNode['data'] };
    renderBoard([app, card], { edges: [{ id: 'e', source: 'app', target: 'd1' }] });
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(fetchSite).not.toHaveBeenCalled();
  });

  it('a viewer who cannot edit writes nothing and asks nothing', async () => {
    const { result } = renderBoard([app], { editable: false });
    act(() => notifySitePublished(70, published));
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(fetchSite).not.toHaveBeenCalled();
    expect(deployments(result.current.nodes)).toHaveLength(0);
  });
});
