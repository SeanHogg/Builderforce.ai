/**
 * Hybrid's on-device model, provisioned on first use (operator decision 2026-10-24,
 * replacing PRD 34's "downloads only from the picker" for this one case): the first
 * unpinned turn that runs local-first with no Bonsai cached starts ONE background
 * download of the Bonsai row this machine's engine serves best. That turn goes to the
 * cloud as it would have; once the file lands the host worker attaches and later turns
 * run on Bonsai — Synapse's engine, inside the editor.
 *
 * Which row: the largest recommended `bfi` row the engine's device record fits (its
 * GPU, else its CPU and RAM), up to {@link AUTO_PROVISION_MAX_BYTES} — a larger model is
 * the picker's to offer, never an unasked download.
 *
 * One attempt per session: a failure (offline, disk full) — or the person cancelling the
 * notification — is not retried until the next session; the picker can always download
 * by hand. Only with the native engine: the wasm fallback's CPU window is too small for
 * an agent turn to be worth the download.
 *
 * `vscode`-free (the progress UI is injected), so it is unit tested in the harness.
 */
import { localCatalogFor, localModelFit, } from "@builderforce/local-inference";
/** Bonsai 4B (572 MB) is the largest row downloaded without being asked. */
export const AUTO_PROVISION_MAX_BYTES = 600_000_000;
/** The row to provision on a device with `support`, or null when none fits. */
export function chooseAutoModel(support, rows = localCatalogFor("bfi")) {
    const fitting = rows.filter((row) => row.recommended &&
        row.source.kind === "hf-file" &&
        row.bytes <= AUTO_PROVISION_MAX_BYTES &&
        localModelFit(row, support).fits);
    return fitting.reduce((best, row) => (!best || row.bytes > best.bytes ? row : best), null);
}
export function createModelProvisioner(deps) {
    let attempted = false;
    const run = async () => {
        if (!deps.available())
            return;
        const rows = localCatalogFor("bfi").filter((row) => row.source.kind === "hf-file");
        const states = await Promise.all(rows.map((row) => deps.store.status(row.ref)));
        // Anything already cached (a picker download) is the user's choice: nothing to do.
        if (states.includes("ready"))
            return;
        const model = chooseAutoModel(await deps.support(), rows);
        if (!model)
            return;
        const abort = new AbortController();
        deps.report({ kind: "start", model, cancel: () => abort.abort() });
        try {
            await deps.store.download(model.ref, (fraction) => deps.report({ kind: "progress", fraction }), abort.signal);
        }
        catch (e) {
            deps.report(abort.signal.aborted ? { kind: "cancelled", model } : { kind: "failed", model, error: e instanceof Error ? e.message : String(e) });
            return;
        }
        deps.onReady();
        deps.report({ kind: "done", model });
    };
    return {
        ensure() {
            if (attempted)
                return;
            attempted = true;
            void run().catch((e) => console.error("[bfi] model provisioning failed:", e));
        },
    };
}
/** THE provisioner this extension host installed (`extension.ts`); routes ask it. */
let installed;
export const hostModelProvisioner = {
    /** Install `provisioner`; returns its uninstall. */
    install(provisioner) {
        installed = provisioner;
        return () => {
            if (installed === provisioner)
                installed = undefined;
        };
    },
    ensure() {
        installed?.ensure();
    },
};
//# sourceMappingURL=provision.js.map