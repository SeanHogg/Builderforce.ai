import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canvasActionOutcomes } from '@builderforce/creation-canvas-contract';
import { canvasActOutcomeBodies } from '@/lib/recordCanvasActOutcome';
import { OfficeExportUnavailableError } from '@/lib/exportApi';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import { useCanvasArtifactExport, type UseCanvasArtifactExportDeps } from './useCanvasArtifactExport';

const mocks = vi.hoisted(() => ({
  recordCanvasActOutcomes: vi.fn(),
  downloadText: vi.fn(),
  downloadJson: vi.fn(),
  downloadBlob: vi.fn(),
  copyTextToClipboard: vi.fn(),
  exportDocx: vi.fn(),
  exportPdf: vi.fn(),
  exportPptx: vi.fn(),
  exportXlsx: vi.fn(),
  exportCsv: vi.fn(),
}));

vi.mock('@/lib/recordCanvasActOutcome', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/recordCanvasActOutcome')>();
  return { ...actual, recordCanvasActOutcomes: mocks.recordCanvasActOutcomes };
});
vi.mock('@/lib/download', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/download')>();
  return {
    ...actual,
    downloadText: mocks.downloadText,
    downloadJson: mocks.downloadJson,
    downloadBlob: mocks.downloadBlob,
  };
});
vi.mock('@/lib/useCopyToClipboard', () => ({
  copyTextToClipboard: mocks.copyTextToClipboard,
}));
vi.mock('@/lib/exportApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/exportApi')>();
  return {
    ...actual,
    exportDocx: mocks.exportDocx,
    exportPdf: mocks.exportPdf,
    exportPptx: mocks.exportPptx,
    exportXlsx: mocks.exportXlsx,
    exportCsv: mocks.exportCsv,
  };
});

const t = ((key: string) => key) as UseCanvasArtifactExportDeps['t'];

function note(id = 'n-1', extra: Record<string, unknown> = {}): CanvasObject {
  return {
    id,
    type: 'creation',
    position: { x: 0, y: 0 },
    data: { kind: 'note', title: 'Brief', content: 'Hello', ...extra },
  };
}

function harness(
  nodes: CanvasObject[],
  overrides: { persistence?: 'local' | 'server'; sessionId?: string | null } = {},
) {
  const setNotice = vi.fn();
  const setNodes = vi.fn();
  const hook = renderHook(() => useCanvasArtifactExport({
    edges: [],
    nodes,
    persistence: overrides.persistence ?? 'server',
    sessionId: Object.prototype.hasOwnProperty.call(overrides, 'sessionId')
      ? overrides.sessionId
      : 'ses-1',
    setNodes,
    setNotice,
    t,
  }));
  return { ...hook, setNotice, setNodes };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.copyTextToClipboard.mockResolvedValue(true);
  mocks.exportDocx.mockResolvedValue(undefined);
});

