import { authed } from "./transport";
/**
 * The catalog of system audit types (GET /api/tools/audits). Public data — powers
 * the Diagnostics sidebar. Degrades to [] when signed out / unreachable.
 */
export async function listSystemAudits(secrets) {
    try {
        const r = await authed(secrets, "/api/tools/audits");
        return r?.audits ?? [];
    }
    catch {
        return [];
    }
}
/**
 * A project's diagnostic rating + each diagnostic's latest run (GET
 * /api/tools/projects/:id/score, manager+). Degrades to undefined when not a
 * manager / not deployed / project not owned, so the tree still lists the audit
 * types without scores.
 */
export async function getProjectDiagnostics(secrets, projectId) {
    try {
        return await authed(secrets, `/api/tools/projects/${projectId}/score`);
    }
    catch {
        return undefined;
    }
}
/**
 * Run a system audit against a project (POST /api/tools/audits/:id/run, manager+):
 * scores + records a report, notifies the user, and files the agent remediation
 * ticket. Returns true on success (202/201). Throws on non-2xx so the command layer
 * can surface WHY (e.g. 403 not a manager, 400 no repo).
 */
export async function runAudit(secrets, auditId, projectId) {
    const r = await authed(secrets, `/api/tools/audits/${encodeURIComponent(auditId)}/run`, { method: "POST", body: JSON.stringify({ projectId }) });
    return !!r;
}
//# sourceMappingURL=diagnostics.js.map