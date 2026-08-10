'use client';

/**
 * The document editor on the card — word processing, on the board.
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
 */

import { Icon } from '@/components/ui/Icon';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './CreationCanvas.module.css';
import { escapeHtml, htmlToMarkdown, markdownToHtml } from '@/lib/richText';

/** Write the body back this long after the last keystroke, so a session that
 * ends without a blur — a closed tab, a dragged card — still keeps the edit. */
const AUTOSAVE_MS = 1200;

/** Inline marks that survive the markdown round trip. Underline is absent on
 * purpose: markdown has no underline, so an underline button would produce a
 * style that silently vanished the moment the document was saved. */
const INLINE_COMMANDS = [
  { id: 'bold', command: 'bold', glyph: 'B' },
  { id: 'italic', command: 'italic', glyph: 'I' },
  { id: 'strikethrough', command: 'strikeThrough', glyph: 'S' },
] as const;

const LIST_COMMANDS = [
  { id: 'bulletList', command: 'insertUnorderedList', glyph: '☰' },
  { id: 'numberList', command: 'insertOrderedList', glyph: '№' },
] as const;

/** Block styles, and the tag name `formatBlock` wants for each. Not composed at
 * the call site: `formatBlock` takes an angle-bracketed tag in most engines and
 * a bare name in others, so the exact string belongs in one place. */
const BLOCK_FORMATS = ['p', 'h1', 'h2', 'h3', 'blockquote', 'pre'];
const BLOCK_TAGS: Readonly<Record<string, string>> = Object.fromEntries(BLOCK_FORMATS.map((name) => [name, ['<', name, '>'].join('')]));
type BlockFormat = 'p' | 'h1' | 'h2' | 'h3' | 'blockquote' | 'pre';

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

/** The `<code>` the caret sits in, if any — inline code has no editing command
 * of its own, so it is toggled by hand. */
function enclosingCode(root: HTMLElement): HTMLElement | null {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode ?? null;
  let node: Node | null = anchor?.nodeType === 1 ? anchor : anchor?.parentNode ?? null;
  while (node && node !== root) {
    if ((node as Element).tagName === 'CODE') return node as HTMLElement;
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
  onCommit: (markdown: string) => void;
}

export function DocumentEditor({ markdown, label, onCommit }: DocumentEditorProps) {
  const t = useTranslations('creationCanvas.editor');
  const surface = useRef<HTMLDivElement>(null);
  /** The markdown the surface currently represents. Guards the load effect from
   * re-writing the DOM (and dropping the caret) when the parent echoes back the
   * value we just committed. */
  const loaded = useRef<string | null>(null);
  const savedRange = useRef<Range | null>(null);
  const autosave = useRef<number>(0);
  const [marks, setMarks] = useState<{ inline: readonly string[]; block: BlockFormat; code: boolean }>({ inline: [], block: 'p', code: false });
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  useEffect(() => {
    const node = surface.current;
    if (!node || loaded.current === markdown) return;
    loaded.current = markdown;
    node.innerHTML = markdownToHtml(markdown) || '<p><br></p>';
  }, [markdown]);

  const readMarks = useCallback(() => {
    const node = surface.current;
    if (!node || !node.contains(document.getSelection()?.anchorNode ?? null)) return;
    setMarks({
      inline: [...INLINE_COMMANDS, ...LIST_COMMANDS].filter((entry) => commandActive(entry.command)).map((entry) => entry.id),
      block: currentBlockFormat(),
      code: !!enclosingCode(node),
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
    window.clearTimeout(autosave.current);
    autosave.current = window.setTimeout(commit, AUTOSAVE_MS);
  }, [commit]);

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
    const existing = enclosingCode(node);
    if (existing) {
      existing.replaceWith(...Array.from(existing.childNodes));
    } else {
      const selected = window.getSelection()?.toString() ?? '';
      document.execCommand('insertHTML', false, `<code>${escapeHtml(selected || t('codePlaceholder'))}</code>`);
    }
    readMarks();
    scheduleCommit();
  }, [readMarks, scheduleCommit, t]);

  const openLink = useCallback(() => {
    const selection = window.getSelection();
    savedRange.current = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    setLinkUrl('');
    setLinkOpen(true);
  }, []);

  const applyLink = useCallback(() => {
    const node = surface.current;
    const url = linkUrl.trim();
    setLinkOpen(false);
    if (!node || !url) return;
    node.focus();
    const range = savedRange.current;
    if (range) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    if (range && !range.collapsed) document.execCommand('createLink', false, url);
    else document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
    scheduleCommit();
  }, [linkUrl, scheduleCommit]);

  const blockOptions = useMemo(() => [
    { value: 'p' as const, label: t('blockParagraph') },
    { value: 'h1' as const, label: t('blockHeading1') },
    { value: 'h2' as const, label: t('blockHeading2') },
    { value: 'h3' as const, label: t('blockHeading3') },
    { value: 'blockquote' as const, label: t('blockQuote') },
    { value: 'pre' as const, label: t('blockCode') },
  ], [t]);

  /** A toolbar press must not take focus: the selection it is about to act on
   * lives in the surface, and blurring collapses it. */
  const hold = (event: React.MouseEvent) => { event.preventDefault(); event.stopPropagation(); };

  const applyBlockFormat = useCallback((format: string) => run('formatBlock', BLOCK_TAGS[format] ?? BLOCK_TAGS.p!), [run]);

  return <div className={`${styles.docEditor} nodrag nowheel`} onPointerDownCapture={(event) => event.stopPropagation()}>
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
        {LIST_COMMANDS.map((entry) => <button
          key={entry.id}
          type="button"
          aria-pressed={marks.inline.includes(entry.id)}
          onMouseDown={hold}
          onClick={() => run(entry.command)}
          aria-label={t(entry.id)}
          title={t(entry.id)}
        >{entry.glyph}</button>)}
      </div>
      <div className={styles.docToolGroup}>
        <button type="button" aria-expanded={linkOpen} onMouseDown={hold} onClick={openLink} aria-label={t('link')} title={t('link')}><Icon source="🔗" size="1em" /></button>
        <button type="button" onMouseDown={hold} onClick={() => run('insertHorizontalRule')} aria-label={t('rule')} title={t('rule')}>―</button>
        <button type="button" onMouseDown={hold} onClick={() => run('removeFormat')} aria-label={t('clearFormatting')} title={t('clearFormatting')}>⌫</button>
      </div>
    </div>

    {linkOpen && <div className={styles.docLinkRow}>
      <input
        autoFocus
        value={linkUrl}
        inputMode="url"
        placeholder={t('linkPlaceholder')}
        aria-label={t('linkUrl')}
        onChange={(event) => setLinkUrl(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') { event.preventDefault(); applyLink(); }
          if (event.key === 'Escape') { event.preventDefault(); setLinkOpen(false); }
        }}
      />
      <button type="button" onMouseDown={hold} onClick={applyLink}>{t('linkApply')}</button>
      <button type="button" onMouseDown={hold} onClick={() => setLinkOpen(false)}>{t('linkCancel')}</button>
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
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); commit(); }
      }}
    />
  </div>;
}
