/**
 * The BASELINE-RAISE gate: a commit that ADDS or RAISES an entry in a ratchet baseline grandfathers new debt. A ratchet
 * baseline may only shrink; `--update` rewrites it to whatever the tree measures now, so a run that "fixes" a failing
 * ratchet by regenerating its baseline records every new violation as accepted. VS Code chat #275 did exactly that:
 * `check-react-hooks-ratchet.mjs --update` grandfathered ~11 new warnings and was committed as "Record react-hooks
 * ratchet improvement" (c9c043248) — no gate noticed.
 *
 * Pure: a unified diff in, the added / raised entries out. The commit tool (VS Code `git_commit` / `git_push`) refuses
 * them unless the message carries {@link BASELINE_RAISE_TRAILER} with a reason.
 *
 * Baseline files ({@link isBaselineFile}): the dot-prefixed ratchet baselines under a `scripts/` folder
 * (`frontend/scripts/.react-hooks-baseline.txt`, `frontend/scripts/.frontend-architecture-baseline.json`,
 * `api/scripts/.layering-baseline.txt`, …) and the `BASELINE` object in `frontend/scripts/check-design-scale.mjs`. A
 * perf snapshot such as `baseline.gate.json` moves both ways and is not one.
 *
 * Entry shapes: `path N`, `path:N`, `"key": N`, `key: N`, and a bare `path` (a list baseline) or `"path"` (a JSON list).
 * JSON entries are keyed by their section path (`oversizedProductionFileLines > app/x.tsx`), so the same key in two
 * sections is two entries — which needs the hunk to show its section, so callers diff baselines with full context.
 *
 * A MOVE is not a raise: when a file's total does not rise and every new entry is matched by a removed entry of an equal
 * or higher count (`old.tsx 3` → `new.tsx 3`), the new entries are a rename.
 */

/** The commit-message trailer that owns a deliberate raise: `baseline-raise: <reason>`. */
export const BASELINE_RAISE_TRAILER = "baseline-raise:";

/** One entry a diff added to a baseline (`from: null`) or raised (`from < to`). `to: null` = a count-less list entry. */
export interface BaselineRaise {
  file: string;
  key: string;
  from: number | null;
  to: number | null;
}

/** The design-scale ratchet, whose baseline is an object inside the script. */
const DESIGN_SCALE = "frontend/scripts/check-design-scale.mjs";

/** A dot-prefixed ratchet baseline under a `scripts/` folder: `api/scripts/.layering-baseline.txt`. */
const RATCHET_BASELINE = /(?:^|\/)scripts\/\.[^/]*baseline[^/]*\.(?:txt|json)$/i;

/** Whether `path` (repo-relative, forward slashes) is a ratchet baseline the gate reads. */
export function isBaselineFile(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  return RATCHET_BASELINE.test(p) || p === DESIGN_SCALE || p.endsWith(`/${DESIGN_SCALE}`);
}

/** The diff options a caller passes so a JSON baseline's hunks show their sections (one hunk per file). */
export const BASELINE_DIFF_CONTEXT = "-U100000";

const COUNTED: readonly RegExp[] = [
  /^"([^"]+)"\s*:\s*(\d+)\s*,?$/, // "path": N
  /^([A-Za-z_$][\w$]*)\s*:\s*(\d+)\s*,?$/, // key: N (the design-scale BASELINE object)
  /^(\S+)\s+(\d+)$/, // path N
  /^(\S+?):(\d+)$/, // path:N
];
const LISTED_TXT = /^([\w@./[\]()-]+)$/; // a bare path line
const LISTED_JSON = /^"([^"]+)"\s*,?$/; // a "path" array element
const JSON_OPEN = /^(?:"([^"]+)"\s*:\s*)?[{[]\s*$/; // `"section": {`, `"list": [`, a bare `{`
const JSON_CLOSE = /^[}\]]\s*,?$/;

type Entry = { key: string; value: number | null };

/** One baseline line's entry, or null when the line is not one. */
function entryOf(file: string, line: string): Entry | null {
  const text = line.trim();
  if (!text || text.startsWith("#") || text.startsWith("//") || text.startsWith("*") || text.startsWith("/*")) return null;
  const designScale = file.endsWith("check-design-scale.mjs");
  for (const [i, pattern] of COUNTED.entries()) {
    // The source file holds code, not just the BASELINE object: only its `key: N` shape is read there.
    if (designScale && i !== 1) continue;
    const m = pattern.exec(text);
    if (m) return { key: m[1]!, value: Number(m[2]) };
  }
  if (designScale) return null;
  const listed = (file.endsWith(".json") ? LISTED_JSON : LISTED_TXT).exec(text);
  return listed ? { key: listed[1]!, value: null } : null;
}

/** The file a `+++ b/path` header names (null for `/dev/null`). */
function newPathOf(header: string): string | null {
  const raw = header.slice(4).trim().replace(/\t.*$/, "");
  if (raw === "/dev/null") return null;
  return raw.replace(/^"?b\//, "").replace(/"$/, "");
}

