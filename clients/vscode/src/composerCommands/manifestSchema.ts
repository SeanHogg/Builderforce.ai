/**
 * The `$schema` older manifests carry. Kits and `/manifest init` wrote
 * `"$schema": "<APP_MANIFEST_SCHEMA_URL>"` until the extension started associating the schema by
 * path (`contributes.jsonValidation`). A document's own `$schema` wins over that association, and
 * while the URL does not resolve VS Code reports "Unable to load schema" on the file.
 *
 * `/manifest move` (`manifestMove.ts`) is the ONE place that removes it: when it moves a legacy
 * root file, and when the canonical file still carries it (`/launch` offers that action).
 *
 * The URL is the runtime's (`APP_MANIFEST_SCHEMA_URL`) — the same constant the frontend's
 * publish script serves the schema at — never a copy here. Only that exact value is removed,
 * only at the top level; any other `$schema` is left alone.
 */
import { APP_MANIFEST_SCHEMA_URL } from "@seanhogg/builderforce-webcontainers-core/manifest";

export { APP_MANIFEST_SCHEMA_URL };

const SCHEMA_KEY = "$schema";
const isSpace = (char: string | undefined): boolean => char === " " || char === "\t" || char === "\n" || char === "\r";

/** Where a top-level member sits in the text: its key's first character to its value's end. */
interface MemberSpan {
  key: string;
  start: number;
  valueStart: number;
  end: number;
}

/** The end (exclusive) of the JSON string starting at `start` (a `"`). */
function stringEnd(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") index += 2;
    else if (char === "\"") return index + 1;
    else index += 1;
  }
  return text.length;
}

/** The end (exclusive) of the JSON value starting at `start`. */
function valueEnd(text: string, start: number): number {
  if (text[start] === "\"") return stringEnd(text, start);
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "\"") {
      index = stringEnd(text, index);
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      if (depth === 0) return index;
      depth -= 1;
      if (depth === 0) return index + 1;
    } else if (depth === 0 && (char === "," || isSpace(char))) return index;
    index += 1;
  }
  return index;
}

const skipSpace = (text: string, index: number): number => {
  while (isSpace(text[index])) index += 1;
  return index;
};

/** The root object's members, in order, with the braces' positions. Assumes `text` parses as JSON. */
function topLevelMembers(text: string): { open: number; close: number; members: MemberSpan[] } | undefined {
  const open = skipSpace(text, 0);
  if (text[open] !== "{") return undefined;
  const members: MemberSpan[] = [];
  let index = skipSpace(text, open + 1);
  while (index < text.length && text[index] !== "}") {
    if (text[index] !== "\"") return undefined;
    const keyEnd = stringEnd(text, index);
    const key = JSON.parse(text.slice(index, keyEnd)) as string;
    const colon = skipSpace(text, keyEnd);
    if (text[colon] !== ":") return undefined;
    const valueStart = skipSpace(text, colon + 1);
    const end = valueEnd(text, valueStart);
    members.push({ key, start: index, valueStart, end });
    index = skipSpace(text, end);
    if (text[index] === ",") index = skipSpace(text, index + 1);
  }
  return text[index] === "}" ? { open, close: index, members } : undefined;
}

/**
 * The manifest text without its top-level `"$schema": "<APP_MANIFEST_SCHEMA_URL>"`, or undefined
 * when it has no such member (another `$schema` value, a nested one, or text that is not a JSON
 * object). The edit is minimal: the member and one separating comma go, every other character
 * stays (a UTF-8 BOM is already gone in the decoded text the port reads, and is not written back).
 */
export function withoutStaleSchema(text: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON (a half-edited file): left exactly as it is; the runtime and the editor report it.
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  if ((parsed as Record<string, unknown>)[SCHEMA_KEY] !== APP_MANIFEST_SCHEMA_URL) return undefined;
  const root = topLevelMembers(text);
  if (!root) return undefined;
  const matches = root.members.filter((member) => member.key === SCHEMA_KEY);
  // A duplicated key is ambiguous: nothing is guessed.
  if (matches.length !== 1) return undefined;
  const member = matches[0]!;
  if (JSON.parse(text.slice(member.valueStart, member.end)) !== APP_MANIFEST_SCHEMA_URL) return undefined;
  if (root.members.length === 1) return text.slice(0, root.open + 1) + text.slice(root.close);
  const after = skipSpace(text, member.end);
  // Not the last member: the member, its comma and the space up to the next key go.
  if (text[after] === ",") return text.slice(0, member.start) + text.slice(skipSpace(text, after + 1));
  // The last member: the comma before it and the member go; what follows it (the closing line) stays.
  let before = member.start - 1;
  while (isSpace(text[before])) before -= 1;
  return text.slice(0, before) + text.slice(member.end);
}

/** Does the manifest carry the stale top-level `$schema`? */
export function hasStaleSchema(text: string | undefined): boolean {
  return text !== undefined && withoutStaleSchema(text) !== undefined;
}
