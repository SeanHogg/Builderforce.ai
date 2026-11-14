import { registerDeadLetterQueue } from "../deadLetterCommand";
import { createDurableOutbox, outboxSecrets, scopeTenantId } from "../outboxStorage";
import { authed } from "./transport";
/**
 * Chat turns that could not be saved when they happened, one lane per chat, replayed in
 * order. Each row keeps the `eventKey` it was first sent with, so a replay of a write the
 * server did take (only the answer was lost) returns the original rows instead of a
 * duplicate. A chat the server refuses (deleted, no access) is dropped, not retried.
 * Nothing enqueues here any more — the editor's turns are local and reach the account
 * through sync (PRD 36) — but the lanes older builds queued on disk still drain.
 */
const pendingTurns = createDurableOutbox("brain-turns", {
    maxItems: 25,
    maxWaitMs: 0,
    send: (chatId, rows, ctx) => sendQueuedBrainRows(chatId, rows, scopeTenantId(ctx.scope)),
});
/** The queue this module already owns. Export and repair see this object, not a second outbox. */
registerDeadLetterQueue({ name: "brain-turns", outbox: pendingTurns });
/**
 * Replay queued rows (unsaved chat turns, durable run steps) to a chat, AS the tenant
 * they were queued for. Throws on failure — with the HTTP `status` when the server
 * answered — so the outbox drops a refusal and keeps everything else.
 */
async function sendQueuedBrainRows(chatId, rows, asTenant) {
    const r = await postBrainMessages(await outboxSecrets(), chatId, rows, { asTenant });
    if (!r.ok)
        throw Object.assign(new Error(r.reason), r.status !== undefined ? { status: r.status } : {});
}
/**
 * POST turns to a Brain chat and get back the rows the server created, plus the
 * learn-gate outcome — the ONE write behind both the participant's after-the-fact
 * persist (the queued turns above) and the host-owned webview run's in-loop
 * persistence, which needs the created rows to append them to the live transcript.
 *
 * Never throws; it REPORTS instead. It used to answer `undefined` for every failure
 * alike, which left the one caller that must explain itself to a person no choice
 * but to guess — and it guessed "sign in again" for what was usually a dropped
 * connection.
 */
async function postBrainMessages(secrets, chatId, messages, 
/** Replays only: the tenant the rows were queued for — never sent as another. */
opts = {}) {
    // Minted ONCE, before the first attempt and outside the retry loop — the whole
    // safety of retrying rests on the second attempt carrying the SAME keys as the
    // first, so the server can recognise it (`uq_brain_chat_messages_event`) and hand
    // back the original rows instead of writing the turn twice. A row that already
    // carries a key (a step row from the outbox, a queued turn being replayed) keeps it.
    const keyed = messages.map((m) => (m.eventKey ? m : { ...m, eventKey: `vsix:${crypto.randomUUID()}` }));
    let last = "";
    let status;
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
        if (attempt > 0)
            await new Promise((r) => setTimeout(r, WRITE_BACKOFF_MS[attempt - 1]));
        try {
            const r = await authed(secrets, `/api/brain/chats/${chatId}/messages`, { method: "POST", body: JSON.stringify({ messages: keyed }), asTenant: opts.asTenant });
            // `authed` answers undefined only when there is no usable token to send. No
            // amount of retrying mints a credential, so this one stops here.
            if (!r)
                return { ok: false, signedOut: true, reason: "not signed in" };
            return { ok: true, messages: r.messages ?? [], ...(r.evermindLearn ? { evermindLearn: r.evermindLearn } : {}) };
        }
        catch (e) {
            last = e instanceof Error ? e.message : String(e);
            const code = e?.status;
            status = typeof code === "number" ? code : undefined;
            if (!isRetriableWrite(e))
                break;
        }
    }
    /* best-effort persistence — never blocks the chat turn */
    return { ok: false, signedOut: false, reason: last, ...(status !== undefined ? { status } : {}) };
}
/** Three tries over ~2.5s: long enough to outlast a hibernate-wake or a redeploy,
 *  short enough that a turn never appears to hang on its own bookkeeping. */
const WRITE_ATTEMPTS = 3;
const WRITE_BACKOFF_MS = [500, 2000];
/**
 * Is this failure worth sending again?
 *
 * A transport failure (no `status` at all — the request never got an answer) and a
 * 5xx are the two the server may well accept a moment later. A 4xx is the server
 * having read the request and refused it; repeating it verbatim changes nothing.
 */
function isRetriableWrite(e) {
    const status = e?.status;
    return typeof status !== "number" || status >= 500;
}
//# sourceMappingURL=brainMessages.js.map