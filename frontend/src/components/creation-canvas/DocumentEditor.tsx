'use client';

/**
 * The document editor — word processing, on the card AND at page scale.
 *
 * When a person asks the canvas for a document they get a document, and the very
 * next thing they want is to change a sentence, bold a phrase, and take it away
 * as a file. Sending them to a markdown textarea in a side panel to do that is
 * asking them to learn a syntax to fix a typo.
 *
 * The surface is a `contenteditable` that React deliberately does NOT own: the
 * children are written once with `markdownToHtml` and from then on the browser
 * mutates them under the caret. React re-rendering that subtree would move the
 * cursor on every keystroke. Markdown remains the only stored form — the body is
 * read back through `htmlToMarkdown` on blur, on a pause in typing, and before
 * any export — so the card, the Files library, Brain's context, and the .docx
 * writer all keep reading the one document they always did.
 *
 * ── ONE EDITOR, TWO SCALES ───────────────────────────────────────────────────
 * `scale` is a MEASURE, not a second editor. On a card the document is being
 * RECOGNISED, so the type is 9px and the writing area is a 340px box. On the
 * page runtime it is being WRITTEN, so the base type is a readable 15px, the
 * sheet takes the room a page assumes, the toolbar sticks to the top of the
 * scroll the way a ribbon does, and the PAGE scrolls rather than a box inside
 * it. Every one of those is a value in the stylesheet keyed off `data-scale` —
 * no branch here draws a different editor, because two editors is how the card
 * and the page end up disagreeing about what bold looks like.
 *
 * ── WHAT THE TOOLBAR MAY CONTAIN ─────────────────────────────────────────────
 * Exactly what `richText` can round-trip, and nothing else. A control that
 * produced a style the save silently dropped would be a lie told once per
 * keystroke — which used to rule out underline, a font, a colour and alignment,
 * because markdown itself has no syntax for any of them. It rules out nothing
 * now: those four are written as the attribute spans `richFormat.ts` defines
 * (`[text]{u color=#c0392b}`, `{align=center}`), which `richText` reads and
 * writes on the way in and out of this surface, and which the print sheet, the
 * `.docx`/`.pdf` writers and the card's own renderer all parse the same way.
 */

import { Icon } from '@/components/ui/Icon';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './CreationCanvas.module.css';
import { escapeHtml, htmlToMarkdown, markdownToHtml } from '@/lib/richText';
import {
  RICH_FONTS, RICH_SIZES, richMarksCss, type RichAlign, type RichMarks,
} from '@builderforce/creation-canvas-contract';

/** Write the body back this long after the last keystroke, so a session that
 * ends without a blur — a closed tab, a dragged card — still keeps the edit. */
const AUTOSAVE_MS = 1200;

/** Inline marks the browser's own editing commands produce, and which
 * `richText` reads back — emphasis as markdown, underline as an attribute span. */
const INLINE_COMMANDS = [
  { id: 'bold', command: 'bold', glyph: 'B' },
  { id: 'italic', command: 'italic', glyph: 'I' },
  { id: 'strikethrough', command: 'strikeThrough', glyph: 'S' },
  { id: 'underline', command: 'underline', glyph: 'U' },
] as const;

/** Paragraph alignment. A native command per value, so the browser's own
 * alignment state (`document.queryCommandState`) is what drives the toolbar. */
const ALIGN_COMMANDS = [
  { id: 'left' as const, command: 'justifyLeft', glyph: 'L', label: 'alignLeft' as const },
  { id: 'center' as const, command: 'justifyCenter', glyph: 'C', label: 'alignCenter' as const },
  { id: 'right' as const, command: 'justifyRight', glyph: 'R', label: 'alignRight' as const },
  { id: 'justify' as const, command: 'justifyFull', glyph: 'J', label: 'alignJustify' as const },
] as const;

const LIST_COMMANDS = [
  { id: 'bulletList', command: 'insertUnorderedList', glyph: '☰' },
  { id: 'numberList', command: 'insertOrderedList', glyph: '№' },
] as const;

/** Nesting, which markdown stores as indented list items. Live only inside a
 * list: `indent` outside one produces a `<blockquote>` in most engines, which is
 * a quote appearing where the reader pressed "indent". */
const NEST_COMMANDS = [
  { id: 'outdent', command: 'outdent', glyph: '⇤' },
  { id: 'indent', command: 'indent', glyph: '⇥' },
] as const;

