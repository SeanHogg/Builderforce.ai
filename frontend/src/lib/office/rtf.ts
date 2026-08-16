/**
 * `.rtf` → plain text, keeping the paragraph structure.
 */

/* ------------------------------------------------------------------ RTF --- */

/**
 * Groups whose contents are metadata rather than body text. These are ordinary
 * groups, not `\*` destinations, so dropping only the starred ones leaves a
 * document body reading "Arial;Times New Roman;" before its first sentence.
 */
const RTF_DROPPED_DESTINATIONS = new Set([
  '*', 'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'filetbl', 'revtbl',
  'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf',
  'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'themedata', 'datastore',
  'colorschememapping', 'latentstyles', 'xmlnstbl', 'upr',
]);

const RTF_BREAK_WORDS = new Set(['par', 'line', 'sect', 'page', 'row']);
const RTF_GROUP_DESTINATION = /^\{\s*\\(\*|[a-zA-Z]+)/;
/** Sticky, so tokenizing a multi-megabyte file does not re-slice the source on
 * every control word. */
const RTF_TOKEN = /\\(?:u(-?\d+)|'([0-9a-fA-F]{2})|([a-zA-Z]+)(-?\d+)?|([\\{}])|([\r\n]))/y;

/** Index just past the group starting at `start`, honouring nesting. */
function skipRtfGroup(source: string, start: number): number {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') { index += 1; continue; }
    if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return index + 1;
  }
  return source.length;
}

/** Plain text from an RTF file — the paragraph structure survives, the control
 * words and the metadata tables do not. */
export function rtfToText(source: string): string {
  if (!source.trimStart().startsWith('{\\rtf')) return '';
  let text = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (char === '{') {
      const destination = RTF_GROUP_DESTINATION.exec(source.slice(index, index + 32))?.[1]?.toLowerCase();
      if (destination && RTF_DROPPED_DESTINATIONS.has(destination)) { index = skipRtfGroup(source, index); continue; }
      index += 1;
      continue;
    }
    if (char === '}') { index += 1; continue; }
    if (char === '\r' || char === '\n') { index += 1; continue; }
    if (char !== '\\') { text += char; index += 1; continue; }

    RTF_TOKEN.lastIndex = index;
    const token = RTF_TOKEN.exec(source);
    if (!token) { index += 1; continue; }
    index += token[0].length;
    if (token[1] != null) {
      const code = Number(token[1]);
      text += String.fromCharCode(code < 0 ? code + 65536 : code);
      // A \uN is followed by the character a non-Unicode reader would show.
      if (source[index] === ' ') index += 1;
      if (source[index] === '?') index += 1;
      continue;
    }
    if (token[2] != null) { text += String.fromCharCode(parseInt(token[2], 16)); continue; }
    if (token[5] != null) { text += token[5]; continue; }
    if (token[6] != null) { text += '\n'; continue; }
    const word = token[3]!.toLowerCase();
    if (RTF_BREAK_WORDS.has(word)) text += '\n';
    else if (word === 'tab') text += '\t';
    // One space may delimit a control word; it is syntax, not content.
    if (source[index] === ' ') index += 1;
  }
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
