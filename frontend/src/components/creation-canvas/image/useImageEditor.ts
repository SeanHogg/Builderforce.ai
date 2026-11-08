import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CreationNodeData } from '../types';
import { storeCanvasMedia } from '@/lib/canvasMediaStore';
import { isDisplayableImageUrl } from '@/lib/creationDeliverables';
import { loadAuthedImage } from '@/lib/loadAuthedImage';
import { useExportArtifact } from '../creative/useExportArtifact';
import {
  IMAGE_EXPORT_FORMATS,
  defaultImageEdit,
  imageEditFrom,
  imageExportFileName,
  imageFormatOfMime,
  imageOutputSize,
  type ImageEdit,
  type ImageExportFormat,
} from '@/lib/creation/image/imageEdit';
import { canvasToBlob, renderImageEdit } from '@/lib/creation/image/renderImageEdit';

/** Longest edge of the live preview; the export always renders at full size. */
const PREVIEW_EDGE = 1200;

export type ImageEditorProblem = 'load' | 'export' | 'import';
interface LoadedImage { element: HTMLImageElement; width: number; height: number }

/**
 * The image editor's state: the decoded base, the edit stack on the object, the live
 * preview and the export. The base (`outputUrl`) is never rewritten by an edit; an
 * export is written as a deliverable plus the card's `thumbnailUrl`.
 */
export function useImageEditor(data: CreationNodeData, onEdit?: (patch: Partial<CreationNodeData>) => void, annotating = false) {
  const baseUrl = typeof data.outputUrl === 'string' && isDisplayableImageUrl(data.outputUrl) ? data.outputUrl.trim() : '';
  const edit = useMemo(() => imageEditFrom(data.imageEdit), [data.imageEdit]);
  // The decode result is kept WITH the url it belongs to, so a url change reads as "not loaded"
  // by derivation instead of by resetting state inside the effect.
  const [decoded, setDecoded] = useState<{ url: string; image: LoadedImage | null } | null>(null);
  const [importProblem, setImportProblem] = useState(false);
  const [importing, setImporting] = useState(false);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  /** The preview canvas's callback ref (handed out as a function, so callers never hold a ref object). */
  const bindPreview = useCallback((element: HTMLCanvasElement | null) => { canvas.current = element; }, []);
  const decodedNow = decoded?.url === baseUrl ? decoded : null;
  const loaded = decodedNow?.image ?? null;

  useEffect(() => {
    if (!baseUrl) return undefined;
    let current = true;
    // A private upload is fetched with the bearer token and decoded from a same-origin blob; a
    // remote one is loaded with CORS, or the canvas is tainted and the export refuses to encode it.
    loadAuthedImage(baseUrl).then(
      (element) => { if (current) setDecoded({ url: baseUrl, image: { element, width: element.naturalWidth, height: element.naturalHeight } }); },
      () => { if (current) setDecoded({ url: baseUrl, image: null }); },
    );
    return () => { current = false; };
  }, [baseUrl]);

  // While the pen is up, the annotation surface draws the marks live; leaving them out of the
  // picture underneath keeps them from being painted twice.
  const rendered = useMemo(() => {
    if (!loaded) return null;
    try {
      return renderImageEdit(loaded.element, loaded, annotating ? { ...edit, strokes: [] } : edit, PREVIEW_EDGE);
    } catch {
      return 'failed' as const;
    }
  }, [loaded, edit, annotating]);

  useEffect(() => {
    const target = canvas.current;
    if (!rendered || rendered === 'failed' || !target) return;
    target.width = rendered.width;
    target.height = rendered.height;
    target.getContext('2d')?.drawImage(rendered, 0, 0);
  }, [rendered]);

  const problem: ImageEditorProblem | null =
    importProblem ? 'import' : decodedNow && !decodedNow.image ? 'load' : rendered === 'failed' ? 'load' : null;

  const output = loaded ? imageOutputSize(loaded.width, loaded.height, edit) : null;

  const update = useCallback((next: ImageEdit) => { onEdit?.({ imageEdit: next } as Partial<CreationNodeData>); }, [onEdit]);

  const importFile = useCallback(async (file: File) => {
    setImporting(true);
    try {
      const source = await storeCanvasMedia(file, 'import');
      if (source.kind !== 'image') { setImportProblem(true); return; }
      onEdit?.({
        outputUrl: source.url, thumbnailUrl: source.url, outputFormat: 'Image', outputMimeType: source.mimeType, outputFileName: source.fileName,
        ...(source.width ? { imageWidth: source.width, imageHeight: source.height } : {}),
        imageEdit: defaultImageEdit(),
      } as Partial<CreationNodeData>);
      setImportProblem(false);
    } catch { setImportProblem(true); } finally { setImporting(false); }
  }, [onEdit]);

  // The one export path: render, record on the object, download. The base (`outputUrl`) is
  // never rewritten by an edit, so the export lands as a deliverable and the card's
  // thumbnail, not as the object's output.
  const exporter = useExportArtifact<ImageExportFormat>({
    data,
    artifactKind: 'image',
    onEdit,
    render: async (format, object) => {
      if (!loaded) throw new Error('image not loaded');
      const spec = IMAGE_EXPORT_FORMATS[format];
      const blob = await canvasToBlob(renderImageEdit(loaded.element, loaded, edit), spec.mimeType, spec.quality);
      // Safari answers a webp request with a PNG: name and describe what was actually encoded.
      const actual = imageFormatOfMime(blob.type) ?? format;
      const actualSpec = IMAGE_EXPORT_FORMATS[actual];
      const fileName = imageExportFileName(String(object.title ?? ''), actual);
      const size = imageOutputSize(loaded.width, loaded.height, edit);
      return {
        blob, fileName, mimeType: actualSpec.mimeType, label: actualSpec.label, detail: `${size.width}×${size.height} ${actualSpec.label}`,
        metadata: { format: actual },
        extra: (url) => ({ thumbnailUrl: url, outputFormat: actualSpec.label, outputMimeType: actualSpec.mimeType, outputFileName: fileName, imageWidth: size.width, imageHeight: size.height }) as Partial<CreationNodeData>,
      };
    },
  });
  const exportAs = exporter.run;

  return { editable: !!onEdit, baseUrl, edit, update, reset: () => update(defaultImageEdit()), loaded: !!loaded, output, bindPreview, problem: exporter.status === 'failed' ? ('export' as const) : problem, busy: importing || exporter.status === 'busy', exportStatus: exporter.status, importFile, exportAs };
}

