/**
 * The explicit destination assignment for never-connected work (G10). Ownership is DATA on
 * the record: it is written when a record is created with a destination, or reassigned
 * here, or adopted by the SYNC pass. The policy, one rule for chats and work alike:
 * SIGN-IN ALONE NEVER ADOPTS unbound work — nothing in the repository infers an account from
 * whoever is signed in. ENABLING SYNC IS THE EXPLICIT CONSENT that adopts this device's
 * unbound work into the account: the sync pass (`chatSyncHost.ts`, which runs only once the
 * `synchronize` capability is granted) calls `bindWorkForSync`. A bound record is refused a
 * different account or tenant.
 *
 * The reassignment is journaled (version bump + update event) so the new destination rides
 * on an event a later batch push can send, and it cascades to the bound projects'
 * still-unbound tickets so a project cannot own tickets in another partition. (The web
 * library rewrites the destination silently; here it is journaled.)
 */
import { destinationKey, } from "@builderforce/local-first";
import { LocalWorkRepositoryError, commitRecord, creationDestination, live, rebindRefusal, refuseSignedInTenant, } from "./localWorkShared";
export function createOwnershipRepository(ctx) {
    return {
        /** Returns the number of records whose destination changed. */
        async bindDestination(input) {
            refuseSignedInTenant(input.to);
            const to = creationDestination(input.to);
            if (to.kind !== "bound" || !to.accountId) {
                throw new LocalWorkRepositoryError("destination_required", "Binding requires an explicit account snapshot. A signed-in session is not one.");
            }
            return ctx.store.transact(async (tx) => {
                let bound = 0;
                const targets = [];
                const foreignChildren = [];
                const queue = [...input.ids];
                while (queue.length > 0) {
                    const id = queue.shift();
                    if (targets.some((record) => record.id === id))
                        continue;
                    const record = (await tx.get("project", id)) ?? (await tx.get("ticket", id));
                    if (!record || record.deletedAt)
                        continue;
                    targets.push(record);
                    if (input.includeChildTickets !== false && record.entityType === "project") {
                        const children = (await live(tx, "ticket")).filter((ticket) => ticket.payload.projectId === id);
                        for (const child of children) {
                            if (child.destination.kind === "bound" && destinationKey(child.destination) !== destinationKey(to)) {
                                foreignChildren.push(child.id);
                            }
                            else if (child.destination.kind === "unbound") {
                                queue.push(child.id);
                            }
                        }
                    }
                }
                // A named record's own rebind refusal wins over a child's, so a later sign-in
                // is told the account or tenant does not match rather than a cascade detail.
                for (const record of targets) {
                    if (record.destination.kind !== "bound")
                        continue;
                    const refusal = rebindRefusal(record.destination, to);
                    if (!refusal)
                        continue;
                    throw new LocalWorkRepositoryError(refusal, `Record ${record.id} is already bound; refusing to reassign it.`);
                }
                if (foreignChildren.length > 0) {
                    throw new LocalWorkRepositoryError("cross_destination", `Ticket ${foreignChildren[0]} is already bound to a different destination.`);
                }
                for (const record of targets) {
                    if (record.destination.kind === "bound")
                        continue;
                    await commitRecord(ctx, tx, record, record.payload, "update", [], to);
                    bound += 1;
                }
                return bound;
            });
        },
    };
}
//# sourceMappingURL=localWorkOwnership.js.map