/**
 * datasetFromFile — recognise a training corpus written as a project FILE.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * There were two ways a corpus could come into existence and only one of them
 * counted. `POST /ide/datasets/import` and `/datasets/generate` write the rows
 * to R2 AND insert an `ide_datasets` row, which is what puts the corpus in the
 * fine-tune picker and what `trainingDatasetGate` reads its classification and
 * use-policy from before any training run. The Brain's `create_file` tool wrote
 * a file and nothing else — so when a user asked it for training data and it
 * produced a perfectly good `data/train.jsonl`, that corpus was invisible to
 * every training surface and ungoverned by the gate. The user saw a file appear
 * and then could not find it anywhere they could train on.
 *
 * ── WHY DETECTION, NOT A SECOND TOOL ────────────────────────────────────────
 * Giving the Brain a separate `create_dataset` tool would only work when the
 * model happened to pick it, and the failure mode is silent in exactly the same
 * way. Recognising the artifact is what makes the two paths converge: whatever
 * writes a JSONL instruction corpus into the workspace, the corpus gets
 * registered. The recognition is deliberately STRICT — a JSONL file whose rows
 * are not instruction/output pairs is just a file, and stays one.
 *
 * Pure and dependency-free so the rules can be unit-tested without a workspace.
 */

/** One instruction-tuning row, in the shape the import endpoint accepts. */
export interface DatasetExample {
  instruction: string;
  input?: string;
  output: string;
}

/** Extensions that can carry a line-delimited corpus. */
const CORPUS_EXTENSIONS = ['.jsonl', '.ndjson'];

/** Rows above this are truncated by the server anyway; stop parsing early. */
const MAX_PARSED_ROWS = 5_000;

/** Could this path hold a training corpus? Extension only — content decides. */
export function looksLikeDatasetPath(path: string): boolean {
  const lower = path.toLowerCase();
  return CORPUS_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Parse a file body as an instruction corpus, or return null when it is not one.
 *
 * Returns null — rather than an empty array — for anything that is not clearly a
 * corpus, so the caller can tell "not a dataset" from "an empty dataset" and
 * never registers a file the user meant as ordinary JSONL. Every non-blank line
 * must be a JSON object carrying a string `instruction` and a string `output`;
 * one line that is not disqualifies the file.
 */
export function parseJsonlDataset(content: string): DatasetExample[] | null {
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0 || lines.length > MAX_PARSED_ROWS) return null;

  const examples: DatasetExample[] = [];
  for (const line of lines) {
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      return null;
    }
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return null;
    const record = row as Record<string, unknown>;
    if (typeof record.instruction !== 'string' || typeof record.output !== 'string') return null;
    if (record.instruction.trim() === '' || record.output.trim() === '') return null;
    examples.push({
      instruction: record.instruction,
      output: record.output,
      ...(typeof record.input === 'string' ? { input: record.input } : {}),
    });
  }
  return examples;
}

/**
 * The dataset NAME for a corpus written at `path` — the file's basename without
 * its extension, so `data/support-replies.jsonl` registers as
 * "support-replies" rather than as an opaque id.
 */
export function datasetNameForPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.trim() || base;
}
