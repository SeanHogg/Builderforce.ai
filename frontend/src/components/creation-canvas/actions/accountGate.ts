

export const ACCOUNT_REQUIRED_OBJECT_ACTIONS =new Set(['publish', 'deliver', 'assign', 'authenticate', 'execute', 'record', 'train', 'start', 'compare', 'build']);

/**
 * ONE shape for every "this needs a free account" tool answer.
 *
 * `error` is deliberate rather than a softer `message`: it is the field the canvas tool
 * loop keeps as `lastToolError`, so a turn that ends without a reply still tells the
 * user the real reason instead of "I couldn't prepare any canvas changes from that
 * request". `requiresAccount` distinguishes a gate from a genuine failure for anything
 * reading the trace. The account prompt is already open by the time the model reads it.
 */
export function accountGateResult(tool: string, reason: string): { requiresAccount: true; tool: string; error: string } {
  return { requiresAccount: true, tool, error: reason };
}

/**
 * Acts performed by a DEDICATED tool rather than by the generic action seam.
 *
 * ── WHY THIS EXISTS AND IS NOT A THIRD STATE ────────────────────────────────
 * `canvas_invoke_object_action` takes an object id and a verb. Sharing a data room
 * takes a named recipient, a real address, an expiry and a purpose; requesting a
 * signature takes the parties. Neither fits, so both are tools of their own — the
 * same shape `canvas_sync_account` already is — and the kinds they serve are absent
 * from `CONNECTED_CANVAS_ACTIONS` by design (`legalObjects.ts` says so in as many
 * words for `legalDocument`).
 *
 * What was missing was the REDIRECT. Absence alone made the generic tool answer "no
 * real Canvas delivery adapter is connected yet" — a sentence that is false, and false
 * in the direction that makes a model tell a user the product cannot do something it
 * can. Presence made it worse: the proposal was staged, approved by a human, and then
 * met a dispatcher with no branch for it, so the act ended in a notice rather than in
 * a signature request.
 *
 * So the seam NAMES the tool instead. One map, consulted before either path.
 */
export const DEDICATED_ACTION_TOOLS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  contract: { sign: 'canvas_request_signature' },
  offer: { send: 'canvas_request_signature', sign: 'canvas_request_signature' },
  policy: { acknowledge: 'canvas_request_signature' },
  dataRoom: { share: 'canvas_share_data_room', assemble: 'canvas_sync_data_room' },
  legalDocument: {
    share: 'canvas_legal_document_share',
    'request-signature': 'canvas_legal_document_request_signature',
    sync: 'canvas_legal_document_sync',
  },
  salesPipeline: { sync: 'canvas_sync_sales_pipeline' },
  fundingRound: { track: 'canvas_sync_funding_round' },
  // FO-B3. `refresh` on a requisition means "re-count the applications", which needs
  // the card's `postingId` and a real join — an argument the generic action seam cannot
  // carry, and a number the generic seam must never let a model assert. `distribute` is
  // deliberately absent: it needs a connected job board, and naming a tool that does not
  // exist yet would be worse than the honest "no delivery adapter" answer.
  jobPosting: { refresh: 'canvas_sync_job_posting' },
};
