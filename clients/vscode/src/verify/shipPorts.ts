/**
 * The PRD 45 ship-gate ports as ONE editor run binds them (PRD 46 §3.6): `verifier`, `git` and
 * `reviewer`, spread onto the Brain host request next to `needsConfirm` by both editor surfaces
 * — the panel's run host (`brainRunHost.ts`) and the native participant (`nativeBrainRun.ts`).
 *
 * The verifier and git ports are built ONCE per workspace root and reused by every run there,
 * so the verifier's in-process cache spans runs (a re-check of unchanged bytes costs nothing).
 * The reviewer is built per run: it reads the run's own stream and the review stage pin as they
 * are NOW (a settings change applies to the next run).
 *
 * No runtime `vscode` import — the live module arrives as `VscodeLike` (tested with a fake).
 */

import type { BrainRunRequest, BrainStreamFn } from "@seanhogg/builderforce-brain-embedded";
import { createHash } from "crypto";
import type { EditorRunSettings } from "../stageModels";
import type { VscodeLike } from "./pathDiagnostics";
import type { GitRunner } from "./gitPort";
import { createGit, createReviewer, createVerifierPort, type VerifyHostDeps } from "./index";
import type { ReviewerDeps, ReviewSubRunResult } from "./reviewerPort";
// Type-only: gateway.ts has a runtime `import * as vscode`, and this module must stay loadable
// under a fake (the port header's "no runtime vscode" rule). The live catalog read is INJECTED
// via `ShipPortsDeps.getCatalog` (wired in `editorShipPorts.ts`), never imported here.
import type { ModelChoices } from "../gateway";

export type ShipPorts = Required<Pick<BrainRunRequest, "verifier" | "git" | "reviewer">>;

/** What one run hands over: where it works, how it calls a model, its stage settings. */
export interface ShipPortsRun {
  root: string;
  stream: BrainStreamFn;
  settings?: EditorRunSettings;
}

export interface ShipPortsDeps {
  vscode: VscodeLike;
  git: GitRunner;
  readText?: VerifyHostDeps["readText"];
  /** Read the account's model catalog (BYO + plan pool + premium + configured). Optional —
   *  the editor binding supplies `getModels(secrets)`; a failure yields `undefined`, which
   *  just means no auto-switch (the reviewer falls back to its refusal). */
  getCatalog?: () => Promise<ModelChoices | undefined>;
}

/** The review sub-run's JSON verdict, or a request for changes when the reply is not one. */
export function parseReviewReply(text: string): ReviewSubRunResult {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  try {
    const parsed = JSON.parse(json ?? "") as { verdict?: unknown; findings?: unknown };
    const findings = Array.isArray(parsed.findings) ? parsed.findings.filter((f): f is string => typeof f === "string") : [];
    if (parsed.verdict === "approved" || parsed.verdict === "changes_requested") return { verdict: parsed.verdict, findings };
  } catch {
    /* not JSON — falls through */
  }
  return { verdict: "changes_requested", findings: ["The reviewer did not return a JSON verdict; review again."] };
}

/**
 * The reviewer's dependencies for one run: its stream, the review pin, the other stage pins,
 * and the account catalog (for the OD-1 auto-switch recovery). The catalog read is ASYNC and
 * per run (the reviewer is built per run), so it is read lazily inside the port's `review` —
 * the port is created synchronously, the catalog is awaited only when the gate actually runs.
 */
function reviewerDeps(run: ShipPortsRun, deps: ShipPortsDeps): ReviewerDeps {
  const phase = run.settings?.phaseModels;
  const available = [phase?.code, phase?.plan, run.settings?.subagentModel, run.settings?.pipeline?.quickModel]
    .filter((m): m is string => typeof m === "string" && !!m);
  const getCatalog = deps.getCatalog;
  return {
    ...(phase?.verify ? { verifyStagePin: phase.verify } : {}),
    availableModels: [...new Set(available)],
    ...(getCatalog
      ? {
          getCatalogModels: () =>
            getCatalog()
              .then((choices) => (choices ? catalogModelIds(choices) : undefined))
              .catch(() => undefined),
        }
      : {}),
    runReviewSubRun: async ({ model, prompt }) => {
      const result = await run.stream({ messages: [{ role: "user", content: prompt }], model, modelStrict: true, role: "verify" });
      return parseReviewReply(result.text);
    },
    hashDiff: (diff) => createHash("sha256").update(diff, "utf8").digest("hex"),
  };
}

/**
 * The full set of models the user's account can reach, de-duplicated and ORDERED for the
 * reviewer auto-switch: BYO (the tenant's own connected-provider models, cheapest) first,
 * then the plan pool, then premium, then any configured models. `pickReviewerModelWithFallback`
 * walks this in order, so a BYO non-author model is preferred over a gateway-pool one.
 */
export function catalogModelIds(choices: ModelChoices): string[] {
  return [
    ...choices.byo.models.map((m) => m.id),
    ...choices.models,
    ...choices.premiumModels,
    ...choices.configuredModels.map((c) => c.ref),
  ].filter((id): id is string => typeof id === "string" && !!id)
    .filter((id, i, all) => all.indexOf(id) === i);
}

/** One editor's ship-gate ports: call it per run; the verifier and git port are per workspace root. */
export function createShipPorts(deps: ShipPortsDeps): (run: ShipPortsRun) => ShipPorts {
  const byRoot = new Map<string, Pick<ShipPorts, "verifier" | "git">>();
  return (run) => {
    let bound = byRoot.get(run.root);
    if (!bound) {
      const host: VerifyHostDeps = {
        root: run.root,
        vscode: deps.vscode,
        git: deps.git,
        ...(deps.readText ? { readText: deps.readText } : {}),
      };
      bound = { verifier: createVerifierPort(host), git: createGit(host) };
      byRoot.set(run.root, bound);
    }
    return { ...bound, reviewer: createReviewer(reviewerDeps(run, deps)) };
  };
}