/** A JSON file's section nesting, as one side (old or new) of the diff reads it. */
class Sections {
  private readonly stack: string[] = [];
  /** A structural line: open or close a section. Returns whether it was one. */
  step(text: string): boolean {
    const t = text.trim();
    const open = JSON_OPEN.exec(t);
    if (open) {
      this.stack.push(open[1] ?? "");
      return true;
    }
    if (JSON_CLOSE.test(t)) {
      this.stack.pop();
      return true;
    }
    return false;
  }
  keyOf(key: string): string {
    return [...this.stack.filter(Boolean), key].join(" > ");
  }
}

/** One baseline file's removed and added entries, in diff order. */
interface FileDelta {
  file: string;
  removed: Map<string, number | null>;
  added: Map<string, number | null>;
}

/** The raises in one file's delta, moves (renames) excluded. */
function raisesOf(delta: FileDelta): BaselineRaise[] {
  const { file, removed, added } = delta;
  const count = (v: number | null): number => v ?? 1;
  const raised: BaselineRaise[] = [];
  const fresh: Array<{ key: string; to: number | null }> = [];
  for (const [key, to] of added) {
    if (!removed.has(key)) fresh.push({ key, to });
    else {
      const from = removed.get(key) ?? null;
      if (from !== null && to !== null && to > from) raised.push({ file, key, from, to });
    }
  }
  if (fresh.length === 0) return raised;
  const total = (m: Map<string, number | null>): number => [...m.values()].reduce<number>((s, v) => s + count(v), 0);
  // A move: the total did not rise, and each new entry takes a removed-only entry of an equal or higher count.
  if (total(added) <= total(removed)) {
    const pool = [...removed].filter(([key]) => !added.has(key)).map(([, v]) => count(v)).sort((a, b) => a - b);
    const unmatched = fresh.filter(({ to }) => {
      const i = pool.findIndex((c) => c >= count(to));
      if (i < 0) return true;
      pool.splice(i, 1);
      return false;
    });
    if (unmatched.length === 0) return raised;
  }
  return [...raised, ...fresh.map(({ key, to }) => ({ file, key, from: null, to }))];
}

/**
 * Every baseline entry `diff` ADDS or RAISES. A line moved within a file (removed and re-added at the same or a lower
 * count), a rename that keeps the total, and a count that goes down (the ratchet working) are none of them.
 */
export function baselineRaises(diff: string): BaselineRaise[] {
  const raises: BaselineRaise[] = [];
  let delta: FileDelta | null = null;
  let oldSections = new Sections();
  let newSections = new Sections();
  let inHunk = false;

  const flush = (): void => {
    if (delta) raises.push(...raisesOf(delta));
    delta = null;
  };

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ") || line.startsWith("diff --cc ") || line.startsWith("diff --combined ")) {
      flush();
      inHunk = false;
      continue;
    }
    if (!inHunk && line.startsWith("+++ ")) {
      const path = newPathOf(line);
      delta = path && isBaselineFile(path) ? { file: path, removed: new Map(), added: new Map() } : null;
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      // A hunk that starts mid-file cannot see its sections: start both sides over.
      oldSections = new Sections();
      newSections = new Sections();
      continue;
    }
    const current = delta as FileDelta | null;
    if (!current || !inHunk) continue;
    const sign = line[0];
    const body = line.slice(1);
    const json = current.file.endsWith(".json");
    if (json) {
      // Context moves both sides; a `-` line only the old, a `+` line only the new.
      const structural = sign === "-" ? oldSections.step(body) : sign === "+" ? newSections.step(body) : (oldSections.step(body), newSections.step(body));
      if (structural) continue;
    }
    if (sign !== "+" && sign !== "-") continue;
    const entry = entryOf(current.file, body);
    if (!entry) continue;
    const key = json ? (sign === "-" ? oldSections : newSections).keyOf(entry.key) : entry.key;
    (sign === "+" ? current.added : current.removed).set(key, entry.value);
  }
  flush();
  return raises;
}

/** Whether a commit message owns a raise with a reason (`baseline-raise: <reason>`). */
export function ownsBaselineRaise(message: string): boolean {
  return /^\s*baseline-raise:\s*\S/im.test(message);
}

/** The refusal a commit tool returns for unowned raises. */
export function baselineRaiseRefusal(raises: readonly BaselineRaise[]): string {
  const lines = raises.map((r) =>
    r.from === null ? `  + ${r.file}: ${r.key}${r.to !== null ? ` ${r.to}` : ""} (new entry)` : `  ↑ ${r.file}: ${r.key} ${r.from} → ${r.to}`,
  );
  return (
    `Refused: this change ADDS or RAISES ${raises.length} ratchet-baseline entr${raises.length === 1 ? "y" : "ies"} — it grandfathers new debt instead of fixing it:\n` +
    `${lines.join("\n")}\n` +
    "A ratchet baseline may only shrink. Fix the new violations and re-run the guard WITHOUT --update (restore the baseline lines you raised). " +
    `If the raise is genuinely intended, say why in the commit message with a line \`${BASELINE_RAISE_TRAILER} <reason>\`.`
  );
}
