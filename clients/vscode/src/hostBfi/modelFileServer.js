/**
 * The host half of the model-file frames (`pageEngineBridgeProtocol.ts`): the chat
 * webview's `bfi` model store is a view of this file cache, so in the editor a model is
 * downloaded ONCE — here — and both the webview's engine (streaming the bytes back) and
 * the host's own `bfi` worker load the same file.
 *
 * Reads are pulled a chunk per request (the webview asks for the next only when its
 * engine took the last), so a gigabyte never queues up in the webview. A download runs
 * here and reports progress as events; `onChange` fires after every download or removal
 * (the host worker re-reads its cache). `modelFile.support` answers the host worker's
 * support record (`support`), so the webview's picker can offer a model that only the
 * host's CPU engine can run.
 *
 * Node only (through `FileModelStore`) — never imported by a webview-reachable file.
 */
import { isModelFileRequest, } from "../pageEngineBridgeProtocol";
const errorText = (e) => (e instanceof Error ? e.message : String(e));
export function createModelFileServer(store, onChange, support = () => Promise.reject(new Error("no bfi engine on this host"))) {
    let seq = 0;
    const reads = new Map();
    const close = (handle) => {
        const entry = reads.get(handle);
        reads.delete(handle);
        void entry?.reader.cancel().catch(() => undefined);
    };
    const downloads = new Map();
    const newHandle = (kind) => `${kind}${++seq}`;
    async function answer(request, io) {
        switch (request.type) {
            case "modelFile.status":
                return store.status(request.ref);
            case "modelFile.open": {
                const { stream, bytes } = await store.open(request.ref);
                const handle = newHandle("r");
                reads.set(handle, { reader: stream.getReader(), ...(io.owner ? { owner: io.owner } : {}) });
                return { handle, bytes };
            }
            case "modelFile.read": {
                const reader = reads.get(request.handle)?.reader;
                if (!reader)
                    return null;
                const next = await reader.read();
                if (next.done) {
                    reads.delete(request.handle);
                    return null;
                }
                return next.value;
            }
            case "modelFile.remove":
                await store.remove(request.ref);
                onChange();
                return true;
            case "modelFile.download": {
                const { handle } = request;
                const controller = new AbortController();
                downloads.set(handle, controller);
                void store
                    .download(request.ref, (fraction) => io.post({ type: "modelFile.progress", handle, fraction }), controller.signal)
                    .then(() => io.post({ type: "modelFile.downloaded", handle, ok: true }), (e) => io.post({ type: "modelFile.downloaded", handle, ok: false, error: errorText(e) }))
                    .finally(() => {
                    downloads.delete(handle);
                    onChange();
                });
                return true;
            }
            case "modelFile.support":
                return support();
            case "modelFile.close":
                close(request.handle);
                return undefined;
            case "modelFile.cancel":
                downloads.get(request.handle)?.abort();
                return undefined;
        }
    }
    return {
        handle(message, io) {
            if (!isModelFileRequest(message))
                return false;
            const id = message.id;
            answer(message, io).then((result) => {
                if (id)
                    io.respond(id, true, result);
            }, (e) => {
                if (id)
                    io.respond(id, false, undefined, errorText(e));
            });
            return true;
        },
        release(owner) {
            for (const [handle, entry] of [...reads])
                if (entry.owner === owner)
                    close(handle);
        },
        dispose() {
            for (const handle of [...reads.keys()])
                close(handle);
            for (const controller of downloads.values())
                controller.abort();
            downloads.clear();
        },
    };
}
//# sourceMappingURL=modelFileServer.js.map