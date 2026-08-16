/**
 * Shared document, deck, diagram, and file derivation for Creation Canvas objects.
 *
 * A Canvas object that carries a document, a deck, a diagram, or a table IS a
 * file — the thing a person asked for and expects to see, open, and take away.
 * One engine reads that file out of an object so the node body, the Files
 * library, the inspector, and every export path agree on what exists, what it is
 * called, and how big it is. Reading the same object twice and disagreeing is
 * what produced "the document isn't visualized" in the first place.
 */
import { creationDeliverables } from './creationDeliverables';
import { detectDiagramSource, diagramNotation, type CanvasDiagramSource } from './diagramNotations';
import { tabularFromObject } from './canvasTabularData';
import { PAGE_BREAK_MARKER } from './officeFormats';
import { pitchObjectMarkdown } from './pitchCompetition';
import type { CreationNodeData } from '@/components/creation-canvas/types';

const WORDS_PER_PAGE = 450;
const WORDS_PER_MINUTE = 220;
const MAX_HEADINGS = 40;
const MAX_SLIDES = 60;
const MAX_SLIDE_BULLETS = 8;

/** Authored body fields, in the precedence every surface reads them by. */
const AUTHORED_FIELDS = ['markdown', 'aiResponse', 'content', 'subtitle'] as const;

/** The body a person actually wrote or Brain actually produced — `null` when the
 * object is still an empty placeholder, so a preview can say so honestly instead
 * of rendering a fabricated stub. */
export function authoredMarkdown(data: CreationNodeData): string | null {
  const value = AUTHORED_FIELDS.map((field) => data[field]).find((candidate) => typeof candidate === 'string' && candidate.trim());
  return typeof value === 'string' ? value : null;
}

function chatTranscript(data: CreationNodeData): string | null {
  if (data.kind !== 'chat' || !Array.isArray(data.messages)) return null;
  const transcript = data.messages.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const message = value as Record<string, unknown>;
    if (typeof message.content !== 'string' || !message.content.trim()) return [];
    const speaker = message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Brain' : 'System';
    return [`## ${speaker}\n\n${message.content}`];
  });
  return transcript.length ? `# ${data.title}\n\n${transcript.join('\n\n')}` : null;
}

/** Markdown for any canvas object, including a title-only stub for objects that
 * have no authored body yet. Every export and copy path reads this, so a
 * download can never disagree with what the card renders. */
export function canvasObjectMarkdown(data: CreationNodeData): string {
  // A pitch object keeps its substance in arrays — beats, criteria, questions,
  // answers — so it is serialized before the authored-prose path, which would
  // otherwise export a side note and drop the pitch itself.
  const body = pitchObjectMarkdown(data) ?? chatTranscript(data) ?? authoredMarkdown(data);
  // Page breaks are canvas structure. An exported .docx or .md must not carry
  // the marker through into the file a person opens.
  if (body) return body.split(PAGE_BREAK_MARKER).map((page) => page.trim()).filter(Boolean).join('\n\n');
  return `# ${data.title}\n\n${data.status ? `Status: ${data.status}\n` : ''}`;
}

export type DocumentHeading = { level: number; text: string };

export interface CanvasDocument {
  markdown: string;
  headings: DocumentHeading[];
  wordCount: number;
  /** The document laid out as pages, so a card can turn them the way the file
   * itself does rather than scrolling one unbroken column of text. */
  pages: string[];
  /** Printed pages at {@link WORDS_PER_PAGE}, so a card can say "6 pages" rather
   * than showing an unbounded wall of text with no sense of scale. */
  pageCount: number;
  readingMinutes: number;
}

/** Blocks that must not be split across a page boundary — breaking a table or a
 * fenced code block mid-way renders as broken syntax on both pages. */
const BLOCK_SEPARATOR = /\n{2,}/;

/**
 * Lay markdown out as pages.
 *
 * A document imported from Word or PDF carries the breaks its author declared,
 * and those win: the pages a person sees on the canvas are the pages they would
 * see in the source file. Anything authored on the canvas has no declared
 * breaks, so it is flowed at {@link WORDS_PER_PAGE} on block boundaries.
 */
