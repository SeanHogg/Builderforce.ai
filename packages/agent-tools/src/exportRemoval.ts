/**
 * The per-export remover behind the `unused-export` fix (PRD 41 WS9): it removes ONE named
 * export of a JS/TS file and leaves every other export alone (knip's own `--fix` removes every
 * unused export of the file, which is why it is not used for this).
 *
 *   declaration still used in the file   `export` is dropped, the declaration stays;
 *   declaration with no use in the file  the whole statement goes (with its attached comments);
 *   a specifier of `export { a, b }`     only that specifier goes (the whole statement when it is the last).
 *
 * Every statement that declares the name is handled (overloads, merged declarations). Anything
 * else (a destructured export, a used declarator of `export const a = 1, b = 2`, a file that does
 * not parse cleanly, a name that is not exported) is REFUSED with an {@link ExportRemovalRefusal}:
 * the file is never guessed at.
 *
 * Pure over a parse tree (`SyntaxNodeLike`, the slice of a tree-sitter node it reads), so it is
 * tested with the real grammar and needs no I/O. The Node half that parses is
 * `node-export-remover.ts`.
 */

/** The slice of a tree-sitter `SyntaxNode` this module reads. */
export interface SyntaxNodeLike {
  readonly type: string;
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly hasError: boolean;
  readonly children: readonly SyntaxNodeLike[];
  readonly namedChildren: readonly SyntaxNodeLike[];
  childForFieldName(field: string): SyntaxNodeLike | null;
}

export type ExportRemovalAction = "unexported" | "removed" | "specifier-removed";

export interface ExportRemoval {
  /** The file after the edit. */
  source: string;
  action: ExportRemovalAction;
}

/** Why the remover would not touch the file. */
export type ExportRemovalRefusalCode = "not-found" | "unsupported" | "unparsed";

export class ExportRemovalRefusal extends Error {
  constructor(readonly code: ExportRemovalRefusalCode, readonly exportName: string, message: string) {
    super(message);
    this.name = "ExportRemovalRefusal";
  }
}

interface Edit { start: number; end: number }

/** Declarations whose `name` field is the declared name. */
const NAMED_DECLARATIONS = new Set([
  "function_declaration", "generator_function_declaration", "function_signature",
  "class_declaration", "abstract_class_declaration", "interface_declaration",
  "type_alias_declaration", "enum_declaration", "internal_module", "module",
]);
const VARIABLE_DECLARATIONS = new Set(["lexical_declaration", "variable_declaration"]);
/** Identifier nodes that can REFER to a binding (a property name never does). */
const REFERENCE_TYPES = new Set(["identifier", "type_identifier", "shorthand_property_identifier", "shorthand_property_identifier_pattern"]);

/** The declaration an `export` statement carries, with `declare` unwrapped. */
function declarationOf(statement: SyntaxNodeLike): SyntaxNodeLike | undefined {
  let decl = statement.childForFieldName("declaration") ?? undefined;
  if (decl?.type === "ambient_declaration") decl = decl.namedChildren.find((c) => NAMED_DECLARATIONS.has(c.type) || VARIABLE_DECLARATIONS.has(c.type));
  return decl;
}

/** The `variable_declarator`s of a variable declaration. */
const declaratorsOf = (decl: SyntaxNodeLike): SyntaxNodeLike[] => decl.namedChildren.filter((c) => c.type === "variable_declarator");

/** The local name a specifier exports under: the alias when there is one, else the name. */
function exportedNameOf(specifier: SyntaxNodeLike): string | undefined {
  const alias = specifier.childForFieldName("alias");
  const name = specifier.childForFieldName("name");
  return (alias ?? name)?.text;
}

/** Every reference-shaped identifier of the tree with this text, outside the given ranges. */
function hasReferenceOutside(root: SyntaxNodeLike, name: string, skip: readonly Edit[]): boolean {
  const stack: SyntaxNodeLike[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (skip.some((r) => node.startIndex >= r.start && node.endIndex <= r.end)) continue;
    if (REFERENCE_TYPES.has(node.type) && node.text === name) return true;
    for (const child of node.children) stack.push(child);
  }
  return false;
}

const lineStartOf = (source: string, index: number): number => source.lastIndexOf("\n", index - 1) + 1;

function lineEndAfter(source: string, index: number): number {
  const nl = source.indexOf("\n", index);
  return nl === -1 ? source.length : nl + 1;
}

const blank = (text: string): boolean => text.trim() === "";

/**
 * The span of a whole top-level statement: from the start of its line (when only whitespace
 * precedes it) through its line end, with the comments attached right above it (no blank line
 * between) and a comment trailing on its last line. A blank line left doubled is collapsed.
 */