/** Block styles, and the tag name `formatBlock` wants for each. Not composed at
 * the call site: `formatBlock` takes an angle-bracketed tag in most engines and
 * a bare name in others, so the exact string belongs in one place. */
const BLOCK_FORMATS = ['p', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'pre'];
const BLOCK_TAGS: Readonly<Record<string, string>> = Object.fromEntries(BLOCK_FORMATS.map((name) => [name, ['<', name, '>'].join('')]));
type BlockFormat = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'blockquote' | 'pre';

/** The shape a fresh table arrives in. Three columns is what fits the card's
 * measure without a horizontal scrollbar on the first keystroke. */
const TABLE_COLUMNS = 3;
const TABLE_ROWS = 3;

/** Ask the browser which marks apply at the caret. Wrapped because
 * `queryCommandState` throws rather than returning false in some engines when
 * the selection sits outside an editable region. */
function commandActive(command: string): boolean {
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}

function currentBlockFormat(): BlockFormat {
  try {
    const value = document.queryCommandValue('formatBlock').toLowerCase();
    return (BLOCK_FORMATS as readonly string[]).includes(value) ? value as BlockFormat : 'p';
  } catch {
    return 'p';
  }
}

/** The caret's current alignment, read the same way its emphasis is. */
function currentAlign(): RichAlign {
  const active = ALIGN_COMMANDS.find((entry) => commandActive(entry.command));
  return active?.id ?? 'left';
}

/** The nearest ancestor of the caret carrying this tag, stopping at the editing
 * surface. Inline code has no editing command of its own and is toggled by hand;
 * list nesting has commands but only means something inside an `<li>`. Both are
 * the same walk, so it is written once. */
function enclosingTag(root: HTMLElement, tag: string): HTMLElement | null {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode ?? null;
  let node: Node | null = anchor?.nodeType === 1 ? anchor : anchor?.parentNode ?? null;
  while (node && node !== root) {
    if ((node as Element).tagName === tag) return node as HTMLElement;
    node = node.parentNode;
  }
  return null;
}

export interface DocumentEditorProps {
  /** The stored body. An external rewrite — Brain revising the document while it
   * is open — replaces the surface; an echo of our own commit does not. */
  markdown: string;
  /** Accessible name for the editing region, so a board of documents does not
   * present six identically-named editors. */
  label: string;
  /** How much room the editor has. `card` is the ~340px node body it was born
   * in; `page` is the page runtime, where a document is actually written. */
  scale?: 'card' | 'page';
  onCommit: (markdown: string) => void;
}

