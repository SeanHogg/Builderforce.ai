/**
 * THE proven text of a run's own files (PRD 41 §D1 line counts, §D6 naturalness): each side of each file the change set
 * attributes to the run, accepted only when it is provably the run's.
 *
 * BEFORE, through {@link SideTexts} (the run delta's own C1 order): a file dirty at baseline is its pre-image by its recorded
 * `beforeHash`; a file clean at baseline is its blob at `baseCommit`; a path git does not hold there was created by the run
 * (`absent`). AFTER is the working tree, accepted only when its content hash is the recorded `afterHash` (a later edit is not
 * the run's); a file the change set records without an after hash was deleted (`absent`).
 *
 * `absent` (the file did not exist on that side) is never confused with `unreadable` (a missing pre-image, no git, a binary,
 * an oversized or a since-edited side): a caller skips or refuses an unreadable file, and treats an absent side as empty.
 * Binary is memory's `isBinaryBytes` rule (inside {@link SideTexts}).
 */

import type { SideText, UnresolvedFile } from "@builderforce/run-delta";
import { fingerprintHash } from "../runChangeBaseline";
import type { LocalChangeSetValue } from "../runChangeSets";
import { isCommitId, repoGit } from "./gitSide";
import { SideTexts, type PreimageReader } from "./sideTexts";

/** One side of one file. */
export type ProvenSide = { state: "text"; text: string } | { state: "absent" } | { state: "unreadable" };

export interface ProvenRunFile {
  /** Root-relative POSIX path. */
  path: string;
  before: ProvenSide;
  after: ProvenSide;
  /** The recorded after hash (bare hex), when the run left the file in place. */
  afterHash?: string;
}

export interface RunTextSources {
  /** The repository root on this device. */
  root: string;
  changeSet: Pick<LocalChangeSetValue, "baseCommit" | "files">;
  /** Pre-images by content hash (files dirty at baseline). Absent: such a file's before side is `unreadable`. */
  preimages?: PreimageReader;
  /** A side larger than this many UTF-8 bytes is `unreadable`. Default: no limit. */
  maxBytes?: number;
}

/** The paths a change set attributes to its run (authored or modified by it), sorted by path. */
export const runFiles = (cs: Pick<LocalChangeSetValue, "files">): LocalChangeSetValue["files"] =>
  cs.files.filter((f) => f.attribution === "run-authored" || f.attribution === "run-modified-existing")
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

const ABSENT: ProvenSide = { state: "absent" };
const UNREADABLE: ProvenSide = { state: "unreadable" };

function sideOf(side: SideText | UnresolvedFile | undefined, maxBytes: number | undefined): ProvenSide {
  if (!side || !("text" in side) || typeof side.text !== "string") return UNREADABLE; // unresolved, or binary
  if (maxBytes !== undefined && Buffer.byteLength(side.text, "utf8") > maxBytes) return UNREADABLE;
  return { state: "text", text: side.text };
}

/** Both proven sides of every file the change set attributes to the run, in path order. */
export async function provenRunTexts(src: RunTextSources): Promise<ProvenRunFile[]> {
  const files = runFiles(src.changeSet);
  if (files.length === 0) return [];
  const baseCommit = isCommitId(src.changeSet.baseCommit) ? src.changeSet.baseCommit : undefined;
  // The baseline as the change set records it: a file it carries a before hash for was dirty at baseline.
  const dirty = Object.fromEntries(files.filter((f) => f.beforeHash !== undefined).map((f) => [f.path, f.beforeHash]));
  const texts = new SideTexts({ root: src.root, files: dirty, ...(baseCommit ? { baseCommit } : {}) }, baseCommit ? repoGit(src.root) : undefined, src.preimages);
  const inputs = await texts.inputs(files);
  const withBefore = inputs.filter((f) => f.beforeHash !== undefined).map((f) => ({ path: f.path, beforeHash: f.beforeHash! }));
  const before = await texts.beforeTexts(withBefore);
  const afterHashes = new Map(files.flatMap((f) => {
    const hash = fingerprintHash(f.afterHash);
    return hash ? [[f.path, hash] as const] : [];
  }));
  const after = await texts.afterTexts([...afterHashes.keys()]);
  return files.map((f) => {
    const hasBefore = withBefore.some((b) => b.path === f.path);
    const want = afterHashes.get(f.path);
    const read = after.get(f.path);
    const afterSide = want === undefined ? ABSENT
      : read && "hash" in read && read.hash === want ? sideOf(read, src.maxBytes)
      : UNREADABLE;
    return {
      path: f.path,
      before: hasBefore ? sideOf(before.get(f.path), src.maxBytes) : ABSENT,
      after: afterSide,
      ...(want !== undefined ? { afterHash: want } : {}),
    };
  });
}

/** A proven side's text: `absent` ⇒ undefined (the empty side), `unreadable` ⇒ null (not the run's, or not readable). */
export const textOf = (side: ProvenSide): string | undefined | null =>
  side.state === "text" ? side.text : side.state === "absent" ? undefined : null;
