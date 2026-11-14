const YOUTUBE = { id: 'youtube', label: 'YouTube', requiresProvider: 'google' };
const SOCIAL = { id: 'social', label: 'Connected social accounts' };
const SITE = { id: 'site', label: 'Published site' };
const MARKETPLACE = { id: 'marketplace', label: 'Builderforce marketplace' };
/**
 * Provider-neutral creative capabilities owned by Builderforce. Canvas, Brain, MCP, web and
 * VS Code consume this contract; execution providers are adapters and are never encoded
 * into saved objects.
 *
 * ── WHAT CHANGED, AND WHY IT IS NARROWER ─────────────────────────────────────────
 * Every format below now names its producer, and the ones that named no producer are gone:
 *
 *   • `model3d` loses OBJ, STEP and GLB. `creativeRoutes` emits ASCII STL and nothing else;
 *     the OBJ/GLTF/GLB/STEP code beside it is an IMPORT reader.
 *   • `podcast` loses MP3, M4A, OGG, WAV and MP4. Its generator emits a Markdown script and
 *     says so in its own comment. Restoring them is an audio-render job, not a list edit.
 *   • `cad` loses SVG and PDF, which no adapter writes — the route emits DXF.
 *   • `resume` keeps Markdown (the generator) and PDF/DOCX (the server renderer), and loses
 *     HTML, which nothing produces as a download.
 *   • `comic` loses CBZ and `animation` loses APNG and animated WebP: those come from the
 *     tenant's studio model, which decides its own container, so listing them here asserted
 *     a guarantee this contract cannot make.
 *
 * `game` was already narrowed on 2026-08-07 and is unchanged: its five formats are what the
 * five target adapters actually produce.
 */