export function DocumentEditor({ markdown, label, scale = 'card', onCommit }: DocumentEditorProps) {
  const t = useTranslations('creationCanvas.editor');
  const tCommon = useTranslations('common');
  const surface = useRef<HTMLDivElement>(null);
  /** The markdown the surface currently represents. Guards the load effect from
   * re-writing the DOM (and dropping the caret) when the parent echoes back the
   * value we just committed. */
  const loaded = useRef<string | null>(null);
  const savedRange = useRef<Range | null>(null);
  const autosave = useRef<number>(0);
  const [marks, setMarks] = useState<{ inline: readonly string[]; block: BlockFormat; code: boolean; list: boolean; align: RichAlign }>({ inline: [], block: 'p', code: false, list: false, align: 'left' });
  /** Which insertion the URL row is collecting for, or `null` when it is shut.
   * A link and an image ask the same question and differ only in what they
   * write, so they share one row rather than growing a second identical one. */
  const [inserting, setInserting] = useState<null | 'link' | 'image'>(null);
  const [insertUrl, setInsertUrl] = useState('');
  /** What the status bar reports. Read from the live DOM rather than derived
   * from the `markdown` prop, which only changes when the autosave fires — a
   * count that lags a second behind the typing is worse than no count. */
  const [stats, setStats] = useState({ words: 0, characters: 0 });
  const measuring = useRef<number>(0);

  /**
   * Count what is on the surface — but only when something is showing the count,
   * and at most once a frame.
   *
   * `innerText` is not a free read: it forces layout, and this is on the keystroke
   * path. The card never renders the status bar, so it never pays; the page reads
   * once per frame rather than once per character, which is the difference between
   * a live count and a reflow per keypress on a long document.
   */
  const measure = useCallback(() => {
    if (scale !== 'page' || measuring.current) return;
    measuring.current = window.requestAnimationFrame(() => {
      measuring.current = 0;
      const text = surface.current?.innerText ?? '';
      setStats({ words: (text.match(/\S+/g) ?? []).length, characters: text.trim().length });
    });
  }, [scale]);

  useEffect(() => () => { if (measuring.current) window.cancelAnimationFrame(measuring.current); }, []);

  useEffect(() => {
    const node = surface.current;
    if (!node || loaded.current === markdown) return;
    loaded.current = markdown;
    node.innerHTML = markdownToHtml(markdown) || '<p><br></p>';
    measure();
  }, [markdown, measure]);

  const readMarks = useCallback(() => {
    const node = surface.current;
    if (!node || !node.contains(document.getSelection()?.anchorNode ?? null)) return;
    setMarks({
      inline: [...INLINE_COMMANDS, ...LIST_COMMANDS].filter((entry) => commandActive(entry.command)).map((entry) => entry.id),
      block: currentBlockFormat(),
      code: !!enclosingTag(node, 'CODE'),
      list: !!enclosingTag(node, 'LI'),
      align: currentAlign(),
    });
  }, []);

  const commit = useCallback(() => {
    const node = surface.current;
    if (!node) return;
    window.clearTimeout(autosave.current);
    const next = htmlToMarkdown(node.innerHTML);
    if (next === loaded.current) return;
    loaded.current = next;
    onCommit(next);
  }, [onCommit]);

  const scheduleCommit = useCallback(() => {
    measure();
    window.clearTimeout(autosave.current);
    autosave.current = window.setTimeout(commit, AUTOSAVE_MS);
  }, [commit, measure]);

  useEffect(() => () => window.clearTimeout(autosave.current), []);

  // The caret can move without an input event — an arrow key, a click — and the
  // toolbar has to show what applies where the caret actually is.
  useEffect(() => {
    document.addEventListener('selectionchange', readMarks);
    return () => document.removeEventListener('selectionchange', readMarks);
  }, [readMarks]);

  const run = useCallback((command: string, value?: string) => {
    const node = surface.current;
    if (!node) return;
    node.focus();
    // Semantic tags, not inline styles: `<b>` round-trips to `**`, whereas a
    // `<span style="font-weight:bold">` is a guess we would have to reverse.
    try { document.execCommand('styleWithCSS', false, 'false'); } catch { /* not supported; tags are the default there */ }
    document.execCommand(command, false, value);
    readMarks();
    scheduleCommit();
  }, [readMarks, scheduleCommit]);

  const toggleCode = useCallback(() => {
    const node = surface.current;
    if (!node) return;
    node.focus();
    const existing = enclosingTag(node, 'CODE');
    if (existing) {
      existing.replaceWith(...Array.from(existing.childNodes));
    } else {
      const selected = window.getSelection()?.toString() ?? '';
      document.execCommand('insertHTML', false, `<code>${escapeHtml(selected || t('codePlaceholder'))}</code>`);
    }
    readMarks();
    scheduleCommit();
  }, [readMarks, scheduleCommit, t]);

  /** A GFM table — the one structure a word processor offers that has no editing
   * command behind it. Body cells carry a `<br>` so an empty row still has a
   * line to click into; `htmlToMarkdown` reads them back as empty cells. */
  const insertTable = useCallback(() => {
    const node = surface.current;
    if (!node) return;
    node.focus();
    const head = Array.from({ length: TABLE_COLUMNS }, (_item, index) => `<th>${escapeHtml(t('tableColumn', { index: index + 1 }))}</th>`).join('');
    const body = Array.from({ length: TABLE_ROWS }, () => `<tr>${'<td><br></td>'.repeat(TABLE_COLUMNS)}</tr>`).join('');
    document.execCommand('insertHTML', false, `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table><p><br></p>`);
    readMarks();
    scheduleCommit();
  }, [readMarks, scheduleCommit, t]);

  const openInsert = useCallback((kind: 'link' | 'image') => {
    const selection = window.getSelection();
    savedRange.current = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    setInsertUrl('');
    setInserting(kind);
  }, []);

  const applyInsert = useCallback(() => {
    const node = surface.current;
    const url = insertUrl.trim();
    const kind = inserting;
    setInserting(null);
    if (!node || !url || !kind) return;
    node.focus();
    const range = savedRange.current;
    if (range) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    if (kind === 'image') document.execCommand('insertHTML', false, `<img src="${escapeHtml(url)}" alt="">`);
    else if (range && !range.collapsed) document.execCommand('createLink', false, url);
    else document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
    scheduleCommit();
  }, [insertUrl, inserting, scheduleCommit]);

  const blockOptions = useMemo(() => [
    { value: 'p' as const, label: t('blockParagraph') },
    { value: 'h1' as const, label: t('blockHeading1') },
    { value: 'h2' as const, label: t('blockHeading2') },
    { value: 'h3' as const, label: t('blockHeading3') },
    { value: 'h4' as const, label: t('blockHeading4') },
    { value: 'blockquote' as const, label: t('blockQuote') },
    { value: 'pre' as const, label: t('blockCode') },
  ], [t]);

  /** A toolbar press must not take focus: the selection it is about to act on
   * lives in the surface, and blurring collapses it. */
  const hold = (event: React.MouseEvent) => { event.preventDefault(); event.stopPropagation(); };

  const applyBlockFormat = useCallback((format: string) => run('formatBlock', BLOCK_TAGS[format] ?? BLOCK_TAGS.p!), [run]);

  /** The selection's own HTML, so a mark wraps what was actually selected —
   *  including whatever emphasis it already carries — rather than its plain
   *  text. `null` when there is nothing selected to wrap. */
  const selectedHtml = useCallback((node: HTMLElement): string | null => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    if (!node.contains(selection.anchorNode) || !node.contains(selection.focusNode)) return null;
    const holder = document.createElement('div');
    holder.appendChild(selection.getRangeAt(0).cloneContents());
    return holder.innerHTML;
  }, []);

  /**
   * Apply a colour, a font or a size to the selection.
   *
   * Written by hand rather than through `run`/`execCommand`: none of the three
   * has a cross-browser command that survives as the plain `<span style>`
   * `richText` reads back, so the markup is built directly — the same shape
   * `richText`'s own `markedHtml` produces, underline innermost and the span
   * outside it, so a colour applied over an underlined phrase reads back as one
   * mark instead of two nested ones disagreeing about order.
   */
  const applyMarks = useCallback((marks: RichMarks, placeholder: string) => {
    const node = surface.current;
    if (!node) return;
    node.focus();
    const html = selectedHtml(node) ?? escapeHtml(placeholder);
    const css = richMarksCss({ ...marks, underline: false });
    const wrapped = css ? `<span style="${escapeHtml(css)}">${html}</span>` : html;
    document.execCommand('insertHTML', false, wrapped);
    readMarks();
    scheduleCommit();
  }, [readMarks, scheduleCommit, selectedHtml]);

  return <div className={`${styles.docEditor} nodrag nowheel`} data-scale={scale} onPointerDownCapture={(event) => event.stopPropagation()}>
    <div className={styles.docToolbar} role="toolbar" aria-label={t('toolbar')}>
      <div className={styles.docToolGroup}>
        <button type="button" onMouseDown={hold} onClick={() => run('undo')} aria-label={t('undo')} title={t('undo')}>↶</button>
        <button type="button" onMouseDown={hold} onClick={() => run('redo')} aria-label={t('redo')} title={t('redo')}>↷</button>
      </div>
      <select
        className={styles.docBlockSelect}
        value={marks.block}
        aria-label={t('blockStyle')}
        onMouseDown={(event) => event.stopPropagation()}
        onChange={(event) => applyBlockFormat(event.target.value)}
      >{blockOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      <div className={styles.docToolGroup}>
        <select
          className={styles.docBlockSelect}
          defaultValue=""
          aria-label={t('fontFamily')}
          onMouseDown={(event) => event.stopPropagation()}
          onChange={(event) => { const { value } = event.target; event.target.value = ''; if (value) applyMarks({ font: value }, value); }}
        >
          <option value="">{t('fontFamilyPlaceholder')}</option>
          {RICH_FONTS.map((font) => <option key={font.id} value={font.id} style={{ fontFamily: font.stack }}>{font.id}</option>)}
        </select>
        <select
          className={styles.docBlockSelect}
          defaultValue=""
          aria-label={t('fontSize')}
          onMouseDown={(event) => event.stopPropagation()}
          onChange={(event) => { const { value } = event.target; event.target.value = ''; const size = Number(value); if (size) applyMarks({ size }, `${size}pt`); }}
        >
          <option value="">{t('fontSizePlaceholder')}</option>
          {RICH_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
        <input
          type="color"
          className={styles.docColorInput}
          aria-label={t('textColor')}
          title={t('textColor')}
          defaultValue="#111827"
          onMouseDown={(event) => event.stopPropagation()}
          onChange={(event) => applyMarks({ color: event.target.value }, event.target.value)}
        />
      </div>
      <div className={styles.docToolGroup}>
        {INLINE_COMMANDS.map((entry) => <button
          key={entry.id}
          type="button"
          data-mark={entry.id}
          aria-pressed={marks.inline.includes(entry.id)}
          onMouseDown={hold}
          onClick={() => run(entry.command)}
          aria-label={t(entry.id)}
          title={t(entry.id)}
        >{entry.glyph}</button>)}
        <button type="button" aria-pressed={marks.code} onMouseDown={hold} onClick={toggleCode} aria-label={t('inlineCode')} title={t('inlineCode')}>{'</>'}</button>
      </div>
      <div className={styles.docToolGroup}>
        {ALIGN_COMMANDS.map((entry) => <button
          key={entry.id}
          type="button"
          aria-pressed={marks.align === entry.id}
          onMouseDown={hold}
          onClick={() => run(entry.command)}
          aria-label={t(entry.label)}
          title={t(entry.label)}
        >{entry.glyph}</button>)}
      </div>
      <div className={styles.docToolGroup}>
        {LIST_COMMANDS.map((entry) => <button
          key={entry.id}
          type="button"
          aria-pressed={marks.inline.includes(entry.id)}
          onMouseDown={hold}
          onClick={() => run(entry.command)}
          aria-label={t(entry.id)}
          title={t(entry.id)}
        >{entry.glyph}</button>)}
        {NEST_COMMANDS.map((entry) => <button
          key={entry.id}
          type="button"
          disabled={!marks.list}
          onMouseDown={hold}
          onClick={() => run(entry.command)}
          aria-label={t(entry.id)}
          title={t(entry.id)}
        >{entry.glyph}</button>)}
      </div>
      <div className={styles.docToolGroup}>
        <button type="button" aria-expanded={inserting === 'link'} onMouseDown={hold} onClick={() => openInsert('link')} aria-label={t('link')} title={t('link')}><Icon source="🔗" size="1em" /></button>
        <button type="button" aria-expanded={inserting === 'image'} onMouseDown={hold} onClick={() => openInsert('image')} aria-label={t('image')} title={t('image')}><Icon source="🖼" size="1em" /></button>
        <button type="button" onMouseDown={hold} onClick={insertTable} aria-label={t('table')} title={t('table')}>▦</button>
        <button type="button" onMouseDown={hold} onClick={() => run('insertHorizontalRule')} aria-label={t('rule')} title={t('rule')}>―</button>
        <button type="button" onMouseDown={hold} onClick={() => run('removeFormat')} aria-label={t('clearFormatting')} title={t('clearFormatting')}>⌫</button>
      </div>
    </div>

    {inserting && <div className={styles.docLinkRow}>
      <input
        autoFocus
        value={insertUrl}
        inputMode="url"
        placeholder={inserting === 'image' ? t('imagePlaceholder') : t('linkPlaceholder')}
        aria-label={inserting === 'image' ? t('imageUrl') : t('linkUrl')}
        onChange={(event) => setInsertUrl(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') { event.preventDefault(); applyInsert(); }
          if (event.key === 'Escape') { event.preventDefault(); setInserting(null); }
        }}
      />
      <button type="button" onMouseDown={hold} onClick={applyInsert}>{t('insertApply')}</button>
      <button type="button" onMouseDown={hold} onClick={() => setInserting(null)}>{tCommon('cancel')}</button>
    </div>}

    <div
      ref={surface}
      className={`${styles.docSurface} ${styles.documentMarkdown}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline
      aria-label={label}
      spellCheck
      onInput={scheduleCommit}
      onBlur={commit}
      onFocus={readMarks}
      onKeyUp={readMarks}
      onMouseUp={readMarks}
      // Backspace and Delete inside a document must edit text, not remove the
      // object from the board, and the board's shortcuts listen on the document.
      onKeyDown={(event) => {
        event.stopPropagation();
        const chord = event.metaKey || event.ctrlKey;
        if (chord && event.key.toLowerCase() === 's') { event.preventDefault(); commit(); return; }
        if (chord && event.key.toLowerCase() === 'k') { event.preventDefault(); openInsert('link'); return; }
        // Tab nests a list item, the way it does in a word processor. Outside a
        // list it stays "leave this field", which is how a keyboard user gets
        // back out of the document.
        if (event.key === 'Tab' && surface.current && enclosingTag(surface.current, 'LI')) {
          event.preventDefault();
          run(event.shiftKey ? 'outdent' : 'indent');
        }
      }}
    />

    {scale === 'page' && <p className={styles.docStatus}>
      <span>{t('words', { count: stats.words })}</span>
      <span>{t('characters', { count: stats.characters })}</span>
    </p>}
  </div>;
}
