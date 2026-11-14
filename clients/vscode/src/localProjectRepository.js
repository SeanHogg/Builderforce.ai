/**
 * The VSIX local PROJECT repository: create / update / list / tombstone, committed through
 * the shared commit helper (`localWorkShared.ts`). No network; see that module's rules.
 */
import { newLocalRecord, } from "@builderforce/local-first";
import { commitRecord, eventId, live, projectFor, requireText, } from "./localWorkShared";
export function createProjectRepository(ctx) {
    return {
        async listProjects() {
            return ctx.store.read((tx) => live(tx, "project"));
        },
        async getProject(id) {
            return ctx.store.read((tx) => projectFor(tx, id));
        },
        async createProject(input) {
            const name = requireText(input.name, "project_name_required", "A project needs a name.");
            const key = input.key?.trim();
            const status = input.status?.trim();
            return ctx.store.transact(async (tx) => {
                const stamp = ctx.now().toISOString();
                const created = newLocalRecord({
                    id: input.id?.trim() || ctx.newId(),
                    entityType: "project",
                    payload: {
                        name,
                        ...(key ? { key } : {}),
                        ...(status ? { status } : {}),
                    },
                    deviceId: ctx.deviceId,
                    destination: ctx.stampFor(input.destination),
                    occurredAt: stamp,
                });
                await tx.put(created);
                await tx.append({
                    eventId: eventId("project", created.id, created.version),
                    clientEntityId: created.id,
                    entityType: "project",
                    operation: "create",
                    schemaVersion: created.schemaVersion,
                    occurredAt: stamp,
                    dependsOn: [],
                    destination: created.destination,
                    payload: created.payload,
                });
                return created;
            });
        },
        async updateProject(id, patch) {
            if (patch.name !== undefined)
                requireText(patch.name, "project_name_required", "A project needs a name.");
            return ctx.store.transact(async (tx) => {
                const current = await projectFor(tx, id);
                const payload = { ...current.payload };
                if (patch.name !== undefined)
                    payload.name = patch.name.trim();
                if (patch.key !== undefined) {
                    if (patch.key.trim())
                        payload.key = patch.key.trim();
                    else
                        delete payload.key;
                }
                if (patch.status !== undefined) {
                    if (patch.status.trim())
                        payload.status = patch.status.trim();
                    else
                        delete payload.status;
                }
                return commitRecord(ctx, tx, current, payload, "update");
            });
        },
        /** Tombstone the project and its tickets in one transaction — never a row removal. */
        async deleteProject(id) {
            await ctx.store.transact(async (tx) => {
                const current = await projectFor(tx, id);
                const projectDelete = eventId("project", id, current.version + 1);
                const children = (await live(tx, "ticket")).filter((ticket) => ticket.payload.projectId === id);
                for (const ticket of children) {
                    await commitRecord(ctx, tx, ticket, ticket.payload, "delete", [projectDelete]);
                }
                await commitRecord(ctx, tx, current, current.payload, "delete");
            });
        },
    };
}
//# sourceMappingURL=localProjectRepository.js.map