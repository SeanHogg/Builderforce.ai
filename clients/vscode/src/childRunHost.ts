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

import { MID_TURN_META_KEY, subagentSystemPrompt } from "@builderforce/agent-loop";
import {
  appendRunMessage,
  drainRunSteering,
  savedChatOf,
  stopRun,
  withDirectedMetadata,
  type BrainRunPersistence,
  type RunLineage,
} from "@seanhogg/builderforce-brain-embedded";
import type { ChildRuns } from "./childRuns";
import type { ChildOwner, ChildRequest, ChildRunHost } from "./childRunSpawner";
import type { WebviewRunStart } from "./brainRunHostProtocol";
import { modelForChildRun } from "./roleModelPin";

/** A run as the host executes it: what the panel sends, plus what only the host knows. */
export interface RunSpec extends WebviewRunStart {
  /** Present when this run is someone's sub-agent. */
  child?: {
    lineage: RunLineage;
    /** The model role its turns are routed for (explore / code / verify …). */
    role: string;
  };
  /** The prompt every run in this tree is built on — the top-level owner's. */
  basePrompt?: string;
  /** False for an owner this host cannot start a turn for (the native chat participant). */
  wakeable?: boolean;
  /** The sub-agent stage model its children code on (see `modelForChildRun`). */
  subagentModel?: string;
}

export interface ChildRunHostDeps {
  registry: ChildRuns;
  /** The spec a run key was last started with. */
  specOf(key: number): RunSpec | undefined;
  /** The host's ONE run entry — owners and children alike. */
  start(spec: RunSpec): Promise<void>;
  /** Whether a run key is being set up, running or unwinding in the host. */
  isBusy(key: number): boolean;
  /** The Auto switch of the chat a tree lives in, right now. */
  autoApproveOf(rootChatId: number): boolean;
  persistence: BrainRunPersistence;
  /** Tell every panel what a chat's live children are. */
  announce(rootChatId: number): void;
  /** The editor's sub-agent stage model (`builderforce.models.subagent`), read per spawn. */
  subagentModel?(): Promise<string | undefined>;
}

export function createChildRunHost(deps: ChildRunHostDeps): ChildRunHost & { afterRun(key: number): void } {
  /** Owners asked to wake while still busy — woken again the moment their run settles,
   *  so a report that arrives as a run is ending is never stranded in its inbox. */
  const deferred = new Set<number>();

  const wake = (ownerKey: number): boolean => {
    const spec = deps.specOf(ownerKey);
    if (!spec || spec.wakeable === false) return false;
    if (deps.isBusy(ownerKey)) {
      // A running owner reads its inbox before its next turn; one that is unwinding
      // gets this wake replayed by `afterRun`.
      deferred.add(ownerKey);
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
    // The transcript is still in the store, so the wake is just the next turn of it.
    const { seed: _seed, priorResearch: _prior, ...rest } = spec;
    void deps.start({ ...rest, userTurn: turn, autoApprove: deps.autoApproveOf(savedChatOf(spec.chatId, spec.child?.lineage)) });
    return true;
  };

  return {
    afterRun(key) {
      if (deferred.delete(key)) wake(key);
    },

    registry: deps.registry,

    async startChild(key, lineage, owner, req) {
      const spec = deps.specOf(owner.key);
      if (!spec) throw new Error("the run that spawned this sub-agent is not known to this host");
      const subagentModel = await deps.subagentModel?.();
      const parent: RunSpec = subagentModel ? { ...spec, subagentModel } : spec;
      const base = parent.basePrompt ?? parent.systemPrompt;
      const model = modelForChildRun(parent, req.role);
      return deps.start({
        chatId: key,
        systemPrompt: `${subagentSystemPrompt(req.persona, { owner: owner.name, role: req.role })}\n\n${base}`,
        basePrompt: base,
        ...(model ? { model } : {}),
        ...(parent.modelStrict != null ? { modelStrict: parent.modelStrict } : {}),
        ...(parent.routingMode ? { routingMode: parent.routingMode } : {}),
        ...(parent.maxTokens ? { maxTokens: parent.maxTokens } : {}),
        ...(parent.reasoning ? { reasoning: parent.reasoning } : {}),
        userTurn: req.task,
        projectId: parent.projectId ?? null,
        chatMode: "work",
        autoApprove: deps.autoApproveOf(owner.rootChatId),
        // A child's turns are progress inside its owner's work, not lessons of their own.
        evermind: false,
        ...(parent.modelSurface ? { modelSurface: parent.modelSurface } : {}),
        child: {
          lineage,
          role: req.role,
        },
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
