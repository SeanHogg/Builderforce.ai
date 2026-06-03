/**
 * Barrel re-export — all project-context symbols in one place for backward compatibility.
 * Individual concerns live in focused modules:
 *   project-dir.ts             — directory layout + resolveBuilderForceAgentsDir
 *   project-init.ts            — initializeBuilderForceAgentsProject
 *   project-context-store.ts   — context/rules CRUD
 *   project-personas.ts        — persona management
 *   project-sessions.ts        — session handoffs
 *   project-workflows.ts       — workflow persistence
 *   project-workspace-state.ts — workspace-state.json
 *   project-knowledge.ts       — knowledge memory
 */
export * from "./project-dir.js";
export * from "./project-init.js";
export * from "./project-context-store.js";
export * from "./project-personas.js";
export * from "./project-sessions.js";
export * from "./project-workflows.js";
export * from "./project-workspace-state.js";
export * from "./project-knowledge.js";
