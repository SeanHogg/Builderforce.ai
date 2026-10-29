/**
 * policy/compaction/pack — the transcript packer, BOUND (never copied).
 *
 * The packer is `packHandoff` from `@seanhogg/builderforce-memory/handoff` (PRD 34 §3.3):
 * the leading system messages stay first, the latest user directive stays verbatim,
 * tool-call pairing is never broken, the verbatim tail takes what the budget allows, and
 * the dropped middle becomes ONE note (summary → recall → elision marker) whose role keeps
 * turns alternating. The cloud loop's `compactMessages`
 * (`api/src/application/llm/compactMessages.ts`), the Brain's window fit and the on-prem
 * stall hand-off (`agent-runtime/.../handoff-pack.ts`) all drive this same packer.
 *
 * PRD 35 §3.1: pure brain logic lives in the tested builderforce-memory packages and
 * `agent-run` imports it — a WS2 policy module is a thin binding over those pure
 * functions, never a second copy. The subpath is pure (no `node:*`, no DOM), so this
 * package stays Worker-, browser- and Node-safe.
 *
 * The `Pack*` names are this module's long-standing aliases for the memory package's
 * `Handoff*` types, kept so the compaction module's callers read one vocabulary.
 */

export {
  packHandoff,
  handoffBudget,
  defaultEstimateTokens,
  messageTokens,
  tokensOf,
  isVolatileTail,
  isVolatileContent,
  volatileTail,
  VOLATILE_TAIL_TAG,
} from "@seanhogg/builderforce-memory/handoff";

export type {
  HandoffMessage as PackMessage,
  HandoffPackInput as PackInput,
  HandoffPack as PackResult,
  TokenEstimator,
} from "@seanhogg/builderforce-memory/handoff";
