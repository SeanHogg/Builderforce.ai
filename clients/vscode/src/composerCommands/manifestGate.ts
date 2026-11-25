/**
 * The write gate for an app manifest: the runtime's own parser decides, never a second check here.
 * A manifest with errors would fail the launcher and the browser run target, so neither the editor's
 * `write_file` nor a `git_commit` lets one through; every error is named so one fix pass is enough.
 */
import { describeManifestIssue, manifestHasErrors, parseManifest } from "@seanhogg/builderforce-webcontainers-core/manifest";
import { MANIFEST_READ_ORDER } from "./manifestLocation";

/** A refusal naming every issue, or null when `text` is a manifest the runtime accepts (a legacy file is the host's to read). */
export function manifestRefusal(relative: string, text: string): string | null {
  const { issues } = parseManifest(text);
  if (!manifestHasErrors(issues)) return null;
  const errors = issues.filter((issue) => issue.severity === "error").map((issue) => `- ${describeManifestIssue(issue)}`);
  return `Refused: ${relative} is not a valid app manifest:\n${errors.join("\n")}`;
}

/** Whether a repo-relative POSIX path is a manifest file (the canonical path or a legacy root file, in any folder). */
export function isManifestPath(repoRelative: string): boolean {
  const normalized = repoRelative.replace(/\\/g, "/");
  return MANIFEST_READ_ORDER.some((entry) => normalized === entry || normalized.endsWith(`/${entry}`));
}