export function paginateDocument(markdown: string): string[] {
  const body = markdown.trim();
  if (!body) return [];
  if (body.includes(PAGE_BREAK_MARKER)) {
    const declared = body.split(PAGE_BREAK_MARKER).map((page) => page.trim()).filter(Boolean);
    if (declared.length) return declared;
  }
  const blocks = body.split(BLOCK_SEPARATOR).map((block) => block.trim()).filter(Boolean);
  const pages: string[] = [];
  let current: string[] = [];
  let words = 0;
  for (const block of blocks) {
    const blockWords = block.match(WORD)?.length ?? 0;
    if (current.length && words + blockWords > WORDS_PER_PAGE) {
      pages.push(current.join('\n\n'));
      current = [];
      words = 0;
    }
    current.push(block);
    words += blockWords;
  }
  if (current.length) pages.push(current.join('\n\n'));
  return pages.length ? pages : [body];
}

const HEADING_LINE = /^(#{1,6})\s+(.+?)\s*#*$/;
const FENCED_BLOCK = /```[\s\S]*?(?:```|$)/g;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

/** Strip the markdown syntax a plain-text label cannot render. */
export function plainText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^>\s?/, '')
    .trim();
}

/** The rendered document an object carries, or `null` when nothing is authored. */
export function canvasDocument(data: CreationNodeData): CanvasDocument | null {
  const source = pitchObjectMarkdown(data) ?? chatTranscript(data) ?? authoredMarkdown(data);
  if (!source?.trim()) return null;
  const pages = paginateDocument(source);
  // The break marker is structure, not content: it drives pagination and never
  // reaches a heading list, a word count, or an exported file.
  const markdown = pages.join('\n\n');
  const headings = markdown.split('\n').flatMap((line) => {
    const match = HEADING_LINE.exec(line.trim());
    return match ? [{ level: match[1]!.length, text: plainText(match[2]!) }] : [];
  }).slice(0, MAX_HEADINGS);
  const wordCount = markdown.replace(FENCED_BLOCK, ' ').match(WORD)?.length ?? 0;
  return {
    markdown,
    headings,
    wordCount,
    pages,
    pageCount: pages.length,
    readingMinutes: Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE)),
  };
}

export interface CanvasSlide {
  title: string;
  bullets: string[];
  notes?: string;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? plainText(item) : plainText(String((item as Record<string, unknown>)?.text ?? (item as Record<string, unknown>)?.title ?? ''))).filter(Boolean);
  if (typeof value === 'string') return value.split('\n').map((line) => plainText(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''))).filter(Boolean);
  return [];
}

