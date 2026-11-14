import { authed } from "./transport";
export async function listProjects(secrets) {
    const r = await authed(secrets, "/api/projects");
    return r?.projects ?? [];
}
/**
 * Create a project in the signed-in workspace (tenant) — POST /api/projects, which
 * accepts the extension's tenant JWT. Surfaces the plan-limit (402) message verbatim
 * so the caller can prompt an upgrade. The created project is returned for selection.
 */
export async function createProject(secrets, name) {
    const project = await authed(secrets, "/api/projects", {
        method: "POST",
        body: JSON.stringify({ name }),
    });
    if (!project)
        throw new Error("not signed in");
    return project;
}
//# sourceMappingURL=projects.js.map