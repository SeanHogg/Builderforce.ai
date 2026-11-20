/**
 * Detection notes as data (PRD 31 §W11): every warning detection reports and every note
 * `emitManifest` / `manifestToBlueprintOverrides` writes is a typed code + params, with
 * its English sentence as `message` — the default for hosts that do not localize (the
 * API stores `metadata.warnings` as those strings). Hosts that localize (the VS Code
 * extension's `/manifest init`) word each note from `code` + `params`.
 *
 * The English templates live HERE, once; producers call `detectionNote(code, params)`.
 */

/** What each note code says, as data. Lists stay arrays: the host joins them in its own language. */
export interface DetectionNoteParams {
  // emitManifest
  'db-engine-as-postgres': { engine: string };
  'db-provider-dropped': { provider: string };
  'db-engine-unsupported': { engine: string };
  'compose-postgres-is-db': { id: string; image: string };
  'compose-postgres-no-migration': { id: string };
  'queue-as-native': { binding: string; id: string };
  'binding-unsupported': { kind: string; binding: string };
  'port-moved': { service: string; wanted: number; port: number; command: string };
  'cron-no-backend': { schedules: readonly string[] };
  'cron-scheduled-route': { service: string; path: string };
  'vars-unset': { names: readonly string[] };
  'service-no-command': { service: string };
  'frontend-no-credentials': { service: string; resources: readonly string[] };
  'training-as-python': { service: string };
  'worker-own-command': { service: string; command: string };
  'container-needs-docker': { service: string };
  'secrets-to-vault': { names: readonly string[] };
  'domains-dropped': { domains: readonly string[] };
  'ingress-api-backend': { frontend: string; backend: string; path: string };
  'ingress-not-inferred': { frontend: string; backend: string; path: string };
  'ingress-proxy-rewrites': { frontend: string; backend: string; path: string; file: string };
  // manifestToBlueprintOverrides (reading a builderforce.json v1)
  'manifest-service-unreadable': { service: string };
  'manifest-env-differs': { name: string };
  'manifest-runtime-unknown': { service: string; runtime: string };
  'manifest-readiness-query': { service: string };
  'manifest-resource-unmapped': { id: string; type: string };
  'manifest-jobs-unmapped': Record<string, never>;
  'manifest-ingress-unmapped': Record<string, never>;
  // builderforce.json detector
  'manifest-invalid-json': { file: string; error: string };
  'manifest-not-object': { file: string };
  'manifest-unsupported-version': { file: string; version: string };
  // docker-compose detector
  'compose-package-unreadable': { path: string; error: string };
  'compose-no-services': { file: string };
  'compose-context-outside': { file: string; service: string };
  'compose-no-image': { file: string; service: string };
  'compose-image-unsupported': { file: string; service: string; image: string };
  'compose-image-resource': { file: string; service: string; image: string; type: string };
  // the pipeline
  'detector-failed': { detector: string; error: string };
}

export type DetectionNoteCode = keyof DetectionNoteParams;

/** One note: code + params, the English sentence, and the file it was read from (when one prefixes it). */
export type DetectionNote = {
  [C in DetectionNoteCode]: {
    code: C;
    params: DetectionNoteParams[C];
    /** English; hosts that localize word it from `code` + `params` (and `source`) instead. */
    message: string;
    /** The file the note is about, prefixed to `message` (`builderforce.json: …`). */
    source?: string;
  };
}[DetectionNoteCode];

const list = (items: readonly string[]): string => items.join(', ');

