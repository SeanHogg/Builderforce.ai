/**
 * The editor's PreFetch port WITH its editor-only parts — the ONE construction both
 * surfaces use (the panel's run host, `runSetupPorts.ts`; the native participant,
 * `chatParticipant.ts`): the open workspace files as the focus, the language servers'
 * diagnostics for `diag.typecheck`, the local-model settings for tier 3, and the starter
 * scaffolds (`@builderforce/ide-templates`) for `scaffold.template`.
 */

import { TEMPLATES } from "@builderforce/ide-templates";
import { getLocalModelsConfig } from "../gateway";
import { lspDiagnostics, openWorkspaceFiles } from "./lspDiagnostics";
import { createVscodePrefetchPort, type CalibrationMemento } from "./vscodePrefetchPort";
import { defineRegistry, type PrefetchPort } from "@builderforce/prefetch";
import { withKnowledgeRows, type KnowledgeRowsHost } from "@builderforce/agent-tools/prefetch";

export function editorPrefetchPort(
  root: () => string,
  state: CalibrationMemento,
  opts: { ownWords?: string; knowledge?: KnowledgeRowsHost } = {},
): PrefetchPort {
  const port = createVscodePrefetchPort({
    root,
    state,
    localModels: getLocalModelsConfig,
    focusFiles: () => openWorkspaceFiles(root()),
    diagnostics: lspDiagnostics,
    templates: TEMPLATES,
    ...(opts.ownWords !== undefined ? { ownWords: opts.ownWords } : {}),
  });
  // The knowledge-graph rows (`/review`, `/graph`) — PRD 38 §4.9.
  return opts.knowledge ? withKnowledgeRows(port, opts.knowledge, defineRegistry) : port;
}
