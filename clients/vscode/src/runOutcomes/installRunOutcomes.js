/**
 * The run-outcomes context's editor jobs (PRD 41 §D1), installed once by the run host (`brainRunHostPorts.ts`): per-run
 * commit attribution on every HEAD move (`commitAttribution.ts`) and the git-history labels pass over the open
 * repositories (`localLabels.ts`). The features are frozen by the run delta's `onStored` (`recordRunOutcome.ts`). Loaded
 * lazily, so the run host's construction never pulls git or the labellers in; `dispose` stops both.
 */
export function installRunOutcomes(deps) {
    const onError = (error) => deps.log(`[run outcomes] ${error instanceof Error ? error.message : String(error)}`);
    let disposed = false;
    const stops = [];
    void Promise.all([import("./commitAttribution"), import("./localLabels"), import("../gitApi")]).then(([attribution, labels, git]) => {
        if (disposed)
            return;
        const watch = attribution.watchCommitAttribution({ store: deps.store, deviceId: deps.deviceId, onError });
        stops.push(() => watch.dispose());
        const roots = async () => ((await git.getGitApi())?.repositories ?? []).map((r) => r.rootUri.fsPath);
        stops.push(labels.scheduleLocalLabels({ store: deps.store, deviceId: deps.deviceId, roots, onError }));
    }, onError);
    return {
        dispose() {
            disposed = true;
            for (const stop of stops.splice(0))
                stop();
        },
    };
}
//# sourceMappingURL=installRunOutcomes.js.map