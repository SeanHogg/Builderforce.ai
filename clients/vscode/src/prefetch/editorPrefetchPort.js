/**
 * The editor's PreFetch port WITH its editor-only parts — the ONE construction both
 * surfaces use (the panel's run host, `runSetupPorts.ts`; the native participant,
 * `chatParticipant.ts`): the open workspace files as the focus, the language servers'
 * diagnostics for `diag.typecheck`, the local-model settings for tier 3, and the starter
 * scaffolds (`@builderforce/ide-templates`) for `scaffold.template`.
 *
 * The local-model settings are INJECTED (`opts.localModels`), never read from `gateway`
 * here: this module sits in the run host's import graph (`runSetupPorts.ts`), and the
 * composition root (`extension.ts` → `createVsCodeRunHost`, the chat participant's
 * handler) owns where those settings come from. Absent, tier 3 is skipped.
 */
import { TEMPLATES } from "@builderforce/ide-templates";
import { lspDiagnostics, openWorkspaceFiles } from "./lspDiagnostics";
import { createVscodePrefetchPort } from "./vscodePrefetchPort";
import { defineRegistry } from "@builderforce/prefetch";
import { withKnowledgeRows } from "@builderforce/agent-tools/prefetch";
export function editorPrefetchPort(root, state, opts = {}) {
    const port = createVscodePrefetchPort({
        root,
        state,
        ...(opts.localModels ? { localModels: opts.localModels } : {}),
        focusFiles: () => openWorkspaceFiles(root()),
        diagnostics: lspDiagnostics,
        templates: TEMPLATES,
        ...(opts.ownWords !== undefined ? { ownWords: opts.ownWords } : {}),
    });
    // The knowledge-graph rows (`/review`, `/graph`) — PRD 38 §4.9.
    return opts.knowledge ? withKnowledgeRows(port, opts.knowledge, defineRegistry) : port;
}
//# sourceMappingURL=editorPrefetchPort.js.map