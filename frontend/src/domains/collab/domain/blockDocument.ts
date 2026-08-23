/**
 * A DOCUMENT AS BLOCKS — the unit that per-block co-editing needs, over the
 * storage format that already exists.
 *
 * ── THE CONSTRAINT THAT SHAPES EVERYTHING HERE ───────────────────────────────
 * A Builderforce document is markdown and nothing else. Five readers depend on
 * that — the canvas card, the page editor, the print sheet, the .docx writer and
 * Brain — so a block model may NOT become a second storage format. Blocks are a
 * VIEW: parsed from markdown when a room is seeded, serialised back to markdown
 * on every save, and round-trip stable in between.
 *
 * That is also what makes the change safe to land on an existing corpus. No
 * migration, no new column, no document that only the new editor can open.
 *
 * ── WHY BLOCKS AT ALL ────────────────────────────────────────────────────────
 * Co-editing used to be one `Y.Text('content')` holding the entire document. Yjs
 * merges that correctly, but "correctly" at document scale means two people who
 * are nowhere near each other still share one sequence: every remote keystroke
 * re-renders the whole editor, a caret can only be described as an offset into
 * the whole file, and "who is editing what" has no answer finer than "this
 * document". Per-block means a paragraph is the unit that syncs, the unit a
 * cursor belongs to, and the unit a media upload can replace.
 *
 * ── WHY `type` IS STORED BUT `kind` IS DERIVED ───────────────────────────────
 * A media block has no text to infer from — an image is its URL — so its type is
 * data. A text block's SHAPE is entirely in its markdown, so deriving it means
 * typing `# ` in front of a paragraph turns it into a heading with nothing to
 * keep in step. Storing that would create a block whose stored kind and actual
 * markdown could disagree, and there is no correct answer when they do.
 */

/** What a block IS. Stored. */
export type BlockType = 'text' | 'image' | 'video' | 'file';

/** What a text block LOOKS like. Derived from its markdown, never stored. */
export type TextBlockKind = 'heading' | 'paragraph' | 'list' | 'quote' | 'code' | 'rule';

export interface BlockAttrs {
  /** The asset URL a media block points at. */
  url?: string;
  /** Alt text (image) or display name (video/file). */
  label?: string;
  /** Content type, when the upload reported one — decides the file icon. */
  mime?: string;
  /** Size in bytes, when known. Shown on a file chip. */
  size?: number;
}

export interface DocumentBlock {
  /** Stable for the life of the block. Minted once, never re-derived from content —
   *  a content-derived id would change under the caret as somebody types. */
  id: string;
  type: BlockType;
  /** Markdown source. Empty for media blocks, whose source is rebuilt from `attrs`. */
  text: string;
  attrs: BlockAttrs;
}

/** Extensions that mean "play this" rather than "download this". */
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogv', 'mov', 'm4v'];
/** Extensions we are willing to present as an attachment rather than a plain link. */
const FILE_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'pptx', 'csv', 'json', 'txt', 'md', 'zip', 'mp3', 'wav'];

