import * as vscode from "vscode";
import { BUILD_ID, BUILT_AT, UNSTAMPED_BUILD, formatBuildIdentity } from "./buildInfo";

/**
 * The build identity block at the top of the connection diagnostics.
 *
 * It exists because a support report once could not answer its own question. A run
 * failed with an error whose fix had shipped several versions earlier, and the version
 * in the report — labelled "UI" — was the EXTENSION HOST'S. Nothing said so, nothing
 * named the webview half at all, and nothing recorded which artifact the host was
 * actually running, so "an install older than the version it reports" and "a live hole
 * in the fix" stayed indistinguishable.
 *
 * So this names the half explicitly and prints the source hash beside the version —
 * the field that actually separates two artifacts sharing a version number.
 */
export function buildIdentityReport(ctx: vscode.ExtensionContext): string {
  const version = (ctx.extension.packageJSON as { version?: string }).version ?? "unknown";
  const lines = [`Extension host: ${formatBuildIdentity(version)}`];
  if (BUILD_ID === UNSTAMPED_BUILD) {
    lines.push(
      "  ⚠️ Not a packaged build (build id \"dev\") — this host was loaded from source, so its behaviour may not match any released artifact.",
    );
  } else if (BUILT_AT !== UNSTAMPED_BUILD) {
    // Stated rather than implied: the webview is packaged INSIDE this artifact, so a
    // reader never has to guess whether the two halves could be different ages. The
    // chat diagnostics print the webview's own stamp to prove it.
    lines.push("  The webview bundle ships inside this same artifact; the chat diagnostics print its stamp.");
  }
  return lines.join("\n");
}
