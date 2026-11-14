/**
 * PRD 41 A2: a project selected while signed out is a PENDING binding. The watcher OWNS the link edge:
 * it binds, through the one linked-root replication entry point, the moment the workspace becomes linked
 * (a session exists AND `synchronize` is granted) and unlinks (stops the pumps) the moment it stops being
 * linked. Exactly one `onLink` per unlinked -> linked edge and one `onUnlink` per linked -> unlinked
 * edge; a bind that reports failure does not count as bound, so the next `check()` retries it.
 */
export function pendingBinding(ports) {
    let bound;
    let running;
    let again = false;
    async function step() {
        const now = ports.linkedTo();
        if (now === false || now === undefined || now === null) {
            if (bound === undefined)
                return;
            bound = undefined;
            await ports.onUnlink();
            return;
        }
        if (bound === now)
            return;
        bound = undefined;
        let ok = false;
        try {
            ok = await ports.onLink(now);
        }
        catch {
            ok = false;
        }
        if (ok)
            bound = now;
    }
    return {
        check() {
            if (running) {
                again = true;
                return running;
            }
            running = (async () => {
                do {
                    again = false;
                    await step();
                } while (again);
            })().finally(() => { running = undefined; });
            return running;
        },
    };
}
//# sourceMappingURL=pendingBinding.js.map