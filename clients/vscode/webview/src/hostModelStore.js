export function createHostModelStore(bridge) {
    return {
        async status(ref) {
            try {
                return await bridge.request('modelFile.status', { ref });
            }
            catch {
                return 'absent';
            }
        },
        async open(ref) {
            const { handle, bytes } = await bridge.request('modelFile.open', { ref });
            const stream = new ReadableStream({
                async pull(controller) {
                    const chunk = await bridge.request('modelFile.read', { handle });
                    if (!chunk || chunk.byteLength === 0)
                        controller.close();
                    else
                        controller.enqueue(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
                },
                cancel() {
                    bridge.post('modelFile.close', { handle });
                },
            });
            return { stream, bytes };
        },
        async download(ref, onProgress, signal) {
            if (signal?.aborted)
                throw signal.reason ?? new DOMException('Aborted', 'AbortError');
            // Unique across every panel the host serves (the host keys its downloads by it).
            const handle = `d-${crypto.randomUUID()}`;
            await new Promise((resolve, reject) => {
                const off = bridge.onEvent((event) => {
                    if (event.handle !== handle)
                        return;
                    if (event.type === 'modelFile.progress') {
                        onProgress?.(event.fraction);
                        return;
                    }
                    off();
                    signal?.removeEventListener('abort', abort);
                    if (event.ok)
                        resolve();
                    else
                        reject(new Error(event.error ?? 'download_failed'));
                });
                const abort = () => bridge.post('modelFile.cancel', { handle });
                signal?.addEventListener('abort', abort, { once: true });
                // Listening already, so the download's events cannot outrun this request.
                bridge.request('modelFile.download', { ref, handle }).catch((e) => {
                    off();
                    signal?.removeEventListener('abort', abort);
                    reject(e instanceof Error ? e : new Error(String(e)));
                });
            });
        },
        async remove(ref) {
            await bridge.request('modelFile.remove', { ref });
        },
    };
}
//# sourceMappingURL=hostModelStore.js.map