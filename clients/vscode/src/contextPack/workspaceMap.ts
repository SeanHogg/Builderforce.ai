/**
 * The WORKSPACE MAP the context pack carries: every package root in the open folder, the
 * scripts it has among the ones a run asks for (type-check, test, build, lint), and the
 * lockfile root that owns it — so "run type-check for api" or "fix the lockfile for
 * extensions/a2a" needs no discovery call.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * Chat #60338: to fix a pnpm lockfile error the model ran `pnpm install` in a folder with
 * no package.json, listed files twice, then guessed the owning workspace — four turns for
 * a fact the tree states outright. The scan's project map names manifest directories but
 * not which lockfile owns them, nor which scripts they have.
 *
 * Ownership: a package belongs to the NEAREST folder at or above it that holds a lockfile,
 * a `pnpm-workspace.yaml` or a `package.json` `workspaces` field — the folder its install
 * runs from. A folder with none of those above it is listed as having no lockfile root.
 *
 * Pure: package folders in, text out. The walk and its cache are `workspaceMapScan.ts`.
 */

/** The map's budget in the pack — a table, not a tree. */
export const WORKSPACE_MAP_CHAR_CAP = 1_500;

/** The scripts the map names, in the order it names them. */
export const MAP_SCRIPTS: readonly string[] = ["type-check", "typecheck", "test", "build", "lint"];

/** Lockfile name → the package manager whose install writes it. */
export const LOCKFILE_MANAGERS: Readonly<Record<string, string>> = {
  "pnpm-lock.yaml": "pnpm",
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "yarn.lock": "yarn",
  "bun.lock": "bun",
  "bun.lockb": "bun",
};

export const PNPM_WORKSPACE_FILE = "pnpm-workspace.yaml";

/** One folder the walk found holding a `package.json`, a lockfile or a pnpm workspace file. */
export interface PackageDir {
  /** Workspace-relative, `/`-separated; '' is the workspace root. */
  path: string;
  hasManifest: boolean;
  /** `package.json` `name`, when it declares one. */
  name?: string;
  /** The {@link MAP_SCRIPTS} its `package.json` defines, in that order. */
  scripts: string[];
  /** Lockfile names present in the folder. */
  lockfiles: string[];
  /** `pnpm-workspace.yaml` present. */
  pnpmWorkspace: boolean;
  /** `package.json` declares `workspaces`. */
  declaresWorkspaces: boolean;
}

interface Group {
  /** The lockfile root's path, or undefined for the packages no root owns. */
  root?: PackageDir;
  members: PackageDir[];
}

/** The scripts a `package.json` text defines among {@link MAP_SCRIPTS}, plus its name and workspaces flag. */
export function readPackageJson(text: string): Pick<PackageDir, "name" | "scripts" | "declaresWorkspaces"> {
  try {
    const pkg = JSON.parse(text) as { name?: unknown; scripts?: unknown; workspaces?: unknown };
    const scripts = pkg.scripts && typeof pkg.scripts === "object" ? (pkg.scripts as Record<string, unknown>) : {};
    return {
      ...(typeof pkg.name === "string" && pkg.name.trim() ? { name: pkg.name.trim() } : {}),
      scripts: MAP_SCRIPTS.filter((s) => typeof scripts[s] === "string"),
      declaresWorkspaces: pkg.workspaces != null,
    };
  } catch {
    return { scripts: [], declaresWorkspaces: false };
  }
}

function isRoot(d: PackageDir): boolean {
  return d.lockfiles.length > 0 || d.pnpmWorkspace || d.declaresWorkspaces;
}

function within(child: string, parent: string): boolean {
  return parent === "" || child === parent || child.startsWith(`${parent}/`);
}

