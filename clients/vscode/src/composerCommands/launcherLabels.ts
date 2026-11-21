/**
 * Every string the launcher PAGE shows (the runtime's `LauncherLabels`), in the person's VS Code
 * language — passed to `createLocalLauncher({ labels })`, which serves them in `launch.json`.
 *
 * The page fills `{name}` placeholders itself (`formatLabel`), so each one is handed to
 * `vscode.l10n.t` as a named argument that maps to itself: it survives translation untouched.
 *
 * Typed as the installed runtime's full `LauncherLabels`, so a key a runtime bump adds fails to
 * compile here until it is localized.
 */
import * as vscode from "vscode";
import type { LauncherLabels } from "@seanhogg/builderforce-webcontainers/launcher/server";

/** `t` for a page template: each `{name}` placeholder is passed as itself, so the page still fills it. */
function template(message: string, ...names: string[]): string {
  return vscode.l10n.t(message, Object.fromEntries(names.map((name) => [name, `{${name}}`])));
}

export function launcherPageLabels(): LauncherLabels {
  const t = vscode.l10n.t;
  return {
    title: t("Builderforce launcher"),
    loading: t("Loading the project…"),
    loadingFiles: t("Reading the project files…"),
    bootingRuntime: t("Starting the in-browser runtime…"),
    startingServices: t("Starting services…"),
    running: t("Running"),
    notStarted: t("Not started"),
    startFailed: template("Could not start: {message}", "message"),
    environment: t("Environment"),
    target: t("Target"),
    tierProduction: t("Production"),
    tierNonProduction: t("Non-production"),
    services: t("Services"),
    noServices: t("No services."),
    servicesFilter: t("Show services"),
    servicesFilterRunning: t("Running"),
    servicesFilterAll: template("All ({count})", "count"),
    servicesHidden: template("{count} hidden: finished setup steps or stopped services.", "count"),
    servicesShowAll: t("Show all"),
    noRunningServices: t("No service is running."),
    previewAction: t("Preview"),
    previewing: t("In preview"),
    previewService: template("Show {service} in the preview", "service"),
    previewSelectionLost: template("{service} is no longer serving, so the preview went back to the default service.", "service"),
    previewSelectionWaiting: template("{service} is not serving right now; the preview returns to it when it is.", "service"),
    port: template("Port {port}", "port"),
    restarts: template("Restarts: {count}", "count"),
    restart: t("Restart"),
    showLogs: t("Logs"),
    logs: t("Logs"),
    logsAll: t("All services"),
    logsDropped: template("{count} earlier lines dropped", "count"),
    noLogs: t("No output yet."),
    copyDiagnostics: t("Copy diagnostics"),
    copyDiagnosticsDone: t("Copied"),
    copyDiagnosticsFailed: t("Copy failed"),
    preview: t("Preview"),
    openInNewTab: t("Open in new tab"),
    noPreview: t("No service serves a page yet."),
    previewStarting: t("Starting the preview…"),
    previewNotRunning: t("This preview is not running. Keep the launcher tab open, or start the project again with bfwc-launch."),
    previewInvalid: t("That address is not a preview of this launcher."),
    problems: t("Issues and declines"),
    noProblems: t("No issues."),
    declined: t("Declined"),
    severityError: t("Error"),
    severityWarning: t("Warning"),
    severityInfo: t("Info"),
    noManifest: t("This project has no builderforce.json. Run /manifest init to create one."),
    legacyManifest: t("This builderforce.json is an older format; run /manifest init."),
    legacyManifestLocation: template(
      "The manifest at {path} is in the old location. Move it to .builderforce/builderforce.json (/manifest move); the root file is still read for now, never written.",
      "path",
    ),
    manifestOutsideProject: template("The manifest at {path} resolves outside the project (a link), so it was not read.", "path"),
    manifestUnreadable: template("The manifest at {path} could not be read: {reason}", "path", "reason"),
    invalidManifest: t("builderforce.json has errors, so nothing was started."),
    declinedServices: t("Some services cannot run in the browser, so nothing was started."),
    dotnetDeclined: template("The .NET runtime bundle is not available: {reason}", "reason"),
    skippedFile: template("Not loaded (over a size cap, or outside the project): {path}", "path"),
    liveSyncStopped: template("Live sync stopped: {message}", "message"),
    missingToken: t("This launch link has no token. Open the exact link the launcher printed."),
    insecureLauncher: t("This launcher serves plain http, and the runtime runs applications only on https preview origins. Start the launcher with https (the default)."),
    originsUnreachable: template(
      "The preview origin {origin} could not be reached ({detail}). Trust the launcher’s local CA (bfwc-launch --trust prints the step) and use Chromium or Firefox: Safari may not resolve *.localhost names.",
      "origin",
      "detail",
    ),
  };
}
