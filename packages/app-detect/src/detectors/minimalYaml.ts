/**
 * W11: Minimal block-YAML reading — what the docker-compose detector needs and no more.
 * Dependency-free on purpose: this package is compiled from source by the API, the web app
 * and the VS Code extension, and a YAML library would be one more install in every one of them.
 *
 * Reads:
 * - block mappings (`key: value`, `key:` + an indented block) and block sequences
 *   (`- item`, `- key: value` starting a mapping), a sequence also at its key's indent;
 * - plain, `"double"` (with `\"` / `\\` / `\n` escapes) and `'single'` (`''`) scalars;
 * - one-line flow collections (`[a, "b"]`, `{ a: b }`), nested ones included;
 * - `|` / `>` block scalars (kept / folded), `#` comments, `---` / `...` markers.
 *
 * Every scalar stays a string (`8000` → `'8000'`), and `~` / `null` / an empty value is
 * `null`. Not a YAML parser: anchors and aliases stay their raw text, tags are not read,
 * and a multi-line flow collection or plain scalar is read as its first line only.
 */

export type YamlValue = string | null | YamlValue[] | { [key: string]: YamlValue };

interface Line {
  indent: number;
  /** The line without its indent and its comment. */
  text: string;
  /** The line as written (a block scalar's content keeps its `#`). */
  raw: string;
}

/** `#` starts a comment at the line start or after whitespace, outside a quoted string. */
function stripComment(text: string): string {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if ((ch === '"' || ch === "'") && (i === 0 || /[\s[{,:-]/.test(text[i - 1]!))) quote = ch;
    else if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]!))) return text.slice(0, i);
  }
  return text;
}

function toLines(source: string): Line[] {
  return source.replace(/\r\n?/g, '\n').split('\n').map((raw) => {
    const indent = raw.length - raw.replace(/^ +/, '').length;
    return { indent, text: stripComment(raw.slice(indent)).trimEnd(), raw };
  });
}

/** The index of the `:` that ends a mapping key (followed by a space or the line end), outside quotes; -1 if none. */
function keyColon(text: string): number {
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    else if (ch === ':' && depth === 0 && (i + 1 === text.length || text[i + 1] === ' ')) return i;
  }
  return -1;
}

/** Split a flow collection's body on its top-level commas. */
function splitFlow(body: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function unquoteDouble(body: string): string {
  return body.replace(/\\(["\\/nt])/g, (_, ch: string) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch));
}

/** A one-line value: a quoted or plain scalar, or a flow collection. */
export function yamlScalar(text: string): YamlValue {
  const value = text.trim();
  if (value === '' || value === '~' || value === 'null' || value === 'Null' || value === 'NULL') return null;
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) return unquoteDouble(value.slice(1, -1));
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) return value.slice(1, -1).replace(/''/g, "'");
  if (value.startsWith('[') && value.endsWith(']')) return splitFlow(value.slice(1, -1)).map(yamlScalar);
  if (value.startsWith('{') && value.endsWith('}')) {
    const map: { [key: string]: YamlValue } = {};
    for (const part of splitFlow(value.slice(1, -1))) {
      const colon = keyColon(part);
      if (colon === -1) map[keyText(part)] = null;
      else map[keyText(part.slice(0, colon))] = yamlScalar(part.slice(colon + 1));
    }
    return map;
  }
  return value;
}

function keyText(raw: string): string {
  const key = yamlScalar(raw);
  return typeof key === 'string' ? key : raw.trim();
}

const isSequenceItem = (text: string): boolean => text === '-' || text.startsWith('- ');

class Reader {
  private index = 0;

  constructor(private readonly lines: Line[]) {}

  /** The next line holding content (blank and comment-only lines skipped). */
  private peek(): Line | undefined {
    while (this.index < this.lines.length) {
      const line = this.lines[this.index]!;
      if (line.text !== '' && line.text !== '---' && line.text !== '...') return line;
      this.index++;
    }
    return undefined;
  }

  document(): YamlValue {
    const first = this.peek();
    if (!first) return null;
    return this.block(first.indent);
  }

  private block(indent: number): YamlValue {
    const line = this.peek()!;
    if (isSequenceItem(line.text)) return this.sequence(indent);
    if (keyColon(line.text) === -1) {
      this.index++;
      return yamlScalar(line.text);
    }
    return this.mapping(indent);
  }

  /** The value a `key:` / `-` left empty: the indented block below it (or a sequence at the key's own indent), else null. */
  private nested(indent: number, sequenceAtIndent: boolean): YamlValue {
    const next = this.peek();
    if (!next) return null;
    if (next.indent > indent) return this.block(next.indent);
    if (sequenceAtIndent && next.indent === indent && isSequenceItem(next.text)) return this.sequence(indent);
    return null;
  }

  /** A `|` / `>` block scalar: every following line indented past `indent` (blank lines kept). */
  private blockScalar(indent: number, style: string): string {
    const body: string[] = [];
    let contentIndent: number | null = null;
    while (this.index < this.lines.length) {
      const line = this.lines[this.index]!;
      const blank = line.raw.trim() === '';
      if (!blank && line.indent <= indent) break;
      if (!blank && contentIndent === null) contentIndent = line.indent;
      body.push(blank ? '' : line.raw.slice(contentIndent ?? line.indent));
      this.index++;
    }
    while (body.length > 0 && body[body.length - 1] === '') body.pop();
    // Folded: lines join with a space, a blank line is a line break.
    return style.startsWith('>') ? `${body.join('\n').replace(/([^\n])\n(?=[^\n])/g, '$1 ')}\n` : `${body.join('\n')}\n`;
  }

  private value(rest: string, indent: number, sequenceAtIndent: boolean): YamlValue {
    if (rest === '') return this.nested(indent, sequenceAtIndent);
    if (/^[|>][+-]?\d*$/.test(rest)) return this.blockScalar(indent, rest);
    return yamlScalar(rest);
  }

  private mapping(indent: number): { [key: string]: YamlValue } {
    const map: { [key: string]: YamlValue } = {};
    for (let line = this.peek(); line && line.indent === indent && !isSequenceItem(line.text); line = this.peek()) {
      const colon = keyColon(line.text);
      if (colon === -1) break;
      this.index++;
      map[keyText(line.text.slice(0, colon))] = this.value(line.text.slice(colon + 1).trim(), indent, true);
    }
    return map;
  }

  private sequence(indent: number): YamlValue[] {
    const items: YamlValue[] = [];
    for (let line = this.peek(); line && line.indent === indent && isSequenceItem(line.text); line = this.peek()) {
      const item = line.text.slice(1).trimStart();
      if (item === '') {
        this.index++;
        items.push(this.nested(indent, false));
      } else if (keyColon(item) !== -1 && !/^["'[{]/.test(item)) {
        // `- key: value` opens a mapping whose keys sit where `key` does.
        const itemIndent = indent + (line.text.length - item.length);
        this.lines[this.index] = { indent: itemIndent, text: item, raw: line.raw };
        items.push(this.mapping(itemIndent));
      } else {
        this.index++;
        items.push(this.value(item, indent, false));
      }
    }
    return items;
  }
}

/** Read a YAML document; a top-level that is not block YAML reads as far as it can. */
export function parseYaml(source: string): YamlValue {
  return new Reader(toLines(source)).document();
}

/** The mapping `value` is, else null. */
export function yamlMap(value: YamlValue | undefined): { [key: string]: YamlValue } | null {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
