import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreationNodeData } from '../types';
import { downloadBlob } from '@/lib/download';
import { recordExport, type ExportedFile } from '@/lib/creation/exportArtifact';

/** `unsaved`: the file was downloaded, but could not be kept on the object (see `recordExport`). */
export type ExportStatus = 'idle' | 'busy' | 'done' | 'unsaved' | 'failed';

export interface UseExportArtifactOptions<Format extends string> {
  /** The object being edited; read at click time so an export records against the latest data. */
  data: CreationNodeData;
  artifactKind: string;
  /** Absent on a read-only view: the file is still downloaded, nothing is recorded. */
  onEdit?: ((patch: Partial<CreationNodeData>) => void) | undefined;
  /** Render one format. Receives the latest object data. */
  render: (format: Format, data: CreationNodeData) => Promise<ExportedFile & { patch?: Partial<CreationNodeData> }>;
}

/**
 * The creative editors' export button, as state: render the file, record it on the
 * object (`recordExport`), hand it to the browser. One busy/done/failed status for every
 * kind, so no editor keeps its own.
 */
export function useExportArtifact<Format extends string>(options: UseExportArtifactOptions<Format>) {
  const latest = useRef(options);
  useEffect(() => { latest.current = options; });
  const [status, setStatus] = useState<ExportStatus>('idle');
  const [format, setFormat] = useState<Format | null>(null);
  const [error, setError] = useState<unknown>(null);

  const run = useCallback(async (next: Format) => {
    setFormat(next);
    setStatus('busy');
    setError(null);
    let saved = true;
    try {
      const { data, artifactKind, onEdit, render } = latest.current;
      const { patch: renderPatch, ...file } = await render(next, data);
      if (onEdit) {
        const recorded = await recordExport(data, artifactKind, file);
        if (recorded.patch) onEdit({ ...recorded.patch, ...renderPatch });
        else saved = false;
      }
      downloadBlob(file.blob, file.fileName);
      setStatus(saved ? 'done' : 'unsaved');
    } catch (caught) {
      setError(caught);
      setStatus('failed');
    }
  }, []);

  return { status, format, error, run };
}
