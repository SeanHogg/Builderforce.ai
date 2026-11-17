/**
 * Which files a call changes, and how — the guards' import path for THE shape reader,
 * which lives once in `@builderforce/agent-tools` (`callShape.ts`; this package depends on
 * that one, so the reader cannot live here without a cycle). Every guard here that asks
 * (fingerprint path, edit-revert, the no-progress window, the progress detector, the write
 * ledger) reads it through this module — including the batched `edit_file({ edits: [...] })`
 * form once invisible to all of them (VS Code chat #146477). Holds no logic of its own.
 */
export { callChangesOf, changedPathsOf, type CallChange } from "@builderforce/agent-tools";
