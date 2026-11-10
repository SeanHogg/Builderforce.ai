/**
 * Both sides' TEXT of a run's changed files for ONE repository (PRD 41 §C1), and the change set as the engine reads it.
 *
 * BEFORE, in the C1 order:
 *   1. a file dirty at baseline → its pre-image, by `beforeHash` (`preimageRows.ts`); over a cap it is `preimage-too-large`,
 *      otherwise missing it is `preimage-missing`;
 *   2. a file clean at baseline → `git show <baseCommit>:<path>`. The change-set record carries no `beforeHash` for it (the
 *      baseline only fingerprints dirty files), so {@link SideTexts.inputs} reads it here and stamps the hash; a path git
 *      does not hold at the base commit was created by the run. No git (or no base commit) → `git-unavailable`;
 *   3. a text holding a NUL in its first 8 KiB is `binary` (no text; the engine excludes it).
 * AFTER is the working tree at finalization.
 *
 * Hashes are memory's EOL-normalized `contentHash` (bare hex), the same digest the knowledge store keys extracts by.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ChangedFileInput, SideText, UnresolvedFile } from "@builderforce/run-delta";
import { isBinaryBytes } from "@seanhogg/builderforce-memory/knowledge";
import { nodeContentHash } from "../knowledge/nodeSha256";
import { fingerprintHash, type ChangeSetRepoBaseline } from "../runChangeBaseline";
import type { RepoGit } from "./gitSide";

export interface ChangeSetFileView {
  path: string;
  beforeHash?: string;
  afterHash?: string;
  attribution: ChangedFileInput["attribution"];
  status: string;
}

/** Reads pre-image bytes by content hash. */
export type PreimageReader = (hashes: readonly string[]) => Promise<Map<string, Uint8Array>>;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

function sideText(file: string, bytes: Uint8Array): SideText {
  const hash = nodeContentHash(bytes);
  return isBinaryBytes(bytes) ? { path: file, hash } : { path: file, hash, text: decoder.decode(bytes) };
}

/**
 * The `beforeHash` of a file that existed before the run but whose before side cannot be read. The engine resolves a before
 * side only for a file with a `beforeHash`; this one resolves to its recorded reason ({@link SideTexts.beforeTexts}) and is
 * excluded, so the marker never reaches a rule, a rename match or the digest.
 */
export const UNREADABLE_BEFORE = "unreadable";

/** Statuses that say a file clean at baseline did not exist at the base commit (git would answer the same). */
const CREATED = new Set(["untracked", "added"]);

export class SideTexts {
  /** Before sides already read (git), by path. */
  private readonly before = new Map<string, SideText | UnresolvedFile>();

  constructor(
    private readonly repo: Pick<ChangeSetRepoBaseline, "root" | "baseCommit" | "files" | "preimageTooLarge" | "kind">,
    private readonly git: RepoGit | undefined,
    private readonly preimages: PreimageReader | undefined,
  ) {}

  private dirtyAtBaseline(file: string): boolean {
    return file in this.repo.files;
  }

  /**
   * The change set as the engine's input: hashes bare, and a file clean at baseline given the before hash git holds for it
   * (absent when git says the run created it, `git-unavailable` when git cannot say).
   */
  async inputs(files: readonly ChangeSetFileView[]): Promise<ChangedFileInput[]> {
    const clean = files.filter((f) => !this.dirtyAtBaseline(f.path) && f.beforeHash === undefined);
    const atBase = this.git && this.repo.baseCommit && this.repo.kind !== "folder" && clean.length > 0
      ? await this.git.pathsAt(this.repo.baseCommit, clean.map((f) => f.path))
      : undefined;
    const out: ChangedFileInput[] = [];
    for (const f of files) {
      const beforeHash = this.dirtyBefore(f) ?? fingerprintHash(f.beforeHash) ?? (await this.cleanBefore(f, atBase));
      const afterHash = fingerprintHash(f.afterHash);
      out.push({
        path: f.path,
        ...(beforeHash ? { beforeHash } : {}),
        ...(afterHash ? { afterHash } : {}),
        attribution: f.attribution,
        status: f.status,
      });
    }
    return out;
  }

  /**
   * A file dirty at baseline whose fingerprint is not a content hash (a baseline of another build): its before side exists
   * but cannot be read, so it is `preimage-missing`, never mistaken for a file the run created.
   */
  private dirtyBefore(f: ChangeSetFileView): string | undefined {
    if (!this.dirtyAtBaseline(f.path) || f.beforeHash === undefined || fingerprintHash(f.beforeHash)) return undefined;
    this.before.set(f.path, { path: f.path, reason: "preimage-missing" });
    return UNREADABLE_BEFORE;
  }

  private async cleanBefore(f: ChangeSetFileView, atBase: Set<string> | undefined): Promise<string | undefined> {
    if (this.dirtyAtBaseline(f.path)) return undefined; // dirty and absent at baseline: it did not exist then
    if (this.repo.kind === "folder") return undefined; // a folder's baseline is its whole working set: not in it ⇒ created
    if (atBase === undefined) {
      if (CREATED.has(f.status)) return undefined;
      this.before.set(f.path, { path: f.path, reason: "git-unavailable" });
      return UNREADABLE_BEFORE;
    }
    if (!atBase.has(f.path)) return undefined;
    const text = await this.git!.show(this.repo.baseCommit!, f.path);
    if (text === undefined) {
      this.before.set(f.path, { path: f.path, reason: "git-unavailable" });
      return UNREADABLE_BEFORE;
    }
    const side = sideText(f.path, encoder.encode(text));
    this.before.set(f.path, side);
    return side.hash;
  }

  /** Before texts: git's (read by {@link inputs}), else the pre-image by hash, else why not. */
  async beforeTexts(files: ReadonlyArray<{ path: string; beforeHash?: string }>): Promise<Map<string, SideText | UnresolvedFile>> {
    const out = new Map<string, SideText | UnresolvedFile>();
    const wanted = files.filter((f) => !this.before.has(f.path) && f.beforeHash);
    const bytes = wanted.length > 0 && this.preimages ? await this.preimages(wanted.map((f) => f.beforeHash!)) : new Map<string, Uint8Array>();
    const tooLarge = new Set(this.repo.preimageTooLarge ?? []);
    for (const f of files) {
      const known = this.before.get(f.path);
      if (known) { out.set(f.path, known); continue; }
      const held = f.beforeHash ? bytes.get(f.beforeHash) : undefined;
      if (held) out.set(f.path, sideText(f.path, held));
      else out.set(f.path, { path: f.path, reason: tooLarge.has(f.path) ? "preimage-too-large" : "preimage-missing" });
    }
    return out;
  }

  /** After texts: the working tree now. A file that cannot be read is left out (the engine reports it). */
  async afterTexts(paths: readonly string[]): Promise<Map<string, SideText | UnresolvedFile>> {
    const out = new Map<string, SideText | UnresolvedFile>();
    for (const rel of paths) {
      try {
        out.set(rel, sideText(rel, await fs.readFile(path.join(this.repo.root, rel))));
      } catch {
        // vanished since the change set was taken
      }
    }
    return out;
  }
}