const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const LINK_LINE = /^\[([^\]]*)\]\(([^)\s]+)\)$/;
const FENCE_LINE = /^```/;

/** The extension of a URL, ignoring query and fragment. */
export function urlExtension(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0] ?? '';
  const lastSegment = withoutQuery.split('/').pop() ?? '';
  const dot = lastSegment.lastIndexOf('.');
  return dot > 0 ? lastSegment.slice(dot + 1).toLowerCase() : '';
}

/**
 * Which media block a bare link is, or `null` for an ordinary link.
 *
 * Conservative on purpose. `[our docs](https://example.com)` is a sentence with a
 * link in it and must stay a text block — promoting every solitary link to an
 * "attachment" would turn a link-only paragraph into a file chip the author never
 * asked for, and there is no markdown that would express the difference.
 */
export function mediaTypeForUrl(url: string): Extract<BlockType, 'video' | 'file'> | null {
  const extension = urlExtension(url);
  if (VIDEO_EXTENSIONS.includes(extension)) return 'video';
  if (FILE_EXTENSIONS.includes(extension)) return 'file';
  return null;
}

/** How a text block renders. Mirrors the subset `lib/richText.ts` round-trips. */
export function textBlockKind(text: string): TextBlockKind {
  const first = text.split('\n', 1)[0]?.trim() ?? '';
  if (/^```/.test(first)) return 'code';
  if (/^#{1,6}\s/.test(first)) return 'heading';
  if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(first)) return 'rule';
  if (/^>\s?/.test(first)) return 'quote';
  if (/^[-*+]\s/.test(first) || /^\d+[.)]\s/.test(first)) return 'list';
  return 'paragraph';
}

/** A block's markdown. The ONE serialiser — media blocks have no `text` to fall
 *  back on, so a caller building this by hand would silently drop them. */
export function blockToMarkdown(block: DocumentBlock): string {
  const url = block.attrs.url ?? '';
  const label = block.attrs.label ?? '';
  switch (block.type) {
    case 'image': return `![${label}](${url})`;
    // Video and file are ordinary markdown links, which is what keeps the document
    // one format. The PREVIEW recognises the URL and renders a player or a chip —
    // see `MarkdownMediaLink`. A reader that does not is left with a working link,
    // which is the correct degradation.
    case 'video':
    case 'file': return `[${label || url}](${url})`;
    case 'text': return block.text;
  }
}

/** The document. Blocks are separated by a blank line, which is what makes the
 *  result re-parse into the same blocks. */
export function blocksToMarkdown(blocks: readonly DocumentBlock[]): string {
  return blocks
    .map(blockToMarkdown)
    .map((chunk) => chunk.replace(/\s+$/, ''))
    .filter((chunk, index, all) => chunk !== '' || index === all.length - 1)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Mint a block id. Prefixed so a stray id in a log says what it is. */
export function createBlockId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `b-${random}`;
}

/** An empty paragraph — what a new document, and a document whose last block was
 *  deleted, both need so there is somewhere to type. */
export function emptyBlock(): DocumentBlock {
  return { id: createBlockId(), type: 'text', text: '', attrs: {} };
}

/** Classify one already-split chunk. */
function blockFromChunk(chunk: string): DocumentBlock {
  const single = chunk.trim();

  const image = IMAGE_LINE.exec(single);
  if (image) {
    return { id: createBlockId(), type: 'image', text: '', attrs: { label: image[1] ?? '', url: image[2] ?? '' } };
  }

  const link = LINK_LINE.exec(single);
  if (link) {
    const url = link[2] ?? '';
    const mediaType = mediaTypeForUrl(url);
    if (mediaType) {
      return { id: createBlockId(), type: mediaType, text: '', attrs: { label: link[1] ?? '', url } };
    }
  }

  return { id: createBlockId(), type: 'text', text: chunk, attrs: {} };
}

/**
 * Markdown → blocks.
 *
 * Split on blank lines, EXCEPT inside a fenced code block: a fence is one block
 * however many blank lines it contains, and splitting one would produce two
 * chunks neither of which is valid markdown.
 */
export function parseMarkdownToBlocks(markdown: string): DocumentBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const chunks: string[] = [];
  let current: string[] = [];
  let insideFence = false;

  const flush = () => {
    const chunk = current.join('\n').replace(/\s+$/, '');
    if (chunk.trim()) chunks.push(chunk);
    current = [];
  };

  for (const line of lines) {
    if (FENCE_LINE.test(line.trim())) {
      // The CLOSING fence belongs to the block it closes; the opening one starts a
      // new block if something is already accumulating.
      if (insideFence) { current.push(line); insideFence = false; flush(); continue; }
      flush();
      current.push(line);
      insideFence = true;
      continue;
    }
    if (!insideFence && !line.trim()) { flush(); continue; }
    current.push(line);
  }
  flush();

  const blocks = chunks.map(blockFromChunk);
  return blocks.length > 0 ? blocks : [emptyBlock()];
}
