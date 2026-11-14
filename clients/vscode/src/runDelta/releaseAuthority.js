/**
 * WHO may release a run held at its finalize gate (PRD 41 §12.5), and as whom the waiver is recorded.
 *
 *   - A signed-out person, or one whose identity cannot be read, is refused `run_delta_release_identity_required`: a
 *     waiver is never recorded as `local` or anonymous.
 *   - A run whose chat or ticket is on a board needs the board's EXISTING approver authority — the platform's approve /
 *     reject tier (`isManagerRole`, the API's `isManager` + `decideApproval`), read through `activeWorkspaceManager`. This
 *     device holds no board's lifecycle flag, so EVERY board the run is on is treated as managed (the stricter reading).
 *     Without that authority: `run_delta_release_refused:not_approver`; when it cannot be read: identity required.
 *   - A run on no board: the signed-in person may release it.
 *
 * "On a board" is the run's own ticket, or a ticket its chat holds as the rail shows it (`chatRail/ticketsOfChat.ts`, the
 * ONE selection of a chat's tickets).
 */
import { RUN_DELTA_RELEASE_REFUSED } from "@builderforce/run-delta/contract";
import { ticketsOfChats } from "../chatRail/ticketsOfChat";
/** Is the run on a board: its own ticket, or a ticket its chat holds? */
export async function runOnBoard(deps, runId) {
    const run = (await deps.store.read((tx) => tx.get("execution", runId)))?.payload;
    if (!run)
        return false;
    if (run.ticketId)
        return true;
    const localChatId = Number(run.chatId);
    if (!run.chatId || !Number.isInteger(localChatId))
        return false;
    const chat = await deps.chatClientId(localChatId);
    if (!chat)
        return false;
    return deps.store.read(async (tx) => {
        const links = [];
        await tx.scan("chat-ticket-link", (row) => {
            if (!row.deletedAt && row.payload.chatClientId === chat)
                links.push({ id: row.id, payload: { ...row.payload } });
        });
        const tickets = new Map();
        for (const link of links) {
            const ticket = await tx.get("ticket", link.payload.ticketClientId);
            if (ticket)
                tickets.set(ticket.id, ticket);
        }
        return (ticketsOfChats(links, (id) => tickets.get(id), new Set([chat])).get(chat)?.length ?? 0) > 0;
    });
}
/** The releasing person's user id, once they may release this run. Rejects with the refusal code otherwise. */
export async function authorizeRelease(deps, runId) {
    const by = await deps.currentUserId().catch(() => null);
    if (!by)
        throw new Error(RUN_DELTA_RELEASE_REFUSED.identityRequired);
    if (await runOnBoard(deps, runId)) {
        const approver = await deps.isApprover().catch(() => undefined);
        if (approver === undefined)
            throw new Error(RUN_DELTA_RELEASE_REFUSED.identityRequired);
        if (!approver)
            throw new Error(RUN_DELTA_RELEASE_REFUSED.notApprover);
    }
    return by;
}
//# sourceMappingURL=releaseAuthority.js.map