export const CREATIVE_CAPABILITIES = [
    {
        kind: 'video', capabilityId: 'creative.video', mediaKind: 'video',
        outputProfiles: [
            { format: 'MP4', extension: 'mp4', mimeType: 'video/mp4', producer: 'studioModel' },
            { format: 'WebM', extension: 'webm', mimeType: 'video/webm', producer: 'studioModel' },
        ],
        publishDestinations: [YOUTUBE, SOCIAL, SITE],
    },
    {
        kind: 'voice', capabilityId: 'creative.voice', mediaKind: 'voice',
        outputProfiles: [
            { format: 'MP3', extension: 'mp3', mimeType: 'audio/mpeg', producer: 'studioModel' },
            { format: 'WAV', extension: 'wav', mimeType: 'audio/wav', producer: 'studioModel' },
        ],
        publishDestinations: [SITE],
    },
    {
        kind: 'document', capabilityId: 'creative.document', mediaKind: 'document',
        outputProfiles: [
            { format: 'Markdown', extension: 'md', mimeType: 'text/markdown', producer: 'canvasExports' },
            { format: 'PDF', extension: 'pdf', mimeType: 'application/pdf', producer: 'exportsApi' },
            { format: 'DOCX', extension: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', producer: 'exportsApi' },
        ],
        publishDestinations: [SITE, MARKETPLACE],
    },
    {
        kind: 'slides', capabilityId: 'creative.presentation', mediaKind: 'presentation',
        outputProfiles: [
            { format: 'PPTX', extension: 'pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', producer: 'exportsApi' },
            { format: 'PDF', extension: 'pdf', mimeType: 'application/pdf', producer: 'exportsApi' },
        ],
        publishDestinations: [SITE, MARKETPLACE],
    },
    {
        kind: 'diagram', capabilityId: 'creative.diagram', mediaKind: 'diagram',
        outputProfiles: [
            { format: 'Draw.io XML', extension: 'drawio', mimeType: 'application/xml', producer: 'canvasExports' },
            { format: 'Mermaid', extension: 'mmd', mimeType: 'text/plain', producer: 'canvasExports' },
            { format: 'SVG', extension: 'svg', mimeType: 'image/svg+xml', producer: 'canvasExports' },
        ],
        publishDestinations: [SITE],
    },
    {
        kind: 'file', capabilityId: 'creative.file', mediaKind: 'file',
        outputProfiles: [
            { format: 'Original', extension: 'bin', mimeType: 'application/octet-stream', producer: 'canvasExports' },
        ],
        publishDestinations: [],
    },
    {
        kind: 'image', capabilityId: 'creative.image', mediaKind: 'image',
        outputProfiles: [
            { format: 'PNG', extension: 'png', mimeType: 'image/png', producer: 'studioModel' },
            { format: 'JPG', extension: 'jpg', mimeType: 'image/jpeg', producer: 'studioModel' },
        ],
        publishDestinations: [SOCIAL, SITE, MARKETPLACE],
    },
    {
        kind: 'animation', capabilityId: 'creative.animation', mediaKind: 'animation',
        outputProfiles: [
            { format: 'GIF', extension: 'gif', mimeType: 'image/gif', producer: 'studioModel' },
            { format: 'MP4', extension: 'mp4', mimeType: 'video/mp4', producer: 'studioModel' },
        ],
        publishDestinations: [SOCIAL, SITE],
    },
    {
        // The generator emits a Markdown SCRIPT and says so. Every audio container this
        // advertised was a format that never arrived; restoring one means shipping a render.
        kind: 'podcast', capabilityId: 'creative.podcast', mediaKind: 'podcast',
        outputProfiles: [
            { format: 'Markdown script', extension: 'md', mimeType: 'text/markdown', producer: 'creativeRoutes' },
        ],
        publishDestinations: [SITE],
    },
    {
        kind: 'comic', capabilityId: 'creative.comic', mediaKind: 'comic',
        outputProfiles: [
            { format: 'PNG', extension: 'png', mimeType: 'image/png', producer: 'studioModel' },
            { format: 'PDF', extension: 'pdf', mimeType: 'application/pdf', producer: 'exportsApi' },
        ],
        publishDestinations: [SOCIAL, SITE, MARKETPLACE],
    },
    {
        // Named for what the game targets actually produce (api/src/application/game/gameTarget).
        kind: 'game', capabilityId: 'creative.game', mediaKind: 'game',
        outputProfiles: [
            { format: 'HTML', extension: 'html', mimeType: 'text/html', producer: 'creativeRoutes' },
            { format: 'Web app', extension: 'zip', mimeType: 'application/zip', producer: 'gameTarget' },
            { format: 'Android APK', extension: 'apk', mimeType: 'application/vnd.android.package-archive', producer: 'gameTarget', pro: true },
            { format: 'iOS app', extension: 'zip', mimeType: 'application/zip', producer: 'gameTarget', pro: true },
            { format: 'Roblox place', extension: 'rbxlx', mimeType: 'application/xml', producer: 'gameTarget' },
        ],
        publishDestinations: [SITE, MARKETPLACE],
    },
    {
        kind: 'cad', capabilityId: 'creative.cad', mediaKind: 'cad',
        outputProfiles: [
            { format: 'DXF', extension: 'dxf', mimeType: 'application/dxf', producer: 'creativeRoutes' },
        ],
        publishDestinations: [MARKETPLACE],
    },
    {
        // ASCII STL, and only that. The OBJ/GLTF/GLB/STEP code in `creativeGeometry.ts` reads
        // those formats for IMPORT; nothing writes them.
        kind: 'model3d', capabilityId: 'creative.model3d', mediaKind: 'model3d',
        outputProfiles: [
            { format: 'STL', extension: 'stl', mimeType: 'model/stl', producer: 'creativeRoutes' },
        ],
        publishDestinations: [MARKETPLACE],
    },
    {
        kind: 'resume', capabilityId: 'creative.resume', mediaKind: 'document',
        outputProfiles: [
            { format: 'Markdown', extension: 'md', mimeType: 'text/markdown', producer: 'creativeRoutes' },
            { format: 'PDF', extension: 'pdf', mimeType: 'application/pdf', producer: 'exportsApi' },
            { format: 'DOCX', extension: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', producer: 'exportsApi' },
        ],
        publishDestinations: [],
    },
    {
        kind: 'template', capabilityId: 'creative.template', mediaKind: 'template',
        outputProfiles: [
            { format: 'JSON', extension: 'json', mimeType: 'application/json', producer: 'creativeRoutes' },
        ],
        publishDestinations: [MARKETPLACE],
    },
];
/**
 * The format LABELS one kind can produce — what `outputs` used to be, derived rather than
 * declared a second time.
 *
 * Kept as an accessor rather than a parallel field for the reason this whole merge exists:
 * a list of labels beside a list of profiles is two answers to one question, and the one
 * that drifts is always the one nothing validates.
 */
export function creativeOutputFormats(kind) {
    return CREATIVE_CAPABILITIES.find((entry) => entry.kind === kind)?.outputProfiles.map((profile) => profile.format) ?? [];
}
/** The profile for one format of one kind, or null. What a save menu resolves an
 *  extension and a mime type from, and what a paid gate reads `pro` off. */
export function creativeOutputProfile(kind, format) {
    const wanted = format.trim().toLowerCase();
    return CREATIVE_CAPABILITIES.find((entry) => entry.kind === kind)
        ?.outputProfiles.find((profile) => profile.format.toLowerCase() === wanted) ?? null;
}
/** Where one kind's artifacts can be sent. Empty for the kinds that are only downloaded. */
export function creativePublishDestinations(kind) {
    return CREATIVE_CAPABILITIES.find((entry) => entry.kind === kind)?.publishDestinations ?? [];
}
//# sourceMappingURL=creativeCapabilities.js.map