describe('useCanvasArtifactExport outcome ledger', () => {
  it('falls back to artifact.export rather than a delivery verb', () => {
    expect(canvasActionOutcomes('artifact', 'export')).toEqual([
      { action: 'artifact.export', successPhase: 'succeeded' },
    ]);
  });

  it('records started then succeeded on one correlationId after a real download', async () => {
    const { result, setNodes } = harness([note()]);
    let message = '';
    await act(async () => {
      message = await result.current.exportArtifact('n-1', 'markdown');
    });
    expect(message).toBe('downloadReady');
    expect(mocks.downloadText).toHaveBeenCalled();
    expect(setNodes).toHaveBeenCalledTimes(1);
    expect(mocks.recordCanvasActOutcomes).toHaveBeenCalledTimes(1);
    expect(mocks.recordCanvasActOutcomes).toHaveBeenCalledWith({
      sessionId: 'ses-1',
      kind: 'artifact',
      action: 'export',
      objectId: 'n-1',
    });
    const bodies = canvasActOutcomeBodies({
      sessionId: 'ses-1',
      kind: 'artifact',
      action: 'export',
      objectId: 'n-1',
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({
      correlationId: 'act:n-1:artifact.export',
      action: 'artifact.export',
      phase: 'started',
    });
    expect(bodies[1]).toMatchObject({
      correlationId: 'act:n-1:artifact.export',
      action: 'artifact.export',
      phase: 'succeeded',
    });
    expect(bodies[0]!.correlationId).toBe(bodies[1]!.correlationId);
  });

  it('records after a successful office export', async () => {
    const { result } = harness([note()]);
    await act(async () => {
      await result.current.exportArtifact('n-1', 'docx');
    });
    expect(mocks.exportDocx).toHaveBeenCalled();
    expect(mocks.recordCanvasActOutcomes).toHaveBeenCalledTimes(1);
    expect(mocks.recordCanvasActOutcomes).toHaveBeenCalledWith({
      sessionId: 'ses-1',
      kind: 'artifact',
      action: 'export',
      objectId: 'n-1',
    });
  });

  it('records a degraded office fallback as a success, not a failure', async () => {
    mocks.exportDocx.mockRejectedValue(new OfficeExportUnavailableError('guest cap'));
    const { result } = harness([note()]);
    let message = '';
    await act(async () => {
      message = await result.current.exportArtifact('n-1', 'docx');
    });
    expect(message).toBe('markdownDownloadedUsePdf');
    expect(mocks.downloadText).toHaveBeenCalled();
    expect(mocks.recordCanvasActOutcomes).toHaveBeenCalledTimes(1);
  });

  it('does not record a copy — the clipboard path never writes a deliverable', async () => {
    const { result, setNodes } = harness([note()]);
    await act(async () => {
      await result.current.exportArtifact('n-1', 'copy');
    });
    expect(mocks.copyTextToClipboard).toHaveBeenCalled();
    expect(setNodes).not.toHaveBeenCalled();
    expect(mocks.recordCanvasActOutcomes).not.toHaveBeenCalled();
  });

  it('does not record when the object is missing', async () => {
    const { result } = harness([note()]);
    let message = '';
    await act(async () => {
      message = await result.current.exportArtifact('missing', 'markdown');
    });
    expect(message).toBe('exportFailed');
    expect(mocks.recordCanvasActOutcomes).not.toHaveBeenCalled();
  });

  it('does not record a confidentiality refusal', async () => {
    const restricted: CanvasObject = {
      id: 'case-1',
      type: 'creation',
      position: { x: 0, y: 0 },
      data: { kind: 'case', title: 'HR case' },
    };
    const { result, setNodes } = harness([restricted]);
    let message = '';
    await act(async () => {
      message = await result.current.exportArtifact('case-1', 'markdown');
    });
    expect(message).toBe('exportRestricted');
    expect(setNodes).not.toHaveBeenCalled();
    expect(mocks.recordCanvasActOutcomes).not.toHaveBeenCalled();
  });

  it('does not record a dataset-use refusal', async () => {
    const dataset: CanvasObject = {
      id: 'ds-1',
      type: 'creation',
      position: { x: 0, y: 0 },
      data: {
        kind: 'dataset',
        title: 'Leads',
        dataUse: { purposes: ['training'] },
      },
    };
    const { result, setNotice, setNodes } = harness([dataset]);
    let message = '';
    await act(async () => {
      message = await result.current.exportArtifact('ds-1', 'markdown');
    });
    expect(message).toMatch(/export/);
    expect(setNotice).toHaveBeenCalled();
    expect(setNodes).not.toHaveBeenCalled();
    expect(mocks.recordCanvasActOutcomes).not.toHaveBeenCalled();
  });

  it('does not record a thrown export as a terminal outcome', async () => {
    mocks.exportDocx.mockRejectedValue(new Error('render fault'));
    const { result, setNodes } = harness([note()]);
    let message = '';
    await act(async () => {
      message = await result.current.exportArtifact('n-1', 'docx');
    });
    expect(message).toBe('render fault');
    expect(setNodes).not.toHaveBeenCalled();
    expect(mocks.recordCanvasActOutcomes).not.toHaveBeenCalled();
  });

  it('does not record on an unsaved board', async () => {
    const { result, setNodes } = harness([note()], { persistence: 'local', sessionId: 'local-abc' });
    await act(async () => {
      await result.current.exportArtifact('n-1', 'markdown');
    });
    expect(setNodes).toHaveBeenCalled();
    expect(mocks.recordCanvasActOutcomes).not.toHaveBeenCalled();
  });

  it('does not record without a sessionId', async () => {
    const { result, setNodes } = harness([note()], { sessionId: null });
    await act(async () => {
      await result.current.exportArtifact('n-1', 'markdown');
    });
    expect(setNodes).toHaveBeenCalled();
    expect(mocks.recordCanvasActOutcomes).not.toHaveBeenCalled();
  });
});
