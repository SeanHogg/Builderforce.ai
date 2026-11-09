/**
 * The host ports every deterministic run gate reads (PRD 45 §4.4). The canonical
 * definitions live on `BrainRunRequest` (brain-embedded `runStore/runTypes.ts`),
 * next to `needsConfirm`; this file re-exports them so `verify/` consumers build
 * against the ONE contract instead of a mirror that could drift.
 *
 * CheckKind / CheckRecord / OutgoingFile / ReviewVerdict are the shared evidence
 * shapes from `@builderforce/run-guards` (§4.2/§4.3), re-exported here too.
 */
export type { VerifierPort, GitPort, ReviewerPort } from "@seanhogg/builderforce-brain-embedded";
export type { CheckKind, CheckRecord, OutgoingFile, ReviewVerdict } from "@builderforce/run-guards";
