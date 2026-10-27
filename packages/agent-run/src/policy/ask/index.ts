/**
 * policy/ask — `policy/ask/**` — asking a human: the option list, the pending answer and the lift of a prose question into a real ask.
 *
 * Owned by WS2c. It ports, behind the {@link AskHook} the composition calls:
 *   - the kernel `ask_human` / `ASK_USER_TOOL` contract — `packages/agent-loop/src/index.ts`.
 *     The one definition of the question an agent asks, shared by every loop that can
 *     ask one and every transcript that renders one: when a run genuinely cannot
 *     proceed without a human decision it calls `ask_user`, the loop stops, and the
 *     reply carries a fenced ```ask-user block the surface lifts back out and renders
 *     as clickable options (`brain-ui`'s `<QuestionCard>` / `<PendingQuestionBanner>`);
 *   - the `HumanChannel` PORT (`RunPorts.human.ask`) — the relay ask, the one thing a
 *     surface supplies about how people are reached. The hook never reaches the person
 *     itself; it asks through the port and parks the run (`paused`) until the answer
 *     arrives. Both the on-prem `askHumanTool` (`packages/agent-tools/core-tools.ts`)
 *     and every cloud surface's ask funnel through the same port, so the policy is one
 *     rule for every entry point.
 *
 * The hook's {@link AskHook.answer} is the port's decision: hand the question and its
 * options to the `human` port and return the {@link HumanAnswer} it gives — `answered`
 * with the choice, or `paused` when the run must wait for a person. It never branches
 * on where the surface keeps its people.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import type { HumanAnswer } from "../../contract.js";
import type { AskHook, PolicyContext } from "../hooks.js";

/** The ask hook, as it stands. */
export const askHook: AskHook = {
  async answer(ctx: PolicyContext, question: string, options?: readonly string[]): Promise<HumanAnswer> {
    // The human channel is the surface's port: the tool-confirm gate, the approval bar,
    // the relay ask. The hook asks and parks — it never decides how the person is reached.
    if (!ctx.ports.human || typeof ctx.ports.human.ask !== "function") {
      return { kind: "paused" };
    }
    return ctx.ports.human.ask(question, options);
  },
};
