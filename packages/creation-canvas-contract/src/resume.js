/**
 * The résumé document, and the family of revisions one résumé object holds.
 *
 * ── WHY THIS IS A CONTRACT AND NOT FRONTEND CODE ─────────────────────────────────
 * A résumé is authored on the canvas, but it is READ in four other places that have
 * no browser: the for-hire upload path builds a family server-side from a PDF, the
 * public `/resume/:token` projection strips it down to one deliberate snapshot, the
 * ATS projects the selected revision into the employer's tenant when someone applies,
 * and the Recruiter agent tailors one against a job description.
 *
 * When the shape lived only in `frontend/src/lib/canvasResume.ts`, the server grew its
 * own partial copy of the family reader (`application/creation/publicResumeProjection.ts`)
 * — two answers to "which revision is the live one", which is exactly the drift that
 * makes a public link show a different résumé than the editor does. So the parts BOTH
 * sides need live here, once.
 *
 * What deliberately does NOT live here: template *definitions* (colours, density,
 * section layout) and Markdown rendering. Those are presentation, only the renderer
 * needs them, and putting them in the transport contract would drag styling into the
 * API bundle. Only the template IDENTIFIERS are shared, because a revision stores one.
 */
/** Every résumé design a revision may name. Builderforce first-party templates. */
export const RESUME_TEMPLATE_IDS = [
    'standard',
    'payroll-iron-gray',
    'risk-asphalt',
    'executive-taupe',
    'intern-education-first',
    'hospitality-amber',
    'creative-minimal',
    'software-engineer-graphite',
    'healthcare-clinical-blue',
    'sales-growth-emerald',
    'actor-headshot-hero',
    'director-filmography-serif',
];
export const DEFAULT_RESUME_TEMPLATE_ID = 'standard';
/**
 * Template ids retired by a rename, mapped to their replacement.
 *
 * `hired-default` was a vendor brand frozen into persisted data: every revision
 * authored before the rename carries it, and the family reader DROPS a revision
 * whose `templateId` it does not recognise — which, for the original revision,
 * discards the whole résumé. Migration 1060 rewrites the rows this platform
 * stores, but a guest board keeps its family in the browser and no migration
 * reaches that, so the read boundary normalises too.
 */
const RETIRED_RESUME_TEMPLATE_IDS = {
    'hired-default': 'standard',
};
/** A known template id for `value`, following a retired id to its replacement. */
export function normalizeResumeTemplateId(value) {
    if (typeof value !== 'string')
        return null;
    if (RESUME_TEMPLATE_IDS.includes(value))
        return value;
    return RETIRED_RESUME_TEMPLATE_IDS[value] ?? null;
}
/** Canonical section order of the JSON Resume schema, as this platform renders it. */
export const RESUME_SECTION_ORDER = [
    'summary', 'work', 'education', 'skills', 'volunteer', 'projects',
    'awards', 'certificates', 'publications', 'languages', 'interests', 'references',
];
export function isResumeTemplateId(value) {
    return typeof value === 'string' && RESUME_TEMPLATE_IDS.includes(value);
}
const deepClone = (value) => JSON.parse(JSON.stringify(value));
/**
 * Build a fresh family around one original revision.
 *
 * `idFactory` and `now` are injectable because the server builds families inside a
 * request that must be reproducible in a test, and `crypto.randomUUID` is not.
 */
