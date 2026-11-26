import type { DefinitionSpan } from "@builderforce/agent-tools/node-tree-sitter";

export interface CodeChunk {
  startLine: number;
  endLine: number;
  symbol?: string;
  kind: string;
}

const MAX_DEFINITION_LINES = 150;
const CONTAINER_HEADER_LINES = 25;
const WINDOW_LINES = 60;
const WINDOW_OVERLAP = 10;
const MIN_GAP_LINES = 6;
const CONTAINERS = new Set(["class", "interface", "struct", "trait", "module", "enum"]);

/** Keep whole definitions when they fit, then cover oversized bodies and gaps with windows. */
export function codeChunks(lines: readonly string[], symbols: readonly DefinitionSpan[]): CodeChunk[] {
  const covered = new Uint8Array(lines.length + 1);
  const chunks: CodeChunk[] = [];
  const known = symbols.filter((symbol): symbol is DefinitionSpan & { startLine: number; endLine: number } =>
    symbol.startLine !== undefined && symbol.endLine !== undefined,
  ).sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);

  function add(startLine: number, endLine: number, symbol?: DefinitionSpan) {
    if (!lines.slice(startLine - 1, endLine).some((line) => line.trim())) return;
    covered.fill(1, startLine, endLine + 1);
    chunks.push({ startLine, endLine, kind: symbol?.kind ?? "code", ...(symbol ? { symbol: symbol.name } : {}) });
  }

  function windows(start: number, end: number, symbol?: DefinitionSpan) {
    for (let line = start; line <= end; line += WINDOW_LINES - WINDOW_OVERLAP) {
      const last = Math.min(end, line + WINDOW_LINES - 1);
      add(line, last, symbol ?? symbols.find((candidate) => candidate.line >= line && candidate.line <= last));
      if (last === end) break;
    }
  }

  for (const symbol of known) {
    const start = symbol.startLine;
    const end = Math.min(symbol.endLine, lines.length);
    if (start < 1 || start > end) continue;
    if (end - start + 1 <= MAX_DEFINITION_LINES) {
      if (!covered.subarray(start, end + 1).every(Boolean)) add(start, end, symbol);
    } else if (CONTAINERS.has(symbol.kind)) {
      add(start, start + CONTAINER_HEADER_LINES - 1, symbol);
    } else {
      windows(start, end, symbol);
    }
  }

  for (let line = 1; line <= lines.length;) {
    if (covered[line]) { line++; continue; }
    const start = line;
    while (line <= lines.length && !covered[line]) line++;
    if (known.length === 0 || lines.slice(start - 1, line - 1).filter((part) => part.trim()).length >= MIN_GAP_LINES) {
      windows(start, line - 1);
    }
  }
  return chunks.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
}