const ENGLISH: { [C in DetectionNoteCode]: (p: DetectionNoteParams[C]) => string } = {
  'db-engine-as-postgres': (p) => `The ${p.engine} database is written as a postgres resource: the target picks its host (PGlite in the browser).`,
  'db-provider-dropped': (p) => `The database provider "${p.provider}" is not part of the manifest: the target picks its host.`,
  'db-engine-unsupported': (p) => `The ${p.engine} database is not expressible in manifest v1 (postgres only), so no database resource was written.`,
  'compose-postgres-is-db': (p) => `The compose service "${p.id}" (${p.image}) is the database, written as "db".`,
  'compose-postgres-no-migration': (p) => `The compose postgres "${p.id}" has no migration step: run your migrations against it yourself.`,
  'queue-as-native': (p) => `The queue binding ${p.binding} is written as a native queue ("${p.id}"): the browser runtime runs queues on a redis resource.`,
  'binding-unsupported': (p) => `The ${p.kind} binding ${p.binding} is not expressible in manifest v1.`,
  'port-moved': (p) => `Service "${p.service}" also wanted port ${p.wanted}, so it was given ${p.port}: tell its command (${p.command}).`,
  'cron-no-backend': (p) => `The cron schedules (${p.schedules.join('; ')}) have no backend service to invoke, so no job was written.`,
  'cron-scheduled-route': (p) =>
    `Each cron job invokes GET ${p.path} on "${p.service}": a Cloudflare scheduled handler needs a route — \`wrangler dev --test-scheduled\` serves it; elsewhere the app must.`,
  'vars-unset': (p) => `Variables with no value are not written: ${list(p.names)}.`,
  'service-no-command': (p) => `Service "${p.service}" has no dev or start command, so it was left out.`,
  'frontend-no-credentials': (p) => `Frontend "${p.service}" never receives credentials, so it does not use ${list(p.resources)}.`,
  'training-as-python': (p) => `Training service "${p.service}" is written as a python service that is ready once started (manifest v1 has no training type).`,
  'worker-own-command': (p) => `Worker "${p.service}" runs through its own command (${p.command}); the browser runtime has no workerd.`,
  'container-needs-docker': (p) => `Container "${p.service}" needs a docker runtime, which the browser runtime does not have.`,
  'secrets-to-vault': (p) => `Secrets are never written to the file: set ${list(p.names)} in the vault.`,
  'domains-dropped': (p) => `Domains are not part of manifest v1: ${list(p.domains)}.`,
  'ingress-api-backend': (p) =>
    `Ingress sends ${p.path} to "${p.backend}" and everything else to "${p.frontend}": the backend must serve its routes under ${p.path}; edit the ingress routes if it does not.`,
  'ingress-not-inferred': (p) =>
    `No ingress was written: nothing shows that "${p.backend}" serves its routes under ${p.path} or that "${p.frontend}"'s dev server forwards ${p.path} to it unchanged. If "${p.frontend}" calls "${p.backend}" by a relative path, add an ingress route for it.`,
  'ingress-proxy-rewrites': (p) =>
    `No ingress was written: ${p.file} forwards ${p.path} to the backend with the path rewritten, and the runtime's ingress passes the path through unchanged. If "${p.frontend}" calls "${p.backend}" by a relative path, add an ingress route the backend serves as written.`,
  'manifest-service-unreadable': (p) => `service "${p.service}" has no runtime or command and was not read`,
  'manifest-env-differs': (p) => `env ${p.name} differs between services; the first value is kept`,
  'manifest-runtime-unknown': (p) => `service "${p.service}" runs on "${p.runtime}", which the blueprint has no kind for; it is read as node`,
  'manifest-readiness-query': (p) => `service "${p.service}": readiness "query" has no blueprint form`,
  'manifest-resource-unmapped': (p) => `resource "${p.id}" (${p.type}) has no blueprint field; the runtime reads it from the manifest`,
  'manifest-jobs-unmapped': () => 'jobs have no blueprint field; the runtime reads them from the manifest',
  'manifest-ingress-unmapped': () => 'ingress has no blueprint field; the runtime reads it from the manifest',
  'manifest-invalid-json': (p) => `${p.file} is not valid JSON and was ignored: ${p.error}`,
  'manifest-not-object': (p) => `${p.file} is not a JSON object and was ignored`,
  'manifest-unsupported-version': (p) => `${p.file} has unsupported version ${p.version} and was ignored`,
  'compose-package-unreadable': (p) => `${p.path} could not be read: ${p.error}`,
  'compose-no-services': (p) => `${p.file}: no services section could be read`,
  'compose-context-outside': (p) => `${p.file} service "${p.service}": its build context is outside the repository and was not read`,
  'compose-no-image': (p) => `${p.file} service "${p.service}": no image and no build context`,
  'compose-image-unsupported': (p) => `${p.file} service "${p.service}": image "${p.image}" is not supported by the browser runtime`,
  'compose-image-resource': (p) =>
    `${p.file} service "${p.service}": image "${p.image}" is a ${p.type} resource, which the blueprint has no field for — the manifest declares it`,
  'detector-failed': (p) => `detector ${p.detector} failed: ${p.error}`,
};

/** A note: its code, params and English sentence. */
export function detectionNote<C extends DetectionNoteCode>(code: C, params: DetectionNoteParams[C]): DetectionNote {
  return { code, params, message: ENGLISH[code](params) } as DetectionNote;
}

/** The same note, read from `source`: the English sentence gains the `source: ` prefix. */
export function noteFrom(source: string, note: DetectionNote): DetectionNote {
  return { ...note, source, message: `${source}: ${note.message}` };
}

/** An error as the text a note carries. */
export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A detector's warnings as its findings carry them: coded, and absent when there are none. */
export function warningFindings(notes: readonly DetectionNote[]): { warnings?: DetectionNote[] } {
  return notes.length > 0 ? { warnings: [...notes] } : {};
}

/**
 * The English sentences of `notes`, same order — derived at the edge, for a host that
 * stores or shows text (the API's `metadata.warnings`). Coded notes are the only stored form.
 */
export function noteMessages(notes: readonly DetectionNote[]): string[] {
  return notes.map((note) => note.message);
}