export function createResumeFamily(args) {
    const now = args.now ?? new Date().toISOString();
    const revisionId = (args.idFactory ?? (() => crypto.randomUUID()))();
    // The template travels WITH the family it belongs to, rather than being re-stamped
    // by the renderer — otherwise every résumé renders in the default no matter which
    // template was asked for.
    const templateId = normalizeResumeTemplateId(args.templateId) ?? DEFAULT_RESUME_TEMPLATE_ID;
    const original = {
        id: revisionId,
        kind: 'original',
        title: args.title.trim(),
        markdown: args.markdown.trim(),
        ...(args.document ? { document: deepClone(args.document), structuredStale: false } : {}),
        templateId,
        ...(args.templateDescriptor ? { templateDescriptor: deepClone(args.templateDescriptor) } : {}),
        pageSize: 'a4',
        orientation: 'portrait',
        ...(args.sourceFile ? { sourceFile: deepClone(args.sourceFile) } : {}),
        sourceRevisionId: null,
        createdAt: now,
        updatedAt: now,
    };
    return {
        version: 1,
        privacy: 'private',
        archivedAt: null,
        watched: false,
        defaultTemplateId: templateId,
        viewZoom: 75,
        previewMode: 'continuous',
        originalRevisionId: revisionId,
        activeRevisionId: revisionId,
        masterRevisionId: revisionId,
        revisions: [original],
    };
}
/** The revision the editor is on, degrading to the original then to the first. */
export function activeResumeRevision(family) {
    return family.revisions.find((revision) => revision.id === family.activeRevisionId)
        ?? family.revisions.find((revision) => revision.id === family.originalRevisionId)
        ?? family.revisions[0];
}
/**
 * The revision everything OUTSIDE the editor means by "their résumé" — a profile
 * embed, a public link, an application. Master first, then active, then original,
 * so a family that never had a master promoted still resolves to something real.
 */
export function masterResumeRevision(family) {
    return family.revisions.find((revision) => revision.id === family.masterRevisionId)
        ?? family.revisions.find((revision) => revision.id === family.activeRevisionId)
        ?? family.revisions.find((revision) => revision.id === family.originalRevisionId)
        ?? family.revisions[0];
}
/**
 * Validate an untrusted value as a family. Returns null rather than throwing: this
 * reads JSONB written by older builds, and a résumé that fails to parse must render
 * as "no résumé", never as a 500.
 */
export function resumeFamilyFromValue(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const family = value;
    if (!Array.isArray(family.revisions) || family.revisions.length === 0)
        return null;
    const revisions = family.revisions.filter((revision) => {
        if (!revision || typeof revision !== 'object' || Array.isArray(revision))
            return false;
        const row = revision;
        return typeof row.id === 'string' && typeof row.title === 'string' && typeof row.markdown === 'string';
    }).map((revision) => ({
        ...revision,
        templateId: normalizeResumeTemplateId(revision.templateId) ?? DEFAULT_RESUME_TEMPLATE_ID,
    }));
    if (revisions.length === 0)
        return null;
    const resolve = (candidate, fallback) => typeof candidate === 'string' && revisions.some((revision) => revision.id === candidate) ? candidate : fallback;
    const firstId = revisions[0].id;
    const originalRevisionId = resolve(family.originalRevisionId, firstId);
    return {
        version: 1,
        privacy: family.privacy ?? 'private',
        archivedAt: typeof family.archivedAt === 'string' ? family.archivedAt : null,
        watched: family.watched === true,
        defaultTemplateId: normalizeResumeTemplateId(family.defaultTemplateId) ?? DEFAULT_RESUME_TEMPLATE_ID,
        viewZoom: typeof family.viewZoom === 'number' ? family.viewZoom : 75,
        previewMode: family.previewMode ?? 'continuous',
        originalRevisionId,
        activeRevisionId: resolve(family.activeRevisionId, originalRevisionId),
        masterRevisionId: resolve(family.masterRevisionId, originalRevisionId),
        revisions,
    };
}
/** Privacy levels at which a résumé may be served to someone who is not its owner. */
const SHAREABLE_PRIVACY = new Set(['public', 'recruiter_only', 'connections']);
/**
 * Reduce a family to ONE deliberate snapshot for a public reader.
 *
 * Everything private is dropped rather than filtered at the edge: the revision
 * history (which names the jobs they applied for), and `sourceFile` (an R2 key).
 * The survivor is re-labelled as the only revision so a public viewer cannot tell
 * — or request — that others exist.
 */
export function projectPublicResumeFamily(value, opts = {}) {
    const family = resumeFamilyFromValue(value);
    if (!family || family.archivedAt)
        return null;
    const allowed = opts.audience === 'recruiter' ? SHAREABLE_PRIVACY : new Set(['public']);
    if (!allowed.has(family.privacy))
        return null;
    const selected = masterResumeRevision(family);
    const { sourceFile: _omitted, ...safe } = selected;
    return {
        ...family,
        watched: false,
        originalRevisionId: selected.id,
        activeRevisionId: selected.id,
        masterRevisionId: selected.id,
        revisions: [{ ...safe, kind: 'original', sourceRevisionId: null }],
    };
}
//# sourceMappingURL=resume.js.map