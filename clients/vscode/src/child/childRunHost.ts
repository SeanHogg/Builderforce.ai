/**
 * How the run host starts, stops and wakes a sub-agent — as ITSELF.
 *
 * Recursion, not a second loop: a child is a run spec derived from its owner's (same
 * project, same governance and base prompt) with the sub-agent brief in
 * front, its task as the user turn and a lineage pointer, handed to the host's one `run`.
 * The catalog model follows an explicit parent pick (`modelStrict`); otherwise
 * `ROLE_MODELS` / `ROLE_MODEL_DEFAULT` may pin a different model for the child's role.
 * Waking an idle owner is the same call again with what arrived in its inbox as the turn.
 *
 * Kept apart from `brainRunHost.ts` so the host stays the run lifecycle and nothing else;
 * this file is only the derivation.
 */

import { childWorkRefs, spawnChild } from "@builderforce/agent-run";
import { MID_TURN_META_KEY } from "@builderforce/agent-loop";
import { briefWithHandoff, ownerHandoffBlock } from "@builderforce/agent-tools";
import {
  appendRunMessage,
  drainRunSteering,
  requeueRunSteering,
  getRunTrace,
  savedChatOf,
  stopRun,
  withDirectedMetadata,
  type BrainRunPersistence,
  type RunLineage,
} from "@seanhogg/builderforce-brain-embedded";
import type { ChildRuns } from "./childRuns";
import type { ChildOwner, ChildRequest, ChildRunHost } from "./childRunSpawner";
import type { ChildLedger } from "./childLedger";
import type { WebviewRunStart } from "../brain/brainRunHostProtocol";
import { establishedCalls } from "./childCoverage";
import { writeChildDataFile } from "./childDataFile";
import { modelForChildRun } from "../roleModelPin";
import { HostStartSetupError } from "../run/hostStartGate";

/** A run as the host executes it: what the panel sends, plus what only the host knows. */
export interface RunSpec extends WebviewRunStart {
  /** Present when this run is someone's sub-agent. */
  child?: {
    lineage: RunLineage;
  };
  /** The prompt every run in this tree is built on — the top-level owner's. */
  basePrompt?: string;
  /** The sub-agent stage model its children code on (see `modelForChildRun`). */
  subagentModel?: string;
  /** Internal references carried into the owner wake. */
  childWorkRefs?: readonly string[];
}

export interface ChildRunHostDeps {
  registry: ChildRuns;
  /** The spec a run key was last started with. */
  specOf(key: number): RunSpec | undefined;
  /** The ONE door every run opens through: the editor binds the gated start here (`BrainRunHostPorts.startThrough`), so a child, a resumed child and a wake get the change-set identity, journal start and delta capture their owner gets. */
  start(spec: RunSpec): Promise<void>;
  wakeFailed(key: number, error: unknown): void;
  /** Whether a run key is being set up, running or unwinding in the host. */
  isBusy(key: number): boolean;
  /** The Auto switch of the chat a tree lives in, right now. */
  autoApproveOf(rootChatId: number): boolean;
  persistence: BrainRunPersistence;
  /** Tell every panel what a chat's live children are. */
  announce(rootChatId: number): void;
  /** The editor's sub-agent stage model (`builderforce.models.subagent`), read per spawn. */
  subagentModel?(): Promise<string | undefined>;
  /** The persisted child ledger (`childLedger.ts`); absent ⇒ the spawner's in-memory one. */
  ledger?: ChildLedger;
  /** The workspace a child's collected data is saved under; absent (or empty) ⇒ none is saved. */
  workspaceRoot?(): string | undefined;
}

/** The hand-off a child's brief carries: the owner's `context`, then the calls its run already made. */
export function childBrief(req: Pick<ChildRequest, "task" | "context">, ownerKey: number): string {
  const block = ownerHandoffBlock({
    ...(req.context ? { context: req.context } : {}),
    established: establishedCalls(getRunTrace(ownerKey)),
  });
  return briefWithHandoff(req.task, block);
}