function statementSpan(source: string, siblings: readonly SyntaxNodeLike[], statement: SyntaxNodeLike): Edit {
  const at = siblings.indexOf(statement);
  let start = statement.startIndex;
  for (let i = at - 1; i >= 0; i--) {
    const prev = siblings[i]!;
    if (prev.type !== "comment") break;
    // Attached: only a line break (no blank line) between the comment and what follows it.
    const gap = source.slice(prev.endIndex, start);
    if (!/^[ \t]*\r?\n[ \t]*$/.test(gap)) break;
    // A comment trailing code on its own line belongs to that code, not to this statement.
    if (!blank(source.slice(lineStartOf(source, prev.startIndex), prev.startIndex))) break;
    start = prev.startIndex;
  }
  let end = statement.endIndex;
  const next = siblings[at + 1];
  if (next?.type === "comment" && !source.slice(end, next.startIndex).includes("\n")) end = next.endIndex;

  const lineStart = lineStartOf(source, start);
  if (blank(source.slice(lineStart, start))) start = lineStart;
  const lineEnd = lineEndAfter(source, end);
  if (blank(source.slice(end, lineEnd))) end = lineEnd;

  // Blank (or the file's start) before and a blank line after: drop that blank line too.
  const before = source.slice(lineStartOf(source, Math.max(0, start - 1)), start);
  const afterEnd = lineEndAfter(source, end);
  if (start === lineStartOf(source, start) && (start === 0 || blank(before)) && end < source.length && blank(source.slice(end, afterEnd))) end = afterEnd;
  return { start, end };
}

/** The span of one item of a comma list: it and the comma after it, or (the last) the comma before it. */
function listItemSpan(items: readonly SyntaxNodeLike[], item: SyntaxNodeLike): Edit {
  const at = items.indexOf(item);
  const next = items[at + 1];
  if (next) return { start: item.startIndex, end: next.startIndex };
  const prev = items[at - 1]!;
  return { start: prev.endIndex, end: item.endIndex };
}

/** The `export` keyword and the whitespace after it (decorators before it stay). */
function exportKeywordSpan(source: string, statement: SyntaxNodeLike): Edit {
  const keyword = statement.children.find((c) => c.type === "export")!;
  let end = keyword.endIndex;
  while (end < source.length && /\s/.test(source[end]!)) end++;
  return { start: keyword.startIndex, end };
}

function applyEdits(source: string, edits: readonly Edit[]): string {
  let out = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + out.slice(edit.end);
  return out;
}

/**
 * Removes the export `name` from `source`, parsed as `root` (the `program` node). Throws an
 * {@link ExportRemovalRefusal} when the file does not parse cleanly, does not export the name at
 * top level, or exports it in a shape this remover does not edit.
 */
export function removeExport(source: string, root: SyntaxNodeLike, name: string): ExportRemoval {
  if (root.hasError) throw new ExportRemovalRefusal("unparsed", name, `The file does not parse cleanly, so "${name}" was not removed.`);
  const unsupported = (shape: string): ExportRemovalRefusal =>
    new ExportRemovalRefusal("unsupported", name, `"${name}" is exported as ${shape}, which the remover does not edit.`);
  const top = root.namedChildren;
  const exports = top.filter((n) => n.type === "export_statement");

  // `export { a, b }` / `export { a } from "./x"`: one specifier goes.
  for (const statement of exports) {
    const clause = statement.namedChildren.find((c) => c.type === "export_clause");
    if (!clause) continue;
    const specifiers = clause.namedChildren.filter((c) => c.type === "export_specifier");
    const specifier = specifiers.find((s) => exportedNameOf(s) === name);
    if (!specifier) continue;
    const edit = specifiers.length === 1 ? statementSpan(source, top, statement) : listItemSpan(specifiers, specifier);
    return { source: applyEdits(source, [edit]), action: "specifier-removed" };
  }

  // `export <declaration>`: every statement declaring the name (overloads, merged declarations).
  const declaring: Array<{ statement: SyntaxNodeLike; decl: SyntaxNodeLike; declarator?: SyntaxNodeLike }> = [];
  for (const statement of exports) {
    const decl = declarationOf(statement);
    if (!decl) continue;
    if (VARIABLE_DECLARATIONS.has(decl.type)) {
      const declarators = declaratorsOf(decl);
      const declarator = declarators.find((d) => d.childForFieldName("name")?.text === name);
      if (declarator) { declaring.push({ statement, decl, declarator }); continue; }
      // `export const { a } = x` / `export const [a] = x`: the name is bound by a pattern.
      if (declarators.some((d) => d.childForFieldName("name")?.type !== "identifier" && hasReferenceOutside(d.childForFieldName("name")!, name, []))) throw unsupported("part of a destructuring pattern");
      continue;
    }
    if (NAMED_DECLARATIONS.has(decl.type) && decl.childForFieldName("name")?.text === name) declaring.push({ statement, decl });
  }
  if (declaring.length === 0) throw new ExportRemovalRefusal("not-found", name, `No top-level export named "${name}" was found.`);

  const own = declaring.map((d) => ({ start: d.statement.startIndex, end: d.statement.endIndex }));
  const usedLocally = hasReferenceOutside(root, name, own);
  const multi = declaring.find((d) => d.declarator && declaratorsOf(d.decl).length > 1);
  if (usedLocally) {
    // Dropping `export` from `export const a = 1, b = 2` would un-export `b` too.
    if (multi) throw unsupported("one of several declarators that is still used in the file");
    return { source: applyEdits(source, declaring.map((d) => exportKeywordSpan(source, d.statement))), action: "unexported" };
  }
  const edits = declaring.map((d) =>
    d.declarator && declaratorsOf(d.decl).length > 1 ? listItemSpan(declaratorsOf(d.decl), d.declarator) : statementSpan(source, top, d.statement));
  return { source: applyEdits(source, edits), action: "removed" };
}
