/**
 * The editor's PreFetch port (docs/design/deterministic-prefetch.md) — what both editor
 * surfaces (the panel's run host via `runSetupPorts.ts`, the native participant) hand a
 * run as `BrainRunRequest.prefetch`. It only ASSEMBLES:
 *
 *   - the registry and its executors (`executors.ts`: the editor's rows, then the shared
 *     ones from `@builderforce/agent-tools/prefetch`, run through the local shell);
 *   - the gate's ports: this surface, the tools detected in the workspace (`detectTools.ts`,
 *     finished by `prepare` the first time), the calibration (ONE `globalState` key) and
 *     the tier-3 logprob port (a warm Ollama);
 *   - `record` (the head update, persisted).
 *
 * WRITE actions are confirmed on the run's own confirm channel — the composer's confirm
 * chip (brain-ui `PrefetchConfirmChip` via `ToolConfirmBar`), declined by Stop — which
 * the gate raises itself (`prefetchGate.ts`), so this port supplies no `confirm` of its own.
 *
 * No `vscode` import: the memento, the local-models config and the editor-only parts
 * (diagnostics, focus files) are handed in.
 */

import {
  createLogprobPort,
  httpLogprobEngine,
  ollamaResidentModel,
  residentModelTracker,
  type LabelLogprobPort,
} from "@builderforce/local-inference";
import { TEMPLATES_TOOL, offeredToolIds, type ScaffoldTemplates } from "@builderforce/agent-tools/prefetch";
import type { CapabilityProvider } from "@builderforce/agent-tools";
import {
  deserializeCalibration,
  serializeCalibration,
  updateHead,
  type CalibrationState,
  type PrefetchPort,
} from "@builderforce/prefetch";
import { globalFetch, type LocalModelsConfig } from "../localModels";
import { workspaceTools, type ToolDetector } from "./detectTools";
import { VSCODE_PREFETCH_REGISTRY, editorPrefetchExecutors, type LspDiagnostics } from "./executors";

export { VSCODE_PREFETCH_REGISTRY };

/** The ONE `globalState` key the gate's calibration lives under. */
export const PREFETCH_CALIBRATION_KEY = "builderforce.prefetch.calibration";

/** The memento slice the port persists calibration through (`ExtensionContext.globalState`). */
export interface CalibrationMemento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}


/** One logprob port per Ollama endpoint, so its resident-model reading survives runs. */
const logprobPorts = new Map<string, LabelLogprobPort>();

/**
 * Tier 3 on this machine: a warm Ollama (the only engine the editor host reaches whose API
 * returns label logprobs — Synapse/bfi returns none, WebLLM lives in the webview). None
 * while local models are off: the gate then never consults tier 3.
 */
export function editorLogprobPort(config: LocalModelsConfig | undefined): LabelLogprobPort | undefined {
  const endpoint = config?.enabled ? config.endpoints.ollama : undefined;
  if (!endpoint?.baseUrl.trim()) return undefined;
  let port = logprobPorts.get(endpoint.baseUrl);
  if (!port) {
    const model = residentModelTracker(() => ollamaResidentModel(globalFetch, endpoint));
    port = createLogprobPort([httpLogprobEngine("ollama", endpoint, { fetch: globalFetch, model })]);
    logprobPorts.set(endpoint.baseUrl, port);
  }
  return port;
}

export interface VscodePrefetchPortOptions {
  /** The workspace root, read per call (the open folder can change). */
  root: () => string;
  /** `ExtensionContext.globalState`; absent ⇒ the gate runs cold and learns nothing. */
  state?: CalibrationMemento;
  /** The on-device runtime settings, for tier 3. */
  localModels?: () => LocalModelsConfig | undefined;
  /** The workspace's tool detection; default the editor's one memoised detector. */
  tools?: ToolDetector;
  /** The person's own words, when the run's user turn also carries inlined references —
   *  the executors ask about these, the same request the pack and the reference read use. */
  ownWords?: string;
  /** Root-relative files the person is working in (`lspDiagnostics.ts` `openWorkspaceFiles`). */
  focusFiles?: () => readonly string[];
  /** The language servers' diagnostics (`lspDiagnostics.ts`). */
  diagnostics?: LspDiagnostics;
  /** Starter scaffolds (`@builderforce/ide-templates` `TEMPLATES`). */
  templates?: ScaffoldTemplates;
  /** The capability provider per root (tests); default the editor's local one. */
  caps?: (root: string) => CapabilityProvider;
}

export function createVscodePrefetchPort(options: VscodePrefetchPortOptions): PrefetchPort {
  const read = (): CalibrationState => deserializeCalibration(options.state?.get<string>(PREFETCH_CALIBRATION_KEY));
  const detector = options.tools ?? workspaceTools;
  const extras = options.templates ? [TEMPLATES_TOOL] : [];
  return {
    registry: VSCODE_PREFETCH_REGISTRY,
    executors: editorPrefetchExecutors({
      root: options.root,
      tools: () => detector.current(options.root()),
      ...(options.ownWords !== undefined ? { ownWords: options.ownWords } : {}),
      ...(options.focusFiles ? { focusFiles: options.focusFiles } : {}),
      ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
      ...(options.templates ? { templates: options.templates } : {}),
      ...(options.caps ? { caps: options.caps } : {}),
    }),
    // Getters: the panel's port lives as long as the host, so each run's gate reads the
    // calibration, the detected tools and the local-model settings as they are NOW.
    ports: {
      surface: "vscode",
      get calibration() {
        return read();
      },
      get tools() {
        return offeredToolIds(detector.current(options.root()), extras);
      },
      get logprob() {
        return editorLogprobPort(options.localModels?.());
      },
    },
    prepare: async () => {
      const root = options.root();
      if (root) await detector.ensure(root);
    },
    record: (outcome) => {
      if (!options.state) return;
      void options.state.update(PREFETCH_CALIBRATION_KEY, serializeCalibration(updateHead(read(), outcome)));
    },
  };
}
