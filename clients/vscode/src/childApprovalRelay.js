/**
 * A sub-agent's write prompt, raised where its owner can answer it.
 *
 * A child pauses on a confirm like any run: its cell carries `pendingConfirm` and the
 * Brain panel renders the question. The native `@builderforce` view cannot render a
 * cell, so an owner there registers an APPROVER for its chat, and this relay asks it
 * whenever one of that chat's children pauses — the same modal the native turn uses
 * for its own calls. Whichever surface answers first wins; a late answer is dropped
 * rather than applied to a question asked after it.
 */
export function createChildApprovalRelay(deps) {
    /** By the chat a tree lives in. */
    const approvers = new Map();
    /** How each live run phrases a paused call (its own catalog and gates). */
    const describers = new Map();
    /** The question each run is being asked about, so a cell update does not ask twice. */
    const asking = new Map();
    return {
        register(rootChatId, approve) {
            approvers.set(rootChatId, approve);
        },
        describeWith(key, describe) {
            describers.set(key, describe);
        },
        forget(key) {
            describers.delete(key);
            asking.delete(key);
        },
        /** A run's cell changed — ask, if it is a child newly paused in a chat with an approver. */
        changed(key) {
            const lineage = deps.registry.lineageOf(key);
            const approve = lineage ? approvers.get(lineage.rootChatId) : undefined;
            const describe = describers.get(key);
            const pending = deps.pendingOf(key);
            if (!lineage || !approve || !describe || !pending || asking.get(key) === pending)
                return;
            asking.set(key, pending);
            void approve({ ...describe(pending.name, pending.args, pending.evidence), agentName: lineage.agent.name })
                .catch(() => false)
                .then((ok) => {
                if (asking.get(key) === pending)
                    asking.delete(key);
                // Answered elsewhere already (or a newer question is up): not ours to resolve.
                if (deps.pendingOf(key) === pending)
                    deps.resolve(key, ok);
            });
        },
    };
}
//# sourceMappingURL=childApprovalRelay.js.map