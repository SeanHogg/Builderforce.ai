/**
 * A skill as a FOLDER — SKILL.md plus the files it points at — read from and written
 * to a flat list of `{ path, content }`.
 *
 * Every surface that moves a skill between places goes through these two functions:
 * the web import (a picked folder, a .zip, or a lone SKILL.md), the marketplace
 * publish, the platform export, and the on-prem runtime writing an assigned skill to
 * disk. So "what is a valid skill folder" is answered once — including the parts that
 * are about safety rather than the spec: no path may climb out of the folder, and the
 * size limits hold for a malicious upload exactly as for an honest one.
 */

import { parseFrontmatter, splitSkillMarkdown, type YamlParse } from "./frontmatter.js";
import { serializeSkillMarkdown } from "./serialize.js";
import { SKILL_BINARY_FILE_MAX_BYTES, SKILL_FILE, SKILL_PACKAGE_MAX_BYTES, isBinarySkillPath } from "./spec.js";
import { validateSkillFrontmatter, type SkillIssue, type SkillManifest } from "./validate.js";

/** How a file's `content` is carried: text as-is, or binary bytes as base64. */
export type SkillFileEncoding = "utf8" | "base64";

/**
 * One file of a skill folder. `path` is relative to the folder, POSIX-separated.
 * `encoding` is omitted for text (the common case); a binary asset (an image, a font,
 * a PDF) travels as base64 with `encoding: "base64"`.
 */
export interface SkillFile {
  path: string;
  content: string;
  encoding?: SkillFileEncoding;
}

export interface SkillPackage {
  manifest: SkillManifest;
  /** The SKILL.md body (instructions), without frontmatter. */
  body: string;
  /** Every OTHER file in the folder — scripts/, references/, assets/ — sorted by path. */
  files: SkillFile[];
}

export interface SkillPackageLimits {
  maxFiles: number;
  /** Per TEXT file (UTF-8 bytes). */
  maxFileBytes: number;
  /** Per BINARY file (decoded bytes). */
  maxBinaryFileBytes: number;
  /** The whole folder: text plus decoded binaries. */
  maxTotalBytes: number;
}

/**
 * Text stays small enough to live in a row; binary assets are bounded separately
 * because they are stored as objects, not rows.
 */
export const DEFAULT_SKILL_PACKAGE_LIMITS: SkillPackageLimits = {
  maxFiles: 64,
  maxFileBytes: 256 * 1024,
  maxBinaryFileBytes: SKILL_BINARY_FILE_MAX_BYTES,
  maxTotalBytes: SKILL_PACKAGE_MAX_BYTES,
};

export interface ReadSkillPackageOptions {
  limits?: Partial<SkillPackageLimits>;
  parseYaml?: YamlParse;
  /**
   * The folder name to hold `name` to when the files carry no folder of their own (a
   * lone SKILL.md dropped on an import screen). Omitted ⇒ no folder check.
   */
  directoryName?: string;
}

export interface ReadSkillPackageResult {
  package: SkillPackage | null;
  issues: SkillIssue[];
}

const utf8Length = (s: string): number => new TextEncoder().encode(s).length;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Decoded byte length of a base64 string, or -1 when it is not base64. */
export function base64ByteLength(b64: string): number {
  const clean = b64.replace(/\s+/g, "");
  if (clean.length % 4 !== 0 || !BASE64.test(clean)) return -1;
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return (clean.length / 4) * 3 - pad;
}

/** Bytes a file occupies once decoded: what the limits are measured in. */
export function skillFileByteLength(f: SkillFile): number {
  return f.encoding === "base64" ? Math.max(0, base64ByteLength(f.content)) : utf8Length(f.content);
}

const withPath = (path: string, f: SkillFile): SkillFile =>
  f.encoding === "base64" ? { path, content: f.content, encoding: "base64" } : { path, content: f.content };

/**
 * Normalise a relative path, or null when it is not one a skill folder may contain:
 * absolute, drive-lettered, climbing with `..`, or naming a dotfile/VCS directory.
 */
export function normalizeSkillPath(raw: string): string | null {
  const parts = raw.replace(/\\/g, "/").split("/").filter((p) => p !== "" && p !== ".");
  if (parts.length === 0) return null;
  if (/^[A-Za-z]:$/.test(parts[0]!) || raw.startsWith("/")) return null;
  for (const p of parts) {
    if (p === ".." || p.startsWith(".") || p === "node_modules" || p === "__MACOSX") return null;
  }
  return parts.join("/");
}

/**
 * Read a skill folder from a flat file list.
 *
 * The SKILL.md may sit at the root of the list or inside exactly one top-level folder
 * (what a zipped skill folder or a picked directory produces); in the second case
 * that folder is stripped from every path and becomes the directory `name` must match.
 */
