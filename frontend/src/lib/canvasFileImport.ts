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
import { fileExtension, fileStem } from './canvasDocuments';
import { htmlToMarkdown } from './richText';
import {
  MAX_PARSEABLE_BYTES, PAGE_BREAK_MARKER, readDocx, readPdf, readPptx, readXlsx, rtfToText,
  type OfficeSlide, type WorkbookSheet,
} from './officeFormats';
import {
  dxfPreviewSvg, meshFormatFromHint, meshPreviewSvg, parseMeshTriangles, svgDataUrl,
} from './creativeGeometry';
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
  options: { mimeType?: string; subtitle: string; status: string },
): Record<string, unknown> {
  return {
    title: fileName,
    fileName,
    ...(options.mimeType ? { mimeType: options.mimeType } : {}),
    columns: source.columns,
    rows: source.rows,
    sampleRows: source.rows.slice(0, 25),
    rowCount: source.rows.length,
    profile: profileTabular(source),
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

async function bytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function shapeLabel(t: ImportTranslator, source: TabularSource): string {
  return t('datasetShape', { rows: source.rows.length.toLocaleString(), columns: source.columns.length });
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
          ? t('workbookShape', { sheets: sheets.length, rows: first.rows.length.toLocaleString(), columns: first.columns.length })
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

function attachmentObject(file: File, t: ImportTranslator, extra: Record<string, unknown> = {}): ImportedCanvasObject {
  return {
    kind: 'file',
    data: {
      title: file.name,
      fileName: file.name,
      subtitle: `${file.type || t('fileGeneric')} · ${Math.max(1, Math.round(file.size / 1024)).toLocaleString()} KB`,
      status: t('statusAttached'),
      mimeType: file.type || 'application/octet-stream',
      fileSize: file.size,
      ...extra,
    },
  };
}

/** The question the canvas puts in the composer after a file lands, phrased for
 * what the file turned out to be. */
function promptFor(kind: CreationObjectKind, file: File, t: ImportTranslator): string {
  const key = kind === 'spreadsheet' || kind === 'dataset' ? 'promptData'
    : kind === 'slides' ? 'promptDeck'
      : kind === 'document' ? 'promptDocument'
        : kind === 'image' ? 'promptImage'
          : kind === 'model3d' ? 'promptModel'
            : kind === 'cad' ? 'promptDrawing'
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
      : t('noticeDataset', { name: file.name, rows: Number(data.rowCount ?? 0).toLocaleString(), columns: Array.isArray(data.columns) ? data.columns.length : 0 });
  }
  if (kind === 'slides') return t('noticeDeck', { name: file.name, slides: Array.isArray(data.items) ? data.items.length : 0 });
  if (kind === 'document') return t('noticeDocument', { name: file.name, pages: Number(data.pageCount ?? 1) });
  if (kind === 'image') return t('noticeImage', { name: file.name });
  if (kind === 'model3d') return t('noticeModel', { name: file.name, facets: Number(data.facetCount ?? 0).toLocaleString() });
  if (kind === 'cad') return t('noticeDrawing', { name: file.name });
  return t('noticeFile', { name: file.name });
}

/**
 * Read a dropped, attached, or picked file into the objects it should become.
 *
 * Container formats are parsed in the browser; anything unreadable still lands
 * as an attachment rather than being rejected, so a drop always produces
 * something on the board.
 */
export async function importCanvasFile(file: File, t: ImportTranslator): Promise<CanvasFileImport> {
  const objects = await deriveObjects(file, t);
  const resolved = objects.length ? objects : [attachmentObject(file, t)];
  return {
    objects: resolved,
    notice: noticeFor(resolved, file, t),
    suggestedPrompt: promptFor(resolved[0]!.kind, file, t),
  };
}

async function deriveObjects(file: File, t: ImportTranslator): Promise<ImportedCanvasObject[]> {
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

  if (extension === 'drawio') {
    const source = await file.text();
    if (/<(?:mxfile|mxGraphModel)\b/i.test(source)) {
      return [{ kind: 'diagram', data: {
        title: file.name,
        fileName: file.name,
        mimeType: file.type || 'application/vnd.jgraph.mxfile',
        fileSize: file.size,
        diagramFormat: 'drawio', diagram: source, diagramXml: source, content: source,
        status: t('statusImported'),
      } }];
    }
  }

  if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(extension)) {
    const url = await dataUrl(file);
    return [{
      kind: 'image',
      data: {
        title: file.name,
        fileName: file.name,
        subtitle: `${file.type || t('fileGeneric')} · ${Math.max(1, Math.round(file.size / 1024)).toLocaleString()} KB`,
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
          subtitle: t('meshShape', { facets: triangles.length.toLocaleString(), format: meshFormat.toUpperCase() }),
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
          subtitle: t('documentShape', { words: read.markdown.split(/\s+/).length.toLocaleString() }),
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
        return [attachmentObject(file, t, {
          subtitle: t('pdfPages', { pages: read.pageCount }),
          status: t('statusTextUnavailable'),
          pageCount: read.pageCount,
        })];
      }
    }

    if (!oversized && extension === 'rtf') {
      const text = rtfToText(await file.text());
      if (text) {
        return [documentObject(file, textToMarkdown(text), t, {
          sourceFormat: 'RTF',
          subtitle: t('documentShape', { words: text.split(/\s+/).length.toLocaleString() }),
        })];
      }
    }
  } catch {
    // A malformed container falls through to the attachment path: the person
    // still gets their file on the board, labelled honestly.
    return [attachmentObject(file, t, { status: t('statusUnreadable') })];
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
      subtitle: t('documentShape', { words: source.split(/\s+/).length.toLocaleString() }),
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
        subtitle: t('documentShape', { words: markdown.split(/\s+/).length.toLocaleString() }),
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
        subtitle: t('codeShape', { lines: text.split('\n').length.toLocaleString() }),
      },
    }];
  }

  return [attachmentObject(file, t, { content: text })];
}
