/** Label templates: `{name}` placeholders, filled by the package (never the host's i18n runtime). */

type Params = Record<string, string | number | undefined>;

const isEmpty = (v: string | number | undefined): boolean => v === undefined || String(v).trim() === '';

/**
 * `{name}` → params[name]; an unknown placeholder renders empty, never as braces.
 *
 * `[[ … ]]` marks an OPTIONAL part: it is kept only when every placeholder inside it has a
 * value, and dropped whole otherwise — so a finding without a section reads
 * "Reconcile [[§{sectionA} of ]]{fileA}" → "Reconcile a.md", and a clone group without a
 * name has no dangling "clone group :". The part's own words stay in the catalog, so each
 * language decides where its connectors go.
 */
export function fillTemplate(template: string, params: Params): string {
    const withOptional = template.replace(/\[\[([\s\S]*?)\]\]/g, (_, part: string) => {
        const names = [...part.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
        return names.every((n) => !isEmpty(params[n])) ? part : '';
    });
    return withOptional.replace(/\{(\w+)\}/g, (_, name: string) => {
        const v = params[name];
        return v === undefined ? '' : String(v);
    }).replace(/\s{2,}/g, ' ').trim();
}

/** `clone-group` → `cloneGroup`; `knowledgeGraph.fix.cloneGroup` → `cloneGroup`. */
export function camelKind(kindOrKey: string): string {
    const tail = kindOrKey.slice(kindOrKey.lastIndexOf('.') + 1);
    return tail.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
