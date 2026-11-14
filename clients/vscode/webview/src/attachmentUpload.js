/**
 * The panel's half of an attachment's way to the model (`../../src/attachmentIngress.ts`
 * is the host's). A webview `blob:` URL is a preview the model cannot open, so:
 *
 *   • a TEXT file ("Add context" included) is recorded in the local store as before AND
 *     its text handed to the host, which inlines it into the turn under the mention
 *     budget (compressed first when it is long prose);
 *   • a picture the model receives INLINE (a data URL — `keepLocalThroughHost`) never
 *     leaves the machine: it is recorded in the local store only;
 *   • anything else is uploaded through the host with the extension's credential, so the
 *     turn names an object the platform can open. The host ADMITS it first (`admit`: Local
 *     only refuses every cloud upload, and a file over the platform's ceiling is refused
 *     before its bytes are encoded and posted). A non-picture that cannot be uploaded
 *     (signed out, Local only, too large, refused) fails with the host's sentence —
 *     attaching it would only put a dead link in front of the model. A picture can still
 *     ride inline as a data URL, so it is kept locally; asking to SIGN it (too large to
 *     inline) then refuses with the reason the upload failed (`AttachmentRefusedError`).
 *
 * The file's MIME type crosses the bridge as `mime`, never `type`: `type` is the frame's
 * envelope field (`bridgeTransport.ts`).
 */
import { AttachmentRefusedError, MAX_INLINE_TEXT_BYTES } from '@seanhogg/builderforce-brain-embedded';
/** Bytes sniffed for a NUL when the type does not already say text. */
const SNIFF_BYTES = 8_000;
const TEXT_TYPE = /^(text\/|application\/(json|ld\+json|xml|javascript|typescript|x-javascript|x-typescript|x-yaml|yaml|toml|x-toml|x-sh|x-shellscript|sql|graphql|x-httpd-php|x-python|x-ruby|x-perl|csv|x-ndjson))/i;
const BINARY_TYPE = /^(image|audio|video|font)\/|^application\/(pdf|zip|gzip|x-tar|x-7z|octet-stream|vnd\.|msword|x-msdownload)/i;
/**
 * The file's text, or null when it is not text (a binary type, too large, a NUL in its
 * head, or not valid UTF-8). An unknown type (`''`, common for `.ts`, `.md` drops) is
 * sniffed rather than trusted either way.
 */
export async function readAttachmentText(file) {
    // Bigger is never inlined as text: it is uploaded like any other file.
    if (file.size > MAX_INLINE_TEXT_BYTES)
        return null;
    const type = file.type ?? '';
    if (type && BINARY_TYPE.test(type) && !TEXT_TYPE.test(type))
        return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!TEXT_TYPE.test(type) && bytes.subarray(0, SNIFF_BYTES).includes(0))
        return null;
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    catch {
        return null;
    }
}
/** Base64 of a file's bytes, chunked so a large file does not overflow the call stack. */
export async function base64Of(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}
export function newAttachmentUploadState() {
    return { previews: new Map(), remote: new Map(), refused: new Map() };
}
const messageOf = (e) => (e instanceof Error ? e.message : String(e));
/** Record a file in the local store only, with the person's preview. */
async function keepLocal(file, ports, state) {
    const saved = await ports.manifest({ name: file.name, type: file.type, size: file.size });
    state.previews.set(saved.key, ports.preview(file));
    return saved;
}
/** A picture the model receives inline: recorded locally, never uploaded (see the header). */
export function keepLocalThroughHost(file, ports, state) {
    return keepLocal(file, ports, state);
}
/** Upload one attached file through the host (see the header). */
export async function uploadThroughHost(file, ports, state) {
    const text = await readAttachmentText(file);
    if (text !== null) {
        const saved = await keepLocal(file, ports, state);
        await ports.ingress({ op: 'store', key: saved.key, name: file.name, text });
        return saved;
    }
    try {
        // Admitted before a byte is read: Local only, or a file over the platform's ceiling,
        // is refused here rather than after a base64 copy of it has crossed the bridge.
        await ports.ingress({ op: 'admit', name: file.name, mime: file.type, size: file.size });
        const up = await ports.ingress({ op: 'upload', name: file.name, mime: file.type, data: await base64Of(file) });
        state.remote.set(up.key, up.url);
        state.previews.set(up.key, ports.preview(file));
        return { key: up.key, name: up.name, type: up.type };
    }
    catch (e) {
        if (!file.type.startsWith('image/'))
            throw e;
        const saved = await keepLocal(file, ports, state);
        state.refused.set(saved.key, messageOf(e));
        return saved;
    }
}
/** A signed URL for an uploaded picture; a refusal naming why when it was never uploaded. */
export async function signThroughHost(key, ports, state) {
    const refused = state.refused.get(key);
    if (refused)
        throw new AttachmentRefusedError(refused);
    return ports.ingress({ op: 'sign', key });
}
//# sourceMappingURL=attachmentUpload.js.map