import * as vscode from "vscode";
import type { DetectionNote } from "@builderforce/app-detect";
import type { KitIssue } from "@builderforce/ide-templates/kits";

/**
 * The packages' coded findings, worded in the editor's language (`vscode.l10n`): a starter
 * kit's issues (`composeKit` → `KitIssue`) and app detection's notes and warnings
 * (`emitManifest` / `detectApp` → `DetectionNote`). One key per code; the packages keep the
 * English sentence as `message` for hosts that do not localize.
 */

const list = (items: readonly string[]): string => items.join(", ");

export function kitIssueText(issue: KitIssue): string {
  const t = vscode.l10n.t;
  switch (issue.code) {
    case "unknown-kit": {
      const p = issue.params;
      return t("Unknown starter kit \"{0}\". Use <frontend>-<backend> or a frontend alone. Named kits: {1}. Frontends: {2}. Backends: {3}.",
        p.kit, list(p.namedKits), list(p.frontends), list(p.backends));
    }
    case "unknown-extra": return t("Unknown extra \"{0}\". Extras: {1}.", issue.params.extra, list(issue.params.extras));
    case "missing-requirement": {
      const kind = issue.params.kind === "frontend" ? t("frontend") : issue.params.kind === "backend" ? t("backend") : t("extra");
      return t("\"{0}\" needs a {1} part in the kit.", issue.params.part, kind);
    }
    case "path-conflict": return t("File \"{0}\" comes from both \"{1}\" and \"{2}\"; kept \"{1}\"'s.", issue.params.key, issue.params.kept, issue.params.dropped);
    case "service-conflict": return t("Service \"{0}\" comes from both \"{1}\" and \"{2}\"; kept \"{1}\"'s.", issue.params.key, issue.params.kept, issue.params.dropped);
    case "resource-conflict": return t("Resource \"{0}\" comes from both \"{1}\" and \"{2}\"; kept \"{1}\"'s.", issue.params.key, issue.params.kept, issue.params.dropped);
    case "unknown-service": return t("\"{0}\" adds to service \"{1}\", which no part in this kit declares.", issue.params.part, issue.params.service);
  }
}

function noteBody(note: DetectionNote): string {
  const t = vscode.l10n.t;
  switch (note.code) {
    case "db-engine-as-postgres": return t("The {0} database is written as a postgres resource: the target picks its host (PGlite in the browser).", note.params.engine);
    case "db-provider-dropped": return t("The database provider \"{0}\" is not part of the manifest: the target picks its host.", note.params.provider);
    case "db-engine-unsupported": return t("The {0} database is not expressible in manifest v1 (postgres only), so no database resource was written.", note.params.engine);
    case "compose-postgres-is-db": return t("The compose service \"{0}\" ({1}) is the database, written as \"db\".", note.params.id, note.params.image);
    case "compose-postgres-no-migration": return t("The compose postgres \"{0}\" has no migration step: run your migrations against it yourself.", note.params.id);
    case "queue-as-native": return t("The queue binding {0} is written as a native queue (\"{1}\"): the browser runtime runs queues on a redis resource.", note.params.binding, note.params.id);
    case "binding-unsupported": return t("The {0} binding {1} is not expressible in manifest v1.", note.params.kind, note.params.binding);
    case "port-moved": return t("Service \"{0}\" also wanted port {1}, so it was given {2}: tell its command ({3}).", note.params.service, note.params.wanted, note.params.port, note.params.command);
    case "cron-no-backend": return t("The cron schedules ({0}) have no backend service to invoke, so no job was written.", note.params.schedules.join("; "));
    case "cron-scheduled-route": return t("Each cron job invokes GET {0} on \"{1}\": a Cloudflare scheduled handler needs a route — `wrangler dev --test-scheduled` serves it; elsewhere the app must.", note.params.path, note.params.service);
    case "vars-unset": return t("Variables with no value are not written: {0}.", list(note.params.names));
    case "service-no-command": return t("Service \"{0}\" has no dev or start command, so it was left out.", note.params.service);
    case "frontend-no-credentials": return t("Frontend \"{0}\" never receives credentials, so it does not use {1}.", note.params.service, list(note.params.resources));
    case "training-as-python": return t("Training service \"{0}\" is written as a python service that is ready once started (manifest v1 has no training type).", note.params.service);
    case "worker-own-command": return t("Worker \"{0}\" runs through its own command ({1}); the browser runtime has no workerd.", note.params.service, note.params.command);
    case "container-needs-docker": return t("Container \"{0}\" needs a docker runtime, which the browser runtime does not have.", note.params.service);
    case "secrets-to-vault": return t("Secrets are never written to the file: set {0} in the vault.", list(note.params.names));
    case "domains-dropped": return t("Domains are not part of manifest v1: {0}.", list(note.params.domains));
    case "ingress-api-backend": return t("Ingress sends {0} to \"{1}\" and everything else to \"{2}\": the backend must serve its routes under {0}; edit the ingress routes if it does not.", note.params.path, note.params.backend, note.params.frontend);
    case "manifest-service-unreadable": return t("service \"{0}\" has no runtime or command and was not read", note.params.service);
    case "manifest-env-differs": return t("env {0} differs between services; the first value is kept", note.params.name);
    case "manifest-runtime-unknown": return t("service \"{0}\" runs on \"{1}\", which the blueprint has no kind for; it is read as node", note.params.service, note.params.runtime);
    case "manifest-readiness-query": return t("service \"{0}\": readiness \"query\" has no blueprint form", note.params.service);
    case "manifest-resource-unmapped": return t("resource \"{0}\" ({1}) has no blueprint field; the runtime reads it from the manifest", note.params.id, note.params.type);
    case "manifest-jobs-unmapped": return t("jobs have no blueprint field; the runtime reads them from the manifest");
    case "manifest-invalid-json": return t("{0} is not valid JSON and was ignored: {1}", note.params.file, note.params.error);
    case "manifest-not-object": return t("{0} is not a JSON object and was ignored", note.params.file);
    case "manifest-unsupported-version": return t("{0} has unsupported version {1} and was ignored", note.params.file, note.params.version);
    case "compose-package-unreadable": return t("{0} could not be read: {1}", note.params.path, note.params.error);
    case "compose-no-services": return t("{0}: no services section could be read", note.params.file);
    case "compose-context-outside": return t("{0} service \"{1}\": its build context is outside the repository and was not read", note.params.file, note.params.service);
    case "compose-no-image": return t("{0} service \"{1}\": no image and no build context", note.params.file, note.params.service);
    case "compose-image-unsupported": return t("{0} service \"{1}\": image \"{2}\" is not supported by the browser runtime", note.params.file, note.params.service, note.params.image);
    case "compose-image-resource": return t("{0} service \"{1}\": image \"{2}\" is a {3} resource, which the blueprint has no field for — the manifest declares it", note.params.file, note.params.service, note.params.image, note.params.type);
    case "detector-failed": return t("detector {0} failed: {1}", note.params.detector, note.params.error);
  }
}

export function detectionNoteText(note: DetectionNote): string {
  const body = noteBody(note);
  return note.source ? vscode.l10n.t("{0}: {1}", note.source, body) : body;
}
