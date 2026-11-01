/**
 * gatePaths — which files a tool call acts on, as a path-scoped governance gate must see them.
 *
 * Two things live here so there is ONE of each:
 *   - the `*** Begin Patch` header parser. `apply_patch` applies a patch with it (`agent-runtime/src/agents/apply-patch.ts`) and
 *     {@link toolCallPaths} reads the files a patch touches with the SAME function, so a header the applier accepts (indented,
 *     with a `Move to`) is a header the gate sees. A second reader would drift and let a patch past a gate;
 *   - the path normalisation a gate matches on (slashes, `./`, `..`, absolute paths), so the spelling of a path cannot step
 *     around a scope.
 *
 * Pure: no `node:*`, so it compiles into the Worker, the browser and Node.
 */

export const PATCH_MARKERS = {
  begin: "*** Begin Patch",
  end: "*** End Patch",
  add: "*** Add File: ",
  delete: "*** Delete File: ",
  update: "*** Update File: ",
  move: "*** Move to: ",
} as const;

export type PatchHeaderKind = "add" | "delete" | "update" | "move";

/** One patch line read as a file header (leading and trailing whitespace ignored), or null when it is not one. */
export function parsePatchHeader(line: string): { kind: PatchHeaderKind; path: string } | null {
  const text = line.trim();
  for (const kind of ["add", "delete", "update", "move"] as const) {
    const marker = PATCH_MARKERS[kind];
    if (text.startsWith(marker)) return { kind, path: text.slice(marker.length) };
  }
  return null;
}

/** Every file a patch adds, updates, deletes or moves to, in order. Empty for anything that is not a patch. */
export function patchHeaderPaths(input: unknown): string[] {
  if (typeof input !== "string" || !input.includes(PATCH_MARKERS.begin)) return [];
  const out: string[] = [];
  for (const line of input.split(/\r?\n/)) {
    const header = parsePatchHeader(line);
    if (header && header.path.trim()) out.push(header.path.trim());
  }
  return out;
}

/**
 * Paths a tool call is acting on, extracted from the common arg shapes (`path`, `filePath`, `oldPath`, `newPath`, `paths[]`, and
 * the file headers of an `apply_patch` `input`). The hook call sites pass into `evaluatePolicyGate` so a path-scoped gate can match
 * without each engine re-implementing extraction.
 */
export function toolCallPaths(args: Record<string, unknown> | undefined): string[] {
  if (!args) return [];
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  };
  add(args.path);
  add(args.filePath);
  // The on-prem native tools' spelling — a path-scoped gate must match it too.
  add(args.file_path);
  add(args.oldPath);
  add(args.newPath);
  if (Array.isArray(args.paths)) {
    for (const p of args.paths) add(p);
  }
  for (const p of patchHeaderPaths(args.input)) add(p);
  return out;
}

/**
 * The spellings of `path` a gate's patterns are matched against. A relative path is resolved (`\` to `/`, `./` dropped, `..`
 * folded); a path that still climbs out (`../x`) or is absolute is matched by every TAIL of its segments too, because this seam
 * cannot know the workspace root: `/home/u/proj/secrets/key.txt` must meet `secrets/**`. That over-matches rather than under-matches,
 * which is the side a governance gate fails on.
 */
export function gatePathCandidates(path: string): string[] {
  const raw = path.trim().replace(/\\/g, "/");
  if (!raw) return [];
  const absolute = raw.startsWith("/") || /^[A-Za-z]:\//.test(raw);
  const segments: string[] = [];
  let climbs = false;
  for (const seg of raw.replace(/^[A-Za-z]:/, "").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") segments.pop();
      else {
        segments.push("..");
        climbs = true;
      }
      continue;
    }
    segments.push(seg);
  }
  const resolved = segments.join("/");
  if (!absolute && !climbs) return [resolved];
  const named = segments.filter((s) => s !== "..");
  const tails = named.map((_, i) => named.slice(i).join("/"));
  return [...new Set([resolved, ...tails])].filter(Boolean);
}