const depth = (p: string): number => (p === "" ? 0 : p.split("/").length);
const byDepthThenPath = (a: PackageDir, b: PackageDir): number => depth(a.path) - depth(b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** Every package folder grouped under the lockfile root that owns it (nearest at or above). */
export function groupByLockfileRoot(dirs: readonly PackageDir[]): Group[] {
  const roots = dirs.filter(isRoot).sort((a, b) => depth(b.path) - depth(a.path));
  const groups = new Map<string, Group>(roots.map((r) => [r.path, { root: r, members: [] }]));
  const orphans: Group = { members: [] };
  for (const d of dirs) {
    if (!d.hasManifest) continue;
    const owner = roots.find((r) => within(d.path, r.path));
    (owner ? groups.get(owner.path)! : orphans).members.push(d);
  }
  const out = [...groups.values()].sort((a, b) => byDepthThenPath(a.root!, b.root!));
  for (const g of out) g.members.sort(byDepthThenPath);
  if (orphans.members.length) out.push({ members: orphans.members.sort(byDepthThenPath) });
  return out;
}

function managerOf(root: PackageDir): string | undefined {
  for (const l of root.lockfiles) if (LOCKFILE_MANAGERS[l]) return LOCKFILE_MANAGERS[l];
  return root.pnpmWorkspace ? "pnpm" : undefined;
}

function rootHeading(root: PackageDir): string {
  const markers = [...(root.pnpmWorkspace ? [PNPM_WORKSPACE_FILE] : []), ...(root.declaresWorkspaces ? ["package.json workspaces"] : []), ...root.lockfiles];
  const manager = managerOf(root);
  const command = manager ? `\`${manager} install\`` : "the install";
  return `#### ${root.path || "(workspace root)"} — ${markers.join(" + ")} — run ${command} HERE`;
}

function baseName(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

function memberLine(d: PackageDir, relativeTo: string | undefined): string {
  const rel = relativeTo === undefined ? d.path || "." : d.path === relativeTo ? "." : d.path.slice(relativeTo === "" ? 0 : relativeTo.length + 1);
  const name = d.name && d.name !== baseName(d.path) ? ` "${d.name}"` : "";
  const scripts = d.scripts.length ? ` [${d.scripts.join(" ")}]` : "";
  return `- ${rel}${name}${scripts}`;
}

/** `+12 more (extensions/*, packages/*)` — what an elided run of leaf packages was. */
function elidedLine(elided: PackageDir[], relativeTo: string | undefined): string {
  const parents = [...new Set(elided.map((d) => {
    const rel = relativeTo ? d.path.slice(relativeTo.length + 1) : d.path;
    const cut = rel.lastIndexOf("/");
    return cut < 0 ? "*" : `${rel.slice(0, cut)}/*`;
  }))];
  const shown = parents.slice(0, 3).join(", ") + (parents.length > 3 ? ", …" : "");
  return `- … +${elided.length} more package(s) (${shown})`;
}

function groupLines(g: Group, leafLimit: number): string[] {
  const base = g.root?.path;
  const lines = [g.root ? rootHeading(g.root) : "#### No lockfile root above these — install inside the package itself"];
  const own = g.members.filter((m) => m.path === base);
  const leaves = g.members.filter((m) => m.path !== base);
  const kept = leaves.slice(0, leafLimit);
  for (const m of [...own, ...kept]) lines.push(memberLine(m, base));
  if (leaves.length > kept.length) lines.push(elidedLine(leaves.slice(kept.length), base));
  return lines;
}

const HEADER = [
  "### Workspace map (package folders, their scripts, and the lockfile root that owns each — no list_files needed to find them)",
  "Run installs and lockfile fixes from the root marked HERE, never from a folder without a package.json. [scripts] lists type-check/test/build/lint where defined.",
].join("\n");

/** Leaf packages kept per group, tried in order until the map fits its cap. */
const LEAF_LIMITS = [Number.POSITIVE_INFINITY, 12, 6, 3, 1, 0];

/** The map as one capped block; '' when the folder holds no package. */
export function renderWorkspaceMap(dirs: readonly PackageDir[], cap: number = WORKSPACE_MAP_CHAR_CAP): string {
  const groups = groupByLockfileRoot(dirs).filter((g) => g.members.length > 0 || g.root);
  if (groups.length === 0) return "";
  for (const limit of LEAF_LIMITS) {
    const text = [HEADER, ...groups.flatMap((g) => groupLines(g, limit))].join("\n");
    if (text.length <= cap) return text;
  }
  // Too many roots for even their headings: keep the shallowest that fit, count the rest.
  const lines = [HEADER];
  let shown = 0;
  for (const g of groups) {
    const next = groupLines(g, 0);
    const tail = `… +${groups.length - shown - 1} more lockfile root(s)`;
    if ([...lines, ...next, tail].join("\n").length > cap) break;
    lines.push(...next);
    shown++;
  }
  if (shown < groups.length) lines.push(`… +${groups.length - shown} more lockfile root(s)`);
  return lines.join("\n").slice(0, cap);
}
