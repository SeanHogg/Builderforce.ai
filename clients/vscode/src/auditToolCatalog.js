import { toolMutating } from './toolMutating';
import { authed } from './bfApi';
import { classifyTool } from '@builderforce/agent-tools';
import { saveLocalAuditFindings } from './localAuditStore';
/**
 * Run-id-keyed local sinks, registered by the component that started the audit run
 * (`AuditExecution`) so the catalog — assembled elsewhere, in the host's ports — picks
 * up the local store for exactly that run. Returns an unregister; always pair it with
 * the run's end so a recycled run id cannot inherit a stale sink.
 */
const localSinks = new Map();
export function registerAuditFindingsSink(runId, sink) {
    localSinks.set(runId, sink);
    return () => {
        if (localSinks.get(runId) === sink)
            localSinks.delete(runId);
    };
}
/** Audits can inspect source and request command approval, but cannot edit source or dispatch more work. */
export function auditToolCatalog(secrets, tools, projectId, audit, local) {
    // `verify` (run_checks) is not a mutation: the shared classifier keeps it available to audits; spawn/delegate stay out.
    const readable = tools.filter((t) => classifyTool(t.name, { mutates: t.mutating }) !== 'mutate' && !/spawn|delegate/i.test(t.name));
    let analysis;
    const commands = tools.filter((t) => !t.remote && /^(run_command|run_checks|analyze_codebase)$/.test(t.name)).map((tool) => tool.name !== 'analyze_codebase' ? tool : {
        ...tool, execute: async (args, root) => {
            const text = await tool.execute(args, root);
            analysis = JSON.parse(text).snapshot;
            return text;
        },
    });
    return [...readable, ...commands.filter((t) => !readable.includes(t)), {
            name: 'save_audit_findings', description: 'Save every audit finding, including source locations and evidence. The platform creates remediation tickets. Submit an empty array for a clean pass. Call this before finishing.',
            parameters: { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: {
                                title: { type: 'string' }, detail: { type: 'string' }, location: { type: 'string' },
                                severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] }, recommendation: { type: 'string' },
                            }, required: ['title', 'severity'] } } }, required: ['findings'] },
            // This write is the output explicitly authorized by starting the audit, scoped by the host.
            mutating: toolMutating('save_audit_findings', { mutates: false }), remote: true,
            execute: async (args) => {
                const sink = local ?? localSinks.get(audit.runId);
                if (sink) {
                    // Local-first: findings, evidence and remediation identities commit to the
                    // durable store (with their journal events); account import happens later from
                    // the journal without rerunning the audit.
                    return JSON.stringify(await saveLocalAuditFindings(sink.store, { deviceId: sink.deviceId }, { runId: audit.runId, findings: args.findings, ...(analysis ? { analysis } : {}) }));
                }
                return JSON.stringify(await authed(secrets, `/api/tools/audits/${encodeURIComponent(audit.auditId)}/findings`, {
                    method: 'POST', body: JSON.stringify({ projectId, runId: audit.runId, findings: args.findings, ...(analysis ? { analysis } : {}) }),
                }));
            },
        }];
}
//# sourceMappingURL=auditToolCatalog.js.map