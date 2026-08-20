/**
 * One engine that turns a file into canvas objects.
 *
 * A file arrives three ways — dropped on the board from the desktop, attached
 * from the composer, or picked in the inspector — and all three must produce the
 * same thing: a Word document becomes a readable document with pages, a
 * workbook becomes an editable sheet per tab, a deck becomes slides, a data
 * export becomes a queryable Dataset. Deriving that in each caller is how the
 * drop path and the picker path drift apart, so every caller reads this.
 */
import { isTabularFile, parseTabularText, profileTabular, type TabularSource } from './canvasTabularData';
import { nextDatasetVersion, rowBasis } from './canvasDatasetVersion';
import { fileExtension, fileStem } from './canvasDocuments';
import { htmlToMarkdown } from './richText';
import {
  createResumeFamily, isJsonResume, renderResumeMarkdown, resumeDocumentFromJson, resumeNodePatch,
  type CanvasResumeDocument,
} from './canvasResume';
import {
  MAX_PARSEABLE_BYTES, PAGE_BREAK_MARKER, readDocx, readPdf, readPptx, readXlsx, rtfToText,
  type OfficeSlide, type WorkbookSheet,
} from './officeFormats';
import {
  dxfPreviewSvg, meshFormatFromHint, meshPreviewSvg, parseMeshTriangles, svgDataUrl,
} from './creativeGeometry';
import {
  conversionFromGraph, diagramNotation, notationForFileName,
  type DiagramConversion, type DiagramNotation,
} from './diagramNotations';
import type { CreationObjectKind } from '@builderforce/creation-canvas-contract';

/** Text attachments Brain can read directly once they are on the canvas. */
const READABLE_TEXT_FILE = /\.(txt|md|markdown|log|xml|yaml|yml|html?|sql|ini|conf|env\.example)$/i;
const MARKDOWN_FILE = /\.(md|markdown|mdx|txt|log)$/i;
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|cs|php|sh|bash|sql|yaml|yml|toml|ini|xml|css|scss|html?|json5)$/i;
const MAX_FILE_PREVIEW_CHARS = 20_000;

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', sql: 'sql',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini', xml: 'xml', css: 'css', scss: 'scss',
  html: 'html', htm: 'html', json5: 'json',
};

/**
 * A whole page rather than a snippet. `<html>`, a doctype or a `<body>` are the
 * structural markers a fragment does not carry; a `<title>` alone is enough for
 * the "saved from a browser" case that omits the doctype.
 */
export function isHtmlDocument(source: string): boolean {
  const head = source.slice(0, 4_000);
  return /<!doctype\s+html/i.test(head)
    || /<html[\s>]/i.test(head)
    || /<body[\s>]/i.test(head)
    || /<title[\s>]/i.test(head);
}

