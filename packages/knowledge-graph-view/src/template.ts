/** Label templates: `{name}` placeholders, filled by the package (never the host's i18n runtime). */

/** `{name}` → params[name]; an unknown placeholder renders empty, never as braces. */
export function fillTemplate(template: string, params: Record<string, string | number | undefined>): string {
    return template.replace(/\{(\w+)\}/g, (_, name: string) => {
        const v = params[name];
        return v === undefined ? '' : String(v);
    }).replace(/\s{2,}/g, ' ').trim();
}

/** `clone-group` → `cloneGroup`; `knowledgeGraph.fix.cloneGroup` → `cloneGroup`. */
export function camelKind(kindOrKey: string): string {
    const tail = kindOrKey.slice(kindOrKey.lastIndexOf('.') + 1);
    return tail.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
