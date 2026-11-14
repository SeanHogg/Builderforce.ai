/**
 * Design-only change-set detection: whether a run's committed files are ALL design artefacts (PRD 41 §12.5
 * exemption). A design artefact is a high-fidelity mockup / design deliverable, not code: a file under the
 * top-level `.design/` directory, or any `*.dc.html` (design-canonical HTML) file. Such a run is told not to
 * change code, so its run delta can carry no blocking code rules — holding it at the finalize gate (fail-closed
 * `run_delta_unmeasured`) is a false hold. The delta still computes and posts its card; only the HOLD is skipped.
 *
 * Fail-closed: an EMPTY file list, or a set whose record is missing, is NOT design-only (a run that changed
 * nothing real must not slip the gate). A MIXED change set (a design file plus a real source file) is not
 * design-only either — the source change is what the gate exists for.
 */

/** A committed change-set file as the record carries it (repo-relative POSIX path). */
export interface DesignCandidateFile {
  path: string;
}

/** `.design/` is a literal top-level design directory (repo-relative POSIX). */
const DESIGN_DIR = ".design/";

/**
 * True when `path` is a design artefact: under the top-level `.design/` directory, or a `*.dc.html`
 * (design-canonical HTML) file. The `.dc.html` suffix match is case-insensitive; the `.design/` directory is
 * a literal, case-sensitive top-level segment.
 */
export function isDesignArtefact(path: string): boolean {
  return path.startsWith(DESIGN_DIR) || path.toLowerCase().endsWith(".dc.html");
}

/**
 * True only when there is at least one file AND every file is a design artefact. An empty list is NOT
 * design-only (there is nothing to exempt); a mixed list is not (the non-design change is what the gate is for).
 */
export function isDesignOnlyChangeSet(files: ReadonlyArray<DesignCandidateFile>): boolean {
  return files.length > 0 && files.every((f) => isDesignArtefact(f.path));
}