/** The page's own `<title>`, which is nearly always better than the file name. */
export function htmlDocumentTitle(source: string): string | null {
  const match = /<title[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(source.slice(0, 8_000));
  const title = match?.[1]?.replace(/\s+/g, ' ').trim();
  return title || null;
}

export type ImportTranslator = (key: string, values?: Record<string, string | number>) => string;

export type ImportedCanvasObject = {
  kind: CreationObjectKind;
  data: Record<string, unknown>;
};

export type CanvasFileImport = {
  objects: ImportedCanvasObject[];
  /** What to tell the person, once, for the whole file. */
  notice: string;
  /** The opening question the canvas offers so a dropped file starts a
   * conversation instead of sitting there as an icon. */
  suggestedPrompt: string;
};

/**
 * Canonical Dataset fields for an imported tabular file. Shared so a sheet
 * imported through the inspector and one dropped on the board are the same
 * object — previewable on the card and queryable by Brain over every row.
 */
export function datasetObjectData(
  fileName: string,
  source: TabularSource,
  options: { mimeType?: string; subtitle: string; status: string; previousVersion?: unknown; sourceRows?: number },
): Record<string, unknown> {
  // The reproducibility envelope, attached at the ONE point rows enter the board.
  //
  // `producedAt` + `lineage` + `sourceDatasetId` could say WHICH object a number came
  // from and never WHICH VERSION of it, and re-import overwrote in place — so "recompute
  // last month's number" was not a request the board could honour, and every chart was a
  // claim about a frame that no longer existed. The hash identifies the rows, the version
  // counts the re-imports, and `basis` records how many rows survived the 500-row ceiling
  // so a derived number can never quietly look whole.
  const basis = rowBasis(source, options.sourceRows ?? null);
  return {
    title: fileName,
    fileName,
    ...(options.mimeType ? { mimeType: options.mimeType } : {}),
    columns: source.columns,
    rows: source.rows,
    sampleRows: source.rows.slice(0, 25),
    rowCount: source.rows.length,
    profile: profileTabular(source),
    basis,
    datasetVersion: nextDatasetVersion(options.previousVersion),
    fetchedAt: new Date().toISOString(),
    status: options.status,
    subtitle: options.subtitle,
  };
}

async function dataUrl(file: File): Promise<string | null> {
  if (typeof FileReader === 'undefined') return null;
  return new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/** Exported for callers building an {@link AttachmentBytesStrategy}: the same
 * base64 read this module uses for images, reused for the guest/local-canvas
 * branch of that strategy. */
export const fileToDataUrl = dataUrl;

/**
 * Where a file's bytes end up when an attachment that could not be read in the
 * browser is worth keeping for a later, server-side escalation (OCR, a
 * multimodal read) — an R2 key for a signed-in, tenant-owned session, or the
 * bytes themselves, inline, for a local/guest canvas with no tenant to upload
 * to or bill that read to. Returning `null` means "do not retain" — either the
 * caller has no strategy, or the upload/read failed.
 */
export type AttachmentBytesReference = { sourceFileKey: string } | { sourceDataUrl: string };
export type AttachmentBytesStrategy = (file: File) => Promise<AttachmentBytesReference | null>;

async function bytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function shapeLabel(t: ImportTranslator, source: TabularSource): string {
  return t('datasetShape', { rows: source.rows.length, columns: source.columns.length });
}

/** Plain text laid out as markdown paragraphs, so an extracted PDF or RTF body
 * renders as a document rather than one unbroken block. */
function textToMarkdown(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function documentObject(
  file: File,
  markdown: string,
  t: ImportTranslator,
  extra: Record<string, unknown> = {},
): ImportedCanvasObject {
  return {
    kind: 'document',
    data: {
      title: file.name,
      fileName: file.name,
      markdown,
      mimeType: file.type || 'text/markdown',
      fileSize: file.size,
      status: t('statusImported'),
      ...extra,
    },
  };
}

/**
 * A JSON Resume export, as the résumé object the template engine renders.
 *
 * Returns null for any other JSON so the caller falls through to the tabular path —
 * a genuine data export must still become a Dataset.
 */
function jsonResumeObject(file: File, source: string, t: ImportTranslator): ImportedCanvasObject | null {
  let parsed: unknown;
  try { parsed = JSON.parse(source.replace(/^﻿/, '')) as unknown; } catch { return null; }
  if (!isJsonResume(parsed)) return null;
  const document = resumeDocumentFromJson(parsed);
  const markdown = document ? renderResumeMarkdown(document) : '';
  if (!document || !markdown.trim()) return null;
  const title = stringField(document.basics?.name) || fileStem(file.name);
  return {
    kind: 'resume',
    data: {
      title,
      fileName: file.name,
      mimeType: file.type || 'application/json',
      fileSize: file.size,
      status: t('statusImported'),
      subtitle: t('resumeShape', { sections: countedResumeSections(document) }),
      ...resumeNodePatch(createResumeFamily({
        title,
        markdown,
        document,
        sourceFile: { name: file.name, mimeType: file.type || 'application/json', size: file.size },
      })),
    },
  };
}

const stringField = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/** Sections with at least one entry — what the card can honestly say it holds. */
function countedResumeSections(document: CanvasResumeDocument): number {
  return Object.values(document).filter((value) => Array.isArray(value) && value.length > 0).length
    + (stringField(document.basics?.summary) ? 1 : 0);
}

function workbookObjects(file: File, sheets: WorkbookSheet[], t: ImportTranslator): ImportedCanvasObject[] {
  const [first, ...rest] = sheets;
  if (!first) return [];
  const source: TabularSource = { columns: first.columns, rows: first.rows };
  return [{
    kind: 'spreadsheet',
    data: {
      ...datasetObjectData(file.name, source, {
        mimeType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        subtitle: rest.length
          ? t('workbookShape', { sheets: sheets.length, rows: first.rows.length, columns: first.columns.length })
          : shapeLabel(t, source),
        status: t('statusImported'),
      }),
      fileSize: file.size,
      // Every tab travels with the object so switching sheets is a card
      // interaction, not a re-import of the same workbook.
      sheets: sheets.map((sheet) => ({ name: sheet.name, columns: sheet.columns, rows: sheet.rows })),
      activeSheet: first.name,
    },
  }];
}

function slidesObject(file: File, slides: OfficeSlide[], t: ImportTranslator): ImportedCanvasObject {
  return {
    kind: 'slides',
    data: {
      title: file.name,
      fileName: file.name,
      mimeType: file.type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      fileSize: file.size,
      outputFormat: 'PPTX',
      items: slides,
      status: t('statusImported'),
      subtitle: t('deckShape', { slides: slides.length }),
    },
  };
}

/**
 * The diagram object a drawing file becomes, in whichever notation it can be
 * KEPT in.
 *
 * A notation the canvas can also WRITE is stored verbatim: the person's own
 * file comes back out of the board byte-for-byte, and nothing is lost to a
 * conversion they did not ask for. A notation this can only READ — a Visio
 * package, an ArchiMate model — is converted to draw.io on the way in, because
 * an object whose source cannot be re-read is an object that cannot be drawn,
 * edited or exported. `sourceFormat` records where it came from either way.
 */
function diagramObject(
  file: File,
  conversion: DiagramConversion,
  origin: DiagramNotation,
  t: ImportTranslator,
): ImportedCanvasObject {
  const notation = diagramNotation(conversion.format)!;
  const converted = notation.id !== origin.id;
  return {
    kind: 'diagram',
    data: {
      title: file.name,
      fileName: file.name,
      mimeType: converted ? notation.mimeType : (file.type || notation.mimeType),
      fileSize: file.size,
      diagramFormat: notation.id,
      diagram: conversion.source,
      content: conversion.source,
      sourceFormat: origin.name,
      status: t('statusImported'),
      subtitle: conversion.shapes
        ? t('diagramShape', { notation: notation.name, shapes: conversion.shapes, connections: conversion.connections })
        : notation.name,
    },
  };
}

/**
 * Read a drawing file into the diagram it holds.
 *
 * Returns `null` for a file this cannot make a diagram of, so the caller falls
 * through to its other readers rather than putting an empty box on the board —
 * which matters most for `.xml`, an extension draw.io shares with everything
 * else in the world.
 */
async function diagramObjects(file: File, t: ImportTranslator): Promise<ImportedCanvasObject[] | null> {
  const notation = notationForFileName(file.name);
  if (!notation) return null;
  const drawio = diagramNotation('drawio')!;

  // A binary container never reaches a text field, so it is read from bytes and
  // kept as draw.io — the notation this can both draw and write back.
  if (notation.readBytes) {
    const graph = await notation.readBytes(await bytes(file));
    const converted = graph ? conversionFromGraph(graph, drawio) : null;
    return converted ? [diagramObject(file, converted, notation, t)] : null;
  }

  const source = await file.text();
  if (!source.trim()) return null;
  // The extension proposes a notation; the CONTENT has to agree with it.
  if (notation.detect && !notation.detect(source)) return null;

  if (notation.write) {
    // Counted for the card, not required by it: a Mermaid sequence diagram has
    // no graph to count and is still a perfectly good diagram to keep.
    const graph = await notation.read?.(source).catch(() => null) ?? null;
    return [diagramObject(file, {
      source,
      format: notation.id,
      shapes: graph?.vertices.length ?? 0,
      connections: graph?.edges.length ?? 0,
      droppedConnections: 0,
    }, notation, t)];
  }

  const graph = await notation.read?.(source).catch(() => null) ?? null;
  const converted = graph ? conversionFromGraph(graph, drawio) : null;
  return converted ? [diagramObject(file, converted, notation, t)] : null;
}

function attachmentObject(
  file: File,
  t: ImportTranslator,
  extra: Record<string, unknown> = {},
  retained: AttachmentBytesReference | null = null,
): ImportedCanvasObject {
  return {
    kind: 'file',
    data: {
      title: file.name,
      fileName: file.name,
      subtitle: t('fileMeta', { type: file.type || t('fileGeneric'), kb: Math.max(1, Math.round(file.size / 1024)) }),
      status: t('statusAttached'),
      mimeType: file.type || 'application/octet-stream',
      fileSize: file.size,
      ...(retained ?? {}),
      ...extra,
    },
  };
}

/** The question the canvas puts in the composer after a file lands, phrased for
 * what the file turned out to be. */
function promptFor(kind: CreationObjectKind, file: File, t: ImportTranslator): string {
  const key = kind === 'spreadsheet' || kind === 'dataset' ? 'promptData'
    : kind === 'resume' ? 'promptResume'
      : kind === 'slides' ? 'promptDeck'
        : kind === 'document' ? 'promptDocument'
          : kind === 'image' ? 'promptImage'
            : kind === 'model3d' ? 'promptModel'
              : kind === 'cad' ? 'promptDrawing'
                : kind === 'diagram' ? 'promptDiagram'
                  : kind === 'code' ? 'promptCode' : 'promptFile';
  return t(key, { name: file.name });
}

function noticeFor(objects: ImportedCanvasObject[], file: File, t: ImportTranslator): string {
  const kind = objects[0]?.kind;
  const data = objects[0]?.data ?? {};
  if (kind === 'spreadsheet' || kind === 'dataset') {
    const sheets = Array.isArray(data.sheets) ? data.sheets.length : 1;
    return sheets > 1
      ? t('noticeWorkbook', { name: file.name, sheets })
      : t('noticeDataset', { name: file.name, rows: Number(data.rowCount ?? 0), columns: Array.isArray(data.columns) ? data.columns.length : 0 });
  }
  if (kind === 'resume') return t('noticeResume', { name: file.name });
  if (kind === 'slides') return t('noticeDeck', { name: file.name, slides: Array.isArray(data.items) ? data.items.length : 0 });
  if (kind === 'document') return t('noticeDocument', { name: file.name, pages: Number(data.pageCount ?? 1) });
  if (kind === 'image') return t('noticeImage', { name: file.name });
  if (kind === 'model3d') return t('noticeModel', { name: file.name, facets: Number(data.facetCount ?? 0) });
  if (kind === 'cad') return t('noticeDrawing', { name: file.name });
  if (kind === 'diagram') {
    const notation = diagramNotation(typeof data.diagramFormat === 'string' ? data.diagramFormat : null);
    const origin = typeof data.sourceFormat === 'string' ? data.sourceFormat : '';
    // A converted import SAYS it was converted. Landing a Visio drawing as a
    // draw.io diagram with no word about it looks like the file was replaced.
    return origin && origin !== notation?.name
      ? t('noticeDiagramConverted', { name: file.name, source: origin, notation: notation?.name ?? '' })
      : t('noticeDiagram', { name: file.name, notation: notation?.name ?? '' });
  }
  return t('noticeFile', { name: file.name });
}

/**
 * Read a dropped, attached, or picked file into the objects it should become.
 *
 * Container formats are parsed in the browser; anything unreadable still lands
 * as an attachment rather than being rejected, so a drop always produces
 * something on the board.
 */
export async function importCanvasFile(
  file: File,
  t: ImportTranslator,
  retainAttachmentBytes?: AttachmentBytesStrategy,
): Promise<CanvasFileImport> {
  const objects = await deriveObjects(file, t, retainAttachmentBytes);
  const resolved = objects.length ? objects : [attachmentObject(file, t)];
  return {
    objects: resolved,
    notice: noticeFor(resolved, file, t),
    suggestedPrompt: promptFor(resolved[0]!.kind, file, t),
  };
}

async function deriveObjects(file: File, t: ImportTranslator, retainAttachmentBytes?: AttachmentBytesStrategy): Promise<ImportedCanvasObject[]> {
  const extension = fileExtension(file.name);
  const oversized = file.size > MAX_PARSEABLE_BYTES;
  // A file past the parse ceiling still lands, but as an attachment — and it
  // SAYS why. Silently downgrading a 60MB report to an icon looked identical to
  // a reader that had failed, so nobody knew the size was the reason.
  if (oversized) {
    return [attachmentObject(file, t, {
      status: t('statusTooLarge'),
      subtitle: t('tooLargeShape', { limit: Math.round(MAX_PARSEABLE_BYTES / (1024 * 1024)) }),
    })];
  }

  // Every drawing notation, in one branch, BEFORE the image and text readers.
  // `.svg` is deliberately not among them — a vector picture is a picture, and
  // reading its shapes is a conversion a person asks for, not one that happens
  // to their logo on the way in.
  if (extension !== 'svg') {
    const diagram = await diagramObjects(file, t).catch(() => null);
    if (diagram?.length) return diagram;
  }

  if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(extension)) {
    const url = await dataUrl(file);
    return [{
      kind: 'image',
      data: {
        title: file.name,
        fileName: file.name,
        subtitle: t('fileMeta', { type: file.type || t('fileGeneric'), kb: Math.max(1, Math.round(file.size / 1024)) }),
        status: t('statusAttached'),
        mimeType: file.type || 'image/png',
        fileSize: file.size,
        ...(url ? { thumbnailUrl: url, outputUrl: url } : {}),
      },
    }];
  }

  // Geometry authored somewhere else — a slicer, a modeller, a CAD seat. Landing
  // it as a generic attachment made a model an icon with a file name; read as the
  // object it is, it carries its own geometry, so the card shows the shape and the
  // 3D view turns the real mesh rather than a picture of one.
  const meshFormat = !oversized ? meshFormatFromHint(file.name) : null;
  if (meshFormat) {
    const triangles = parseMeshTriangles(await file.arrayBuffer(), meshFormat);
    const url = await dataUrl(file);
    const preview = triangles.length ? meshPreviewSvg(triangles) : null;
    if (url && triangles.length) {
      return [{
        kind: 'model3d',
        data: {
          title: fileStem(file.name),
          fileName: file.name,
          status: t('statusImported'),
          subtitle: t('meshShape', { facets: triangles.length, format: meshFormat.toUpperCase() }),
          mimeType: file.type || 'model/stl',
          fileSize: file.size,
          facetCount: triangles.length,
          outputUrl: url,
          outputFileName: file.name,
          outputFormat: meshFormat.toUpperCase(),
          outputMimeType: file.type || 'model/stl',
          ...(preview ? { thumbnailUrl: svgDataUrl(preview) } : {}),
        },
      }];
    }
    // A container this cannot tessellate (a pure B-rep STEP part, say) is still
    // the person's file: it lands honestly rather than claiming to be a model.
    return [attachmentObject(file, t, { status: t('statusMeshUnreadable') })];
  }

  if (!oversized && extension === 'dxf') {
    const source = await file.text();
    const preview = dxfPreviewSvg(source);
    const url = await dataUrl(file);
    if (preview && url) {
      return [{
        kind: 'cad',
        data: {
          title: fileStem(file.name),
          fileName: file.name,
          status: t('statusImported'),
          subtitle: t('drawingShape', { format: 'DXF' }),
          mimeType: file.type || 'application/dxf',
          fileSize: file.size,
          outputUrl: url,
          outputFileName: file.name,
          outputFormat: 'DXF',
          outputMimeType: file.type || 'application/dxf',
          thumbnailUrl: svgDataUrl(preview),
        },
      }];
    }
  }

  try {
    if (!oversized && extension === 'docx') {
      const read = await readDocx(await bytes(file));
      if (read?.markdown) {
        const pages = read.markdown.split(PAGE_BREAK_MARKER).length;
        return [documentObject(file, read.markdown, t, {
          ...(read.title ? { documentTitle: read.title } : {}),
          sourceFormat: 'DOCX',
          outputFormat: 'DOCX',
          ...(pages > 1 ? { pageCount: pages } : {}),
          subtitle: t('documentShape', { words: read.markdown.split(/\s+/).length }),
        })];
      }
    }

    if (!oversized && (extension === 'xlsx' || extension === 'xlsm')) {
      const sheets = await readXlsx(await bytes(file));
      if (sheets?.length) return workbookObjects(file, sheets, t);
    }

    if (!oversized && extension === 'pptx') {
      const slides = await readPptx(await bytes(file));
      if (slides?.length) return [slidesObject(file, slides, t)];
    }

    if (!oversized && extension === 'pdf') {
      const read = await readPdf(await bytes(file));
      if (read?.text) {
        return [documentObject(file, textToMarkdown(read.text), t, {
          sourceFormat: 'PDF', outputFormat: 'PDF', pageCount: read.pageCount,
          subtitle: t('documentPages', { pages: read.pageCount }),
        })];
      }
      if (read) {
        // A scan has no text layer to read here, but it can still be OCR'd
        // server-side — IF its bytes survive past this function. Without a
        // strategy (or when one fails) it lands exactly as before: honest, but
        // a dead end for any tool that would otherwise escalate it.
        const retained = retainAttachmentBytes ? await retainAttachmentBytes(file).catch(() => null) : null;
        return [attachmentObject(file, t, {
          subtitle: t('pdfPages', { pages: read.pageCount }),
          status: t('statusTextUnavailable'),
          pageCount: read.pageCount,
        }, retained)];
      }
    }

    if (!oversized && extension === 'rtf') {
      const text = rtfToText(await file.text());
      if (text) {
        return [documentObject(file, textToMarkdown(text), t, {
          sourceFormat: 'RTF',
          subtitle: t('documentShape', { words: text.split(/\s+/).length }),
        })];
      }
    }
  } catch {
    // A malformed container falls through to the attachment path: the person
    // still gets their file on the board, labelled honestly. Its bytes are
    // worth keeping too — a container that fails to parse in the browser
    // (a scanned PDF chief among them) is exactly the case a server-side
    // multimodal read can still salvage.
    const retained = retainAttachmentBytes ? await retainAttachmentBytes(file).catch(() => null) : null;
    return [attachmentObject(file, t, { status: t('statusUnreadable') }, retained)];
  }

  /**
   * A JSON RESUME IS A RÉSUMÉ, NOT A DATASET.
   *
   * The standard export is one top-level object, so the tabular importer below read it
   * as a single row whose twelve cells were JSON strings — queryable in principle,
   * renderable by nothing. The person then asked for their résumé in ten styles and the
   * only route left was to have a model retype the whole document ten times, which is
   * what stalled a four-minute turn (2026-08-15) without producing one. Recognised
   * here, it arrives as a résumé the template engine can restyle for free.
   *
   * Checked BEFORE the tabular branch because `.json` matches both.
   */
  if (!oversized && /\.json$/i.test(file.name)) {
    const source = await file.text();
    /**
     * AN EXCALIDRAW SCENE IS A DRAWING, NOT A DATASET — the same trap, from the
     * same cause. Excalidraw exports as `.excalidraw` AND as `.excalidraw.json`
     * or a bare `.json`, and every one of those matched the tabular importer
     * below: a whiteboard sketch became a one-row Dataset whose cells were JSON
     * fragments. Recognised by its `type: "excalidraw"` declaration rather than
     * by its name, it arrives as the diagram it is.
     */
    const excalidraw = diagramNotation('excalidraw')!;
    if (excalidraw.detect!(source)) {
      const graph = await excalidraw.read!(source).catch(() => null);
      const converted = graph ? conversionFromGraph(graph, excalidraw) : null;
      if (converted) return [diagramObject(file, converted, excalidraw, t)];
    }
    const resume = jsonResumeObject(file, source, t);
    if (resume) return [resume];
  }

  if (!oversized && isTabularFile(file.name, file.type) && !MARKDOWN_FILE.test(file.name)) {
    const source = parseTabularText(file.name, await file.text());
    if (source.columns.length && source.rows.length) {
      return [{
        kind: 'dataset',
        data: {
          ...datasetObjectData(file.name, source, {
            mimeType: file.type || 'text/csv',
            subtitle: shapeLabel(t, source),
            status: t('statusImported'),
          }),
          fileSize: file.size,
        },
      }];
    }
  }

  const readable = !oversized && (READABLE_TEXT_FILE.test(file.name) || CODE_FILE.test(file.name) || file.type.startsWith('text/'));
  if (!readable) return [attachmentObject(file, t)];
  const source = await file.text();
  if (!source.trim()) return [attachmentObject(file, t)];

  if (MARKDOWN_FILE.test(file.name) || file.type === 'text/markdown') {
    // A dropped .md IS the document, exactly as a .docx is — so it is read whole.
    // Truncating it at the preview ceiling silently cut long documents in half
    // while the same content inside a Word file came through complete, and
    // nothing said so. The parse ceiling above is the real bound.
    return [documentObject(file, textToMarkdown(source), t, {
      sourceFormat: extension.toUpperCase() || 'TXT',
      subtitle: t('documentShape', { words: source.split(/\s+/).length }),
    })];
  }
  /**
   * An HTML DOCUMENT is a document, not source code.
   *
   * `.htm`/`.html` matched CODE_FILE, so a sales guide dropped on the board
   * landed as a Code object showing `<!doctype html><html><head><meta charset…`
   * — the person saw their document as a wall of markup, and because a Code
   * object is not a document, `canvas_read_document` could not read it either.
   * So the file was both unreadable to the human and invisible to the agent they
   * asked about it.
   *
   * Converted through the same `htmlToMarkdown` the rich-text editor uses, it
   * becomes an ordinary Document: readable on the card, and read page-by-page by
   * the Brain like any other. The raw markup is kept on `sourceHtml` so nothing
   * is lost and an HTML export is still exact.
   *
   * A FRAGMENT (a snippet with no document structure) stays code — pasting a
   * `<div>` into a board is a code gesture, and turning it into prose would be
   * the opposite mistake.
   */
  if (!oversized && /^html?$/i.test(extension) && isHtmlDocument(source)) {
    const markdown = htmlToMarkdown(source);
    if (markdown.trim()) {
      return [documentObject(file, markdown, t, {
        sourceFormat: 'HTML',
        outputFormat: 'HTML',
        sourceHtml: source.slice(0, MAX_PARSEABLE_BYTES),
        ...(htmlDocumentTitle(source) ? { documentTitle: htmlDocumentTitle(source)! } : {}),
        subtitle: t('documentShape', { words: markdown.split(/\s+/).length }),
      })];
    }
  }

  const text = source.slice(0, MAX_FILE_PREVIEW_CHARS);

  if (CODE_FILE.test(file.name)) {
    return [{
      kind: 'code',
      data: {
        title: file.name,
        fileName: file.name,
        path: file.name,
        language: LANGUAGE_BY_EXTENSION[extension] ?? extension,
        code: text,
        mimeType: file.type || 'text/plain',
        fileSize: file.size,
        status: t('statusImported'),
        subtitle: t('codeShape', { lines: text.split('\n').length }),
      },
    }];
  }

  return [attachmentObject(file, t, { content: text })];
}
