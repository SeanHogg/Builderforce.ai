/**
 * TEMPORARY re-export: the process-tree kill lives in `@builderforce/agent-tools/node-process`. The one remaining importer is
 * `knowledge/knowledgeShell.ts` (owned by another change set when this moved) — point it at the package and DELETE this file.
 */
export { killTree } from "@builderforce/agent-tools/node-process";