export function createChildRunHost(deps: ChildRunHostDeps): ChildRunHost {
  const wake = (ownerKey: number): boolean => {
    const spec = deps.specOf(ownerKey);
    if (!spec || spec.wakeable === false) return false;
    if (deps.isBusy(ownerKey)) {
      // The live run takes the inbox, or the host's settlement takes it once after Stop has been checked.
      return true;
    }
    const steered = drainRunSteering(ownerKey);
    if (!steered.length) return false;
    // A wake that carries images becomes vision content parts; text-only stays a string.
    const imageAtts = steered.flatMap((m) => (m.attachments ?? []).filter((a) => a.imageUrl));
    const joinedText = steered.map((m) => m.text).join("\n\n");
    const turn = imageAtts.length
      ? [{ type: 'text' as const, text: joinedText }, ...imageAtts.map((a) => ({ type: 'image_url' as const, image_url: { url: a.imageUrl! } }))]
      : joinedText;
    void nextTurn(spec, turn, childWorkRefs(steered)).catch((error: unknown) => {
      if (error instanceof HostStartSetupError && !error.stopped) requeueRunSteering(ownerKey, steered);
      deps.wakeFailed(ownerKey, error);
    });
    return true;
  };

  /** The next turn of a run the host already knows — the transcript is still in the store. */
  const nextTurn = (spec: RunSpec, turn: RunSpec["userTurn"], refs: readonly string[] = []): Promise<void> => {
    const { seed: _seed, priorResearch: _prior, ...rest } = spec;
    return deps.start({ ...rest, childWorkRefs: refs, userTurn: turn, autoApprove: deps.autoApproveOf(savedChatOf(spec.chatId, spec.child?.lineage)) });
  };

  return {
    registry: deps.registry,
    ...(deps.ledger ? { ledger: deps.ledger } : {}),

    async resumeChild(key, text) {
      const spec = deps.specOf(key);
      if (!spec?.child) throw new Error(`sub-agent run ${key} is not known to this host`);
      await nextTurn(spec, text);
    },

    async saveChildData(rootChatId, handle, text) {
      const root = deps.workspaceRoot?.();
      return root ? writeChildDataFile(root, rootChatId, handle, text) : undefined;
    },

    async startChild(key, lineage, owner, req) {
      const spec = deps.specOf(owner.key);
      if (!spec) throw new Error("the run that spawned this sub-agent is not known to this host");
      const subagentModel = await deps.subagentModel?.();
      const parent: RunSpec = subagentModel ? { ...spec, subagentModel } : spec;
      const base = parent.basePrompt ?? parent.systemPrompt;
      const model = modelForChildRun(parent, req.role);
      return spawnChild({
        parentRunId: String(owner.key), entryPoint: "vscode", depth: lineage.depth,
        owner: owner.name, task: childBrief(req, owner.key), role: req.role,
        ...(req.ticket ? { workItemIds: [req.ticket] } : {}),
        persona: req.persona, basePrompt: base,
      }, {
        openRun: (child) => deps.start({
          chatId: key,
          systemPrompt: child.systemPrompt,
          basePrompt: base,
          // The owner's opening DATA (IDE persona, project, editor context …): the child's prompt is built from it the same way.
          ...(parent.opening ? { opening: parent.opening } : {}),
          ...(model ? { model } : {}),
          ...(parent.modelStrict != null ? { modelStrict: parent.modelStrict } : {}),
          ...(parent.routingMode ? { routingMode: parent.routingMode } : {}),
          ...(parent.maxTokens ? { maxTokens: parent.maxTokens } : {}),
          ...(parent.reasoning ? { reasoning: parent.reasoning } : {}),
          // The brief plus what the owner already established (chat #273: the child re-derived it all).
          userTurn: child.prompt,
          projectId: parent.projectId ?? null,
          chatMode: "work",
          autoApprove: deps.autoApproveOf(owner.rootChatId),
          // A child's turns are progress inside its owner's work, not lessons of their own.
          evermind: false,
          ...(parent.modelSurface ? { modelSurface: parent.modelSurface } : {}),
          child: {
            lineage: { ...lineage, ...(child.workItemIds[0] ? { ticket: child.workItemIds[0] } : {}) },
          },
        }),
      });
    },

    stop(key) {
      if (deps.registry.lineageOf(key)) deps.registry.requestStop(key);
      stopRun(key);
    },

    wake,

    postDirection(rootChatId, from, fromName, to, text) {
      const meta = { [MID_TURN_META_KEY]: true };
      const metadata = to ? withDirectedMetadata({ kind: "agent", ref: to.ref, name: to.name }, meta) : JSON.stringify(meta);
      void deps.persistence
        .sendMessages(rootChatId, [{
          role: from === "person" ? "user" : "assistant",
          content: from === "person" || !to ? text : `**${fromName} → ${to.name}:** ${text}`,
          ...(metadata ? { metadata } : {}),
        }])
        .then(([msg]) => { if (msg) appendRunMessage(rootChatId, msg); })
        .catch(() => undefined);
    },

    changed: (rootChatId) => deps.announce(rootChatId),
  };
}

/** The owner a run is, for the controls its catalog carries. */
export function ownerOf(spec: RunSpec, ownerName: string): ChildOwner {
  const lineage = spec.child?.lineage;
  return {
    key: spec.chatId,
    rootChatId: savedChatOf(spec.chatId, lineage),
    name: lineage?.agent.name ?? ownerName,
    depth: lineage?.depth ?? 0,
  };
}