function slideFromItem(value: unknown): CanvasSlide[] {
  if (typeof value === 'string') {
    const trimmed = plainText(value);
    return trimmed ? [{ title: trimmed, bullets: [] }] : [];
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const item = value as Record<string, unknown>;
  const title = [item.title, item.name, item.heading, item.headline].find((candidate) => typeof candidate === 'string' && candidate.trim());
  const bullets = [item.bullets, item.points, item.body, item.content, item.items].flatMap(stringList).slice(0, MAX_SLIDE_BULLETS);
  if (!title && !bullets.length) return [];
  const notes = [item.notes, item.speakerNotes].find((candidate) => typeof candidate === 'string' && candidate.trim());
  return [{
    title: typeof title === 'string' ? plainText(title) : bullets[0] ?? '',
    bullets: typeof title === 'string' ? bullets : bullets.slice(1),
    ...(typeof notes === 'string' ? { notes: plainText(notes) } : {}),
  }];
}

function slideFromChunk(chunk: string): CanvasSlide[] {
  const lines = chunk.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim());
  if (!lines.length) return [];
  const headingIndex = lines.findIndex((line) => HEADING_LINE.test(line.trim()));
  const titleIndex = headingIndex >= 0 ? headingIndex : 0;
  const title = plainText(lines[titleIndex]!.replace(/^#{1,6}\s+/, '').replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''));
  const bullets = lines
    .filter((_, index) => index !== titleIndex)
    .map((line) => plainText(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')))
    .filter(Boolean)
    .slice(0, MAX_SLIDE_BULLETS);
  return title || bullets.length ? [{ title, bullets }] : [];
}

/** A deck read from authored slide items, or from the markdown outline when the
 * deck was written as a document — `---` rules first, then headings. */
export function canvasSlides(data: CreationNodeData): CanvasSlide[] {
  const authored = Array.isArray(data.items) ? data.items.flatMap(slideFromItem) : [];
  if (authored.length) return authored.slice(0, MAX_SLIDES);
  const markdown = authoredMarkdown(data);
  if (!markdown?.trim()) return [];
  const chunks = /^\s*---+\s*$/m.test(markdown)
    ? markdown.split(/^\s*---+\s*$/m)
    : markdown.split(/^(?=#{1,3}\s)/m);
  return chunks.flatMap(slideFromChunk).slice(0, MAX_SLIDES);
}

const DIAGRAM_FIELDS = ['diagram', 'diagramXml', 'diagramSource', 'markdown', 'content', 'code'] as const;

/**
 * The diagram an object carries, whichever notation it was authored in.
 *
 * Recognition itself lives in the notation registry, so a format is declared
 * ONCE and this stays a question about the OBJECT: which of its fields holds
 * the source, and what its `diagramFormat` says when the payload is ambiguous.
 */
export function canvasDiagram(data: CreationNodeData): CanvasDiagramSource | null {
  const declared = diagramNotation(typeof data.diagramFormat === 'string' ? data.diagramFormat : null);
  for (const field of DIAGRAM_FIELDS) {
    const value = data[field];
    if (typeof value !== 'string' || !value.trim()) continue;
    const detected = detectDiagramSource(value);
    if (detected) return detected;
    // Nothing recognisable in the payload, but the object SAYS what it is —
    // which is how a Mermaid sequence diagram (no graph markers of its own) and
    // a half-written diagram still open in the right notation.
    if (declared) return { format: declared.id, source: value.trim() };
  }
  return null;
}

export type CanvasFileCategory = 'document' | 'presentation' | 'diagram' | 'spreadsheet' | 'image' | 'media' | 'code' | 'web' | 'other';

export interface CanvasFile {
  /** Stable across renders: the object it belongs to, plus the export when the
   * row is a delivered artifact rather than the object itself. */
  id: string;
  nodeId: string;
  name: string;
  extension: string;
  category: CanvasFileCategory;
  mimeType: string;
  sizeBytes?: number;
  updatedAt?: string;
  url?: string;
  previewImageUrl?: string;
  detail?: string;
  /** Whether opening this row lands on an object the canvas can render and edit,
   * as opposed to a finished download. */
  editable: boolean;
  source: 'object' | 'export';
}

const DOCUMENT_KINDS = new Set(['document', 'prd', 'knowledge', 'note', 'report', 'resume', 'pitch', 'pitchScorecard', 'pitchQa', 'pitchApplication']);
const TABULAR_KINDS = new Set(['spreadsheet', 'table', 'dataset']);
const MEDIA_KINDS = new Set(['image', 'comic', 'animation', 'game', 'cad', 'model3d', 'video', 'podcast', 'voice']);

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'text/markdown': 'md', 'text/csv': 'csv', 'application/json': 'json', 'text/html': 'html',
  'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg', 'model/stl': 'stl', 'application/dxf': 'dxf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(EXTENSION_BY_MIME).map(([mime, extension]) => [extension, mime]),
);
const CATEGORY_BY_EXTENSION: Readonly<Record<string, CanvasFileCategory>> = {
  md: 'document', txt: 'document', pdf: 'document', docx: 'document', rtf: 'document',
  pptx: 'presentation', key: 'presentation',
  // Every notation the canvas reads, so a dropped `.puml` or `.bpmn` files
  // under Diagrams rather than "other". `.svg` stays an image and `.xml` stays
  // code: both are draw.io-adjacent but neither IS a diagram by extension.
  drawio: 'diagram', mmd: 'diagram', mermaid: 'diagram', puml: 'diagram', plantuml: 'diagram',
  dot: 'diagram', gv: 'diagram', bpmn: 'diagram', excalidraw: 'diagram', archimate: 'diagram',
  vsdx: 'diagram', vsd: 'diagram', vdx: 'diagram',
  csv: 'spreadsheet', tsv: 'spreadsheet', xlsx: 'spreadsheet', xls: 'spreadsheet',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  mp4: 'media', webm: 'media', mp3: 'media', wav: 'media', m4a: 'media',
  html: 'web', json: 'code', ts: 'code', tsx: 'code', js: 'code', jsx: 'code', py: 'code', sql: 'code',
  stl: 'other', dxf: 'other', zip: 'other',
};
const EXTENSION_BY_LANGUAGE: Readonly<Record<string, string>> = {
  typescript: 'ts', tsx: 'tsx', javascript: 'js', jsx: 'jsx', python: 'py', sql: 'sql',
  json: 'json', html: 'html', css: 'css', markdown: 'md', bash: 'sh', shell: 'sh', go: 'go', rust: 'rs', java: 'java',
};

export function fileExtension(name: string): string {
  return name.trim().toLowerCase().match(/\.([a-z0-9]{1,8})(?:[?#]|$)/)?.[1] ?? '';
}

export function fileCategory(extension: string): CanvasFileCategory {
  return CATEGORY_BY_EXTENSION[extension] ?? 'other';
}

function fileMimeType(extension: string, declared?: unknown): string {
  if (typeof declared === 'string' && declared.includes('/')) return declared;
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/** File-safe stem for an object title, so a downloaded name is predictable. */
export function fileStem(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'untitled';
}

function byteLength(value: string): number {
  return typeof TextEncoder === 'undefined' ? value.length : new TextEncoder().encode(value).length;
}

function timestamp(value: unknown): string | undefined {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function tabularCsvSize(data: CreationNodeData): { rows: number; columns: number; bytes: number } {
  const source = tabularFromObject(data as Record<string, unknown>);
  const rows = typeof data.rowCount === 'number' ? data.rowCount : source.rows.length;
  const sampled = source.rows.slice(0, 50);
  const perRow = sampled.length ? sampled.reduce((total, row) => total + byteLength(Object.values(row).join(',')) + 1, 0) / sampled.length : 0;
  return { rows, columns: source.columns.length, bytes: Math.round(byteLength(source.columns.join(',')) + perRow * rows) };
}

/** The file an object IS, before anything has been exported from it. */
function objectFile(nodeId: string, data: CreationNodeData): CanvasFile | null {
  const stem = fileStem(data.title);
  const updatedAt = timestamp(data.updatedAt) ?? timestamp(data.fetchedAt);
  const base = { nodeId, id: nodeId, editable: true, source: 'object' as const, ...(updatedAt ? { updatedAt } : {}) };

  if (data.kind === 'file') {
    const name = typeof data.fileName === 'string' && data.fileName.trim() ? data.fileName.trim() : `${stem}.${fileExtension(String(data.url ?? '')) || 'bin'}`;
    const extension = fileExtension(name);
    const size = Number(data.fileSize);
    return {
      ...base, name, extension, category: fileCategory(extension), mimeType: fileMimeType(extension, data.mimeType),
      ...(Number.isFinite(size) && size > 0 ? { sizeBytes: size } : {}),
      ...(typeof data.url === 'string' && data.url ? { url: data.url } : {}),
      editable: false,
    };
  }

  if (data.kind === 'diagram') {
    const diagram = canvasDiagram(data);
    const notation = diagram ? diagramNotation(diagram.format) : null;
    if (!diagram || !notation) return null;
    // Name, extension and MIME all come from the ONE notation row. Deriving
    // them here is how a Mermaid diagram used to be downloadable as `.drawio`.
    const extension = notation.extensions[0]!;
    return {
      ...base, name: `${stem}.${extension}`, extension, category: 'diagram',
      mimeType: notation.mimeType,
      sizeBytes: byteLength(diagram.source), detail: notation.name,
    };
  }

  if (data.kind === 'slides') {
    const slides = canvasSlides(data);
    if (!slides.length) return null;
    return {
      ...base, name: `${stem}.md`, extension: 'md', category: 'presentation', mimeType: 'text/markdown',
      sizeBytes: byteLength(canvasObjectMarkdown(data)), detail: `${slides.length}`,
    };
  }

  if (TABULAR_KINDS.has(data.kind)) {
    const { rows, columns, bytes } = tabularCsvSize(data);
    if (!rows && !columns) return null;
    // A sheet exports as CSV whatever it was imported from, so the row is named
    // for the bytes it produces — an `.xlsx` label on a CSV download is a lie.
    const source = typeof data.fileName === 'string' && data.fileName.trim() ? data.fileName.trim() : data.title;
    const sheet = typeof data.activeSheet === 'string' && data.activeSheet.trim() ? `-${fileStem(data.activeSheet)}` : '';
    return {
      ...base, name: `${fileStem(source.replace(/\.[a-z0-9]{1,8}$/i, ''))}${sheet}.csv`, extension: 'csv',
      category: 'spreadsheet', mimeType: 'text/csv',
      sizeBytes: bytes, detail: `${rows}×${columns}`,
    };
  }

  if (data.kind === 'code') {
    const path = typeof data.path === 'string' && data.path.trim() ? data.path.trim() : '';
    const language = typeof data.language === 'string' ? data.language.trim().toLowerCase() : '';
    const extension = fileExtension(path) || EXTENSION_BY_LANGUAGE[language] || 'txt';
    const body = typeof data.code === 'string' ? data.code : canvasObjectMarkdown(data);
    return {
      ...base, name: path || `${stem}.${extension}`, extension, category: 'code',
      mimeType: fileMimeType(extension), sizeBytes: byteLength(body),
    };
  }

  if (MEDIA_KINDS.has(data.kind)) {
    const outputUrl = typeof data.outputUrl === 'string' ? data.outputUrl : '';
    const outputName = typeof data.outputFileName === 'string' && data.outputFileName.trim() ? data.outputFileName.trim() : '';
    if (!outputUrl && !outputName) return null;
    const extension = fileExtension(outputName) || fileExtension(outputUrl) || (typeof data.outputFormat === 'string' ? data.outputFormat.trim().toLowerCase() : '') || 'bin';
    const preview = typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl : '';
    return {
      ...base, name: outputName || `${stem}.${extension}`, extension,
      category: fileCategory(extension) === 'other' ? 'media' : fileCategory(extension),
      mimeType: fileMimeType(extension, data.mimeType),
      ...(outputUrl ? { url: outputUrl } : {}),
      ...(preview ? { previewImageUrl: preview } : {}),
      editable: false,
    };
  }

  if (data.kind === 'website' && typeof data.url === 'string' && data.url.trim()) {
    return { ...base, name: `${stem}.html`, extension: 'html', category: 'web', mimeType: 'text/html', url: data.url.trim(), editable: false };
  }

  if (DOCUMENT_KINDS.has(data.kind)) {
    const document = canvasDocument(data);
    if (!document) return null;
    return {
      ...base, name: `${stem}.md`, extension: 'md', category: 'document', mimeType: 'text/markdown',
      sizeBytes: byteLength(document.markdown), detail: `${document.pageCount}`,
    };
  }

  return null;
}

/**
 * Every file the session holds — the objects that ARE files, plus the artifacts
 * exported or published from them. One derivation, so the Files library, the
 * canvas cards, and the inspector can never disagree about what was produced.
 */
export function canvasFiles(nodes: ReadonlyArray<{ id: string; data: CreationNodeData }>): CanvasFile[] {
  const files: CanvasFile[] = [];
  const seen = new Set<string>();
  const push = (file: CanvasFile | null) => {
    if (!file) return;
    const key = `${file.nodeId}|${file.name}|${file.url ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };
  for (const node of nodes) {
    push(objectFile(node.id, node.data));
    for (const deliverable of creationDeliverables(node.data)) {
      if (deliverable.status !== 'delivered') continue;
      const name = deliverable.fileName?.trim() || (deliverable.url && !deliverable.url.startsWith('data:') ? `${fileStem(node.data.title)}.${fileExtension(deliverable.url) || 'file'}` : '');
      if (!name) continue;
      const extension = fileExtension(name) || EXTENSION_BY_MIME[deliverable.mimeType ?? ''] || '';
      push({
        id: `${node.id}:${deliverable.id}`,
        nodeId: node.id,
        name,
        extension,
        category: fileCategory(extension),
        mimeType: fileMimeType(extension, deliverable.mimeType),
        ...(deliverable.completedAt || deliverable.createdAt ? { updatedAt: deliverable.completedAt || deliverable.createdAt } : {}),
        ...(deliverable.url ? { url: deliverable.url } : {}),
        ...(deliverable.provider ? { detail: deliverable.provider } : {}),
        editable: false,
        source: 'export',
      });
    }
  }
  return files.sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '') || left.name.localeCompare(right.name));
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];

/** Byte count as a short human label. Shared so every file surface rounds the
 * same way. */
export function formatBytes(bytes: number): string {
  const unit = Math.min(SIZE_UNITS.length - 1, Math.max(0, Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024))));
  const value = bytes / 1024 ** unit;
  return `${unit !== 0 && value < 10 ? value.toFixed(1) : String(Math.round(value))} ${SIZE_UNITS[unit]}`;
}
