/**
 * The editor's handle on a LOCAL model for `local_research` — registered once at
 * activation (`editorResearchPort.ts`, which reads the local-model settings and so needs
 * `vscode`), read by the tool layer, which must stay `vscode`-free (the headless harness
 * runs it). Unregistered ⇒ no local research: the tool is not advertised.
 */
let port = null;
export function setLocalResearchPort(next) {
    port = next;
}
export function localResearchPort() {
    return port;
}
/** The catalog filter: `local_research` stays only while a local model can answer it. */
export async function withLocalResearch(defs) {
    const live = port ? await port.available().catch(() => false) : false;
    return live ? [...defs] : defs.filter((d) => d.name !== "local_research");
}
//# sourceMappingURL=researchPort.js.map