export function readSkillPackage(input: readonly SkillFile[], options: ReadSkillPackageOptions = {}): ReadSkillPackageResult {
  const limits = { ...DEFAULT_SKILL_PACKAGE_LIMITS, ...options.limits };
  const issues: SkillIssue[] = [];
  const fail = (field: string, code: string, message: string): ReadSkillPackageResult => ({
    package: null,
    issues: [...issues, { severity: "error", field, code, message }],
  });

  const files: SkillFile[] = [];
  for (const f of input) {
    const path = normalizeSkillPath(f.path);
    if (!path) {
      issues.push({ severity: "warning", field: f.path, code: "path_skipped", message: `Skipped "${f.path}": hidden, outside the folder, or not a relative path.` });
      continue;
    }
    files.push(withPath(path, f));
  }

  // Locate SKILL.md: at the root, or under a single top-level folder.
  let root = "";
  if (!files.some((f) => f.path === SKILL_FILE)) {
    const nested = files.filter((f) => f.path.split("/").length === 2 && f.path.endsWith(`/${SKILL_FILE}`));
    if (nested.length === 0) return fail(SKILL_FILE, "skill_md_missing", "No SKILL.md found. A skill is a folder whose SKILL.md sits at its top level.");
    if (nested.length > 1) return fail(SKILL_FILE, "skill_md_ambiguous", "Several SKILL.md files found. Import one skill folder at a time.");
    root = nested[0]!.path.slice(0, -(SKILL_FILE.length + 1));
  }
  const scoped = root
    ? files.filter((f) => f.path.startsWith(`${root}/`)).map((f) => withPath(f.path.slice(root.length + 1), f))
    : files;
  const outside = root ? files.length - scoped.length : 0;
  if (outside > 0) {
    issues.push({ severity: "warning", field: root, code: "files_outside_skipped", message: `${outside} file(s) outside the "${root}" folder were not imported.` });
  }

  const skillMd = scoped.find((f) => f.path === SKILL_FILE)!;
  // A NUL byte marks a binary file read as text: its bytes are already lost, and no
  // store keeps it intact (Postgres text rejects \u0000 outright). SKILL.md must be text.
  if (skillMd.encoding === "base64" || skillMd.content.includes("\u0000")) {
    return fail(SKILL_FILE, "binary_file", "SKILL.md contains binary data; it must be a text file.");
  }
  const others = scoped
    .filter((f) => {
      if (f.path === SKILL_FILE) return false;
      if (f.encoding === "base64") {
        if (base64ByteLength(f.content) >= 0) return true;
        issues.push({ severity: "warning", field: f.path, code: "binary_invalid", message: `Skipped "${f.path}": its binary content is not valid base64.` });
        return false;
      }
      // A binary extension sent as text was decoded as UTF-8 on the way here, so its
      // bytes are already mangled even when no NUL survived; keep only real text.
      if (!f.content.includes("\u0000") && !isBinarySkillPath(f.path)) return true;
      issues.push({ severity: "warning", field: f.path, code: "binary_file", message: `Skipped "${f.path}": it was read as text but holds binary data. Send binary files as base64.` });
      return false;
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  if (others.length + 1 > limits.maxFiles) {
    return fail(SKILL_FILE, "too_many_files", `The folder has ${others.length + 1} files; the limit is ${limits.maxFiles}.`);
  }
  let total = 0;
  for (const f of [skillMd, ...others]) {
    const size = skillFileByteLength(f);
    const max = f.encoding === "base64" ? limits.maxBinaryFileBytes : limits.maxFileBytes;
    if (size > max) {
      return fail(f.path, "file_too_large", `"${f.path}" is ${Math.ceil(size / 1024)} KB; the limit per file of this kind is ${Math.floor(max / 1024)} KB.`);
    }
    total += size;
  }
  if (total > limits.maxTotalBytes) {
    return fail(SKILL_FILE, "package_too_large", `The folder is ${Math.ceil(total / 1024)} KB; the limit is ${Math.floor(limits.maxTotalBytes / 1024)} KB.`);
  }

  const split = splitSkillMarkdown(skillMd.content);
  if (split.frontmatter === null) {
    return fail(SKILL_FILE, "frontmatter_missing", "SKILL.md must open with YAML frontmatter between `---` lines, declaring at least `name` and `description`.");
  }
  const frontmatter = parseFrontmatter(split.frontmatter, options.parseYaml);
  const directoryName = root ? root.split("/").pop() : options.directoryName;
  const validation = validateSkillFrontmatter(frontmatter, directoryName !== undefined ? { directoryName } : {});
  issues.push(...validation.issues);
  if (!validation.manifest) return { package: null, issues };
  if (!split.body.trim()) {
    issues.push({ severity: "warning", field: SKILL_FILE, code: "body_empty", message: "SKILL.md has no instructions after its frontmatter." });
  }
  return { package: { manifest: validation.manifest, body: split.body, files: others }, issues };
}

/** Parse ONE SKILL.md text (no folder) — what an agent or a form authors. */
export function readSkillMarkdown(text: string, options: Omit<ReadSkillPackageOptions, "limits"> = {}): ReadSkillPackageResult {
  return readSkillPackage([{ path: SKILL_FILE, content: text }], options);
}

/**
 * The folder for a package, SKILL.md first. Paths are relative to the skill folder;
 * pass `{ folder: true }` to prefix them with `<name>/`, which is what a .zip of a
 * skill (and every agent's skills directory) expects.
 */
export function writeSkillPackage(pkg: SkillPackage, options: { folder?: boolean } = {}): SkillFile[] {
  const prefix = options.folder ? `${pkg.manifest.name}/` : "";
  return [
    { path: `${prefix}${SKILL_FILE}`, content: serializeSkillMarkdown(pkg.manifest, pkg.body) },
    ...pkg.files.map((f) => withPath(`${prefix}${f.path}`, f)),
  ];
}
