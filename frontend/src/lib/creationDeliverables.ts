import { brandDirective, type BrandBinding } from '@builderforce/creation-canvas-contract';
import { apiRequest } from './apiClient';
import { dxfPreviewSvg, meshFormatFromHint, stlPreviewSvg, svgDataUrl, type MeshFormat } from './creativeGeometry';
import { gamePosterDataUrl } from './gamePoster';
import type { CreationNodeData } from '@/components/creation-canvas/types';
import { websitePagesFrom, websiteThemeFrom, type WebsiteSection } from '@/components/creation-canvas/websiteWysiwyg';

export type CreationDeliverableStatus = 'running' | 'delivered' | 'failed';

/** One transport-neutral record for every artifact Canvas actually produces. */
export interface CreationDeliverable {
  id: string;
  action: string;
  artifactKind: string;
  status: CreationDeliverableStatus;
  createdAt: string;
  completedAt?: string;
  url?: string;
  pathUrl?: string;
  mimeType?: string;
  fileName?: string;
  provider?: string;
  resourceRef?: string;
  validation?: { status: 'passed' | 'failed' | 'not_run'; detail?: string };
  metadata?: Record<string, unknown>;
  error?: string;
}

export function creationDeliverables(data: CreationNodeData): CreationDeliverable[] {
  return Array.isArray(data.deliverables)
    ? data.deliverables.filter((item): item is CreationDeliverable => !!item && typeof item === 'object' && typeof (item as CreationDeliverable).id === 'string')
    : [];
}

export function withCreationDeliverable(data: CreationNodeData, deliverable: CreationDeliverable): CreationDeliverable[] {
  return [deliverable, ...creationDeliverables(data).filter((item) => item.id !== deliverable.id)].slice(0, 50);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
}

function safeColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#3978f6';
}

function fileSafe(value: unknown): string {
  return String(value || 'builderforce-artifact').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'builderforce-artifact';
}

function textDataUrl(mimeType: string, value: string): string {
  return `data:${mimeType};charset=utf-8,${encodeURIComponent(value)}`;
}

/**
 * A URL a new tab is actually allowed to open.
 *
 * Browsers block a top-level navigation to a `data:` URL, so opening a generated
 * artifact by its own URL lands on a blank tab. The conversion is deliberately
 * synchronous — going through `fetch` would put an await between the click and
 * `window.open`, which costs the user gesture and trades a blocked navigation for
 * a blocked popup. Returns the URL unchanged when it is already navigable, so the
 * caller has one code path.
 */
export function navigableArtifactUrl(url: string): string {
  const match = /^data:([^,]*),/.exec(url);
  if (!match || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') return url;
  const parameters = match[1]!.split(';');
  const mimeType = parameters[0] || 'application/octet-stream';
  const payload = url.slice(match[0].length);
  try {
    const body = parameters.includes('base64')
      ? Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))
      : decodeURIComponent(payload);
    return URL.createObjectURL(new Blob([body], { type: mimeType }));
  } catch {
    return url;
  }
}

export interface BrowserCreativeArtifact {
  artifactKind: string;
  fileName: string;
  mimeType: string;
  url: string;
  outputFormat: string;
  validationDetail: string;
  /**
   * A picture of the artifact, when the artifact itself is not one. A DXF or an
   * STL cannot be the `src` of an image, so the geometry is drawn back instead of
   * the export being pointed at a tile that can only fail to load.
   */
  previewImageUrl?: string;
}

const IMAGE_DATA_URL = /^data:image\//i;
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#]|$)/i;

/** Whether a URL is something an `<img>` can actually display. */
export function isDisplayableImageUrl(url: string): boolean {
  const value = url.trim();
  if (!value) return false;
  if (value.startsWith('data:')) return IMAGE_DATA_URL.test(value);
  if (value.startsWith('blob:')) return true;
  return IMAGE_FILE.test(value);
}

/**
 * The one rule for what a creative object shows on its preview tile.
 *
 * `thumbnailUrl` is authored as a picture, so it is trusted. `outputUrl` is the
 * exported deliverable, which is a picture only for some kinds — using it blindly
 * is what renders a broken image for CAD, 3D, game, resume and podcast objects.
 * Both the node body and the 3D view read this, so they cannot disagree.
 */
export function creativePreviewImageUrl(data: CreationNodeData): string | null {
  const thumbnail = typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl.trim() : '';
  if (thumbnail) return thumbnail;
  const output = typeof data.outputUrl === 'string' ? data.outputUrl.trim() : '';
  return output && isDisplayableImageUrl(output) ? output : null;
}

/**
 * The mesh a creative object exported, when it exported one.
 *
 * A picture of a model keeps the angle it was drawn at; the geometry does not, so
 * a view that can turn the object asks for this instead of the thumbnail. The
 * format is read from whatever the object recorded about its own export — file
 * name, media type, or the format label — before falling back to the URL, so a
 * `data:` deliverable is recognised as readily as a stored file.
 */
export function creativeMeshGeometry(data: CreationNodeData): { url: string; format: MeshFormat } | null {
  const url = typeof data.outputUrl === 'string' ? data.outputUrl.trim() : '';
  if (!url) return null;
  const declared = [data.outputFileName, data.outputMimeType, data.outputFormat]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  const format = meshFormatFromHint(declared) ?? meshFormatFromHint(url);
  return format ? { url, format } : null;
}

/** A closed, manifold box — the smallest solid an STL can honestly claim to be. */
function asciiStlBox(name: string, [width, depth, height]: [number, number, number]): string {
  const corner = (x: number, y: number, z: number): [number, number, number] => [x * width, y * depth, z * height];
  const quads: Array<[number, number, number][]> = [
    [corner(0, 0, 0), corner(0, 1, 0), corner(1, 1, 0), corner(1, 0, 0)],
    [corner(0, 0, 1), corner(1, 0, 1), corner(1, 1, 1), corner(0, 1, 1)],
    [corner(0, 0, 0), corner(1, 0, 0), corner(1, 0, 1), corner(0, 0, 1)],
    [corner(1, 0, 0), corner(1, 1, 0), corner(1, 1, 1), corner(1, 0, 1)],
    [corner(1, 1, 0), corner(0, 1, 0), corner(0, 1, 1), corner(1, 1, 1)],
    [corner(0, 1, 0), corner(0, 0, 0), corner(0, 0, 1), corner(0, 1, 1)],
  ];
  const facet = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const length = Math.hypot(cross[0]!, cross[1]!, cross[2]!) || 1;
    const normal = cross.map((component) => Number((component / length).toFixed(6))).join(' ');
    const vertex = (point: [number, number, number]) => `vertex ${point.join(' ')}`;
    return `facet normal ${normal}\nouter loop\n${vertex(a)}\n${vertex(b)}\n${vertex(c)}\nendloop\nendfacet`;
  };
  const facets = quads.flatMap(([a, b, c, d]) => [facet(a!, b!, c!), facet(a!, c!, d!)]);
  return `solid ${name}\n${facets.join('\n')}\nendsolid ${name}`;
}

/** A closed outline with a bored hole — a drawing with a feature in it, not just a box. */
function dxfPlate([width, height]: [number, number], radius: number): string {
  const polyline = ['0', 'LWPOLYLINE', '8', '0', '90', '4', '70', '1', '10', '0', '20', '0', '10', String(width), '20', '0', '10', String(width), '20', String(height), '10', '0', '20', String(height)];
  const circle = ['0', 'CIRCLE', '8', '0', '10', String(width / 2), '20', String(height / 2), '40', String(radius)];
  return ['0', 'SECTION', '2', 'ENTITIES', ...polyline, ...circle, '0', 'ENDSEC', '0', 'EOF', ''].join('\n');
}

/** Produce a real, portable baseline artifact without claiming an unavailable
 * binary encoder. Provider renderers can replace these outputs later. */
export function buildBrowserCreativeArtifact(data: CreationNodeData, brand?: BrandBinding): BrowserCreativeArtifact {
  const kind = data.kind;
  const title = String(data.title || kind);
  const brief = String(data.prompt || data.content || data.subtitle || title);
  const stem = fileSafe(title);
  const escapedTitle = escapeHtml(title);
  const escapedBrief = escapeHtml(brief);
  // The baseline's own palette, OVERRIDDEN by the bound brand when there is one.
  //
  // The browser fallback is not a mock-up: it is the artifact a guest session, an
  // unavailable model or a failed call actually ends up with, and it ships to whoever
  // the person sends it to. An offline fallback that ignored the brand would be the one
  // path on the canvas that reliably produced off-brand output, which is the opposite of
  // what a fallback is for. Two stops and an accent, because that is all this poster
  // draws — a palette with fewer entries falls back per slot rather than all-or-nothing.
  const palette = brand?.palette ?? [];
  const ink = (index: number, fallback: string) => escapeHtml(palette[index] ?? fallback);
  const [stopA, stopB, accent] = [ink(0, '#202b5f'), ink(1, '#7c4dff'), ink(2, '#ffb35c')];
  const face = brand?.typography?.[0] ? `${escapeHtml(brand.typography[0])},system-ui,sans-serif` : 'system-ui,sans-serif';
  const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${stopA}"/><stop offset="1" stop-color="${stopB}"/></linearGradient></defs><rect width="1200" height="675" rx="32" fill="url(#g)"/>${body}<text x="70" y="555" fill="white" font-family="${face}" font-size="58" font-weight="750">${escapedTitle}</text><text x="70" y="610" fill="#ddd7ff" font-family="${face}" font-size="24">${escapedBrief.slice(0, 86)}</text></svg>`;
  if (kind === 'image' || kind === 'comic') {
    const content = svg(kind === 'comic' ? '<g fill="#fff" opacity=".92"><rect x="70" y="70" width="310" height="390" rx="18"/><rect x="445" y="70" width="310" height="390" rx="18"/><rect x="820" y="70" width="310" height="390" rx="18"/></g>' : `<circle cx="600" cy="290" r="180" fill="#fff" opacity=".88"/><circle cx="650" cy="250" r="110" fill="${accent}"/>`);
    const url = textDataUrl('image/svg+xml', content);
    return { artifactKind: kind, fileName: `${stem}.svg`, mimeType: 'image/svg+xml', url, outputFormat: 'SVG', validationDetail: 'Valid standalone SVG generated in the browser', previewImageUrl: url };
  }
  if (kind === 'animation') {
    const content = `<!doctype html><meta charset="utf-8"><title>${escapedTitle}</title><style>html,body{height:100%;margin:0;background:#11152b;overflow:hidden}.orb{position:absolute;width:22vmin;aspect-ratio:1;border-radius:50%;background:linear-gradient(135deg,#ffb35c,#7c4dff);animation:move 4s ease-in-out infinite alternate;box-shadow:0 0 80px #7c4dff88}@keyframes move{from{transform:translate(20vw,20vh) scale(.7)}to{transform:translate(65vw,55vh) scale(1.4)}}h1{position:absolute;color:white;font:700 6vw system-ui;left:6vw;bottom:8vh}</style><div class="orb"></div><h1>${escapedTitle}</h1>`;
    return { artifactKind: kind, fileName: `${stem}.html`, mimeType: 'text/html', url: textDataUrl('text/html', content), outputFormat: 'HTML', validationDetail: 'Self-contained animated HTML generated in the browser' };
  }
  if (kind === 'game') {
    // The offline baseline. It is a real, playable game rather than a mock-up —
    // a tap target that moves and has to be caught — because this is what a
    // guest session or a failed generator ends up with, and every game target
    // (the phone install, the APK) ships whatever document is here. It handles
    // BOTH keyboard and touch for the same reason.
    const content = `<!doctype html><html><head><meta charset="utf-8"><title>${escapedTitle}</title>`
      + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">'
      + '<style>html,body{height:100%;margin:0;overflow:hidden;background:#0b0e1a;color:#fff;'
      + 'font:16px/1.4 system-ui,sans-serif;-webkit-user-select:none;user-select:none;touch-action:manipulation}'
      + '#hud{position:fixed;top:max(12px,env(safe-area-inset-top));left:0;right:0;text-align:center;'
      + 'font-size:clamp(18px,4vw,28px);font-weight:700;pointer-events:none}'
      + '#brief{position:fixed;bottom:max(16px,env(safe-area-inset-bottom));left:0;right:0;text-align:center;'
      + 'opacity:.6;font-size:clamp(12px,3vw,16px);padding:0 8vw;pointer-events:none}'
      + '#t{position:absolute;width:clamp(56px,16vmin,120px);aspect-ratio:1;border-radius:50%;'
      + 'background:radial-gradient(circle at 35% 30%,#ffd98a,#f5a623);box-shadow:0 6px 24px #f5a62366;'
      + 'display:grid;place-items:center;font-size:clamp(24px,7vmin,48px);cursor:pointer}</style></head>'
      + `<body><div id="hud">Score <span id="s">0</span> &middot; <span id="c">20</span>s</div>`
      + `<div id="t">&#9733;</div><div id="brief">${escapedBrief}</div>`
      + '<script>(function(){var s=0,left=20,t=document.getElementById("t"),'
      + 'sc=document.getElementById("s"),cd=document.getElementById("c");'
      + 'function move(){var w=t.offsetWidth||80;'
      + 't.style.left=Math.random()*(innerWidth-w)+"px";t.style.top=(60+Math.random()*(innerHeight-w-140))+"px";}'
      + 'function hit(e){e.preventDefault();if(left<=0)return;s++;sc.textContent=s;move();}'
      + 't.addEventListener("pointerdown",hit);'
      + 'addEventListener("keydown",function(e){if(e.key===" "||e.key==="Enter")hit(e);});'
      + 'move();addEventListener("resize",move);'
      + 'var tick=setInterval(function(){left--;cd.textContent=left;if(left<=0){clearInterval(tick);'
      + 't.textContent="\\u21BB";t.onpointerdown=function(){location.reload()};'
      + 'document.getElementById("hud").textContent="Final score "+s+" \\u2014 tap to play again";}},1000);'
      + '})();</script></body></html>';
    return {
      artifactKind: kind,
      fileName: `${stem}.html`,
      mimeType: 'text/html',
      url: textDataUrl('text/html', content),
      outputFormat: 'HTML',
      validationDetail: 'Self-contained playable HTML game generated in the browser; keyboard and touch',
      previewImageUrl: gamePosterDataUrl({ title, brief, html: content }),
    };
  }
  if (kind === 'cad') {
    const dxf = dxfPlate([100, 60], 14);
    const preview = dxfPreviewSvg(dxf);
    return {
      artifactKind: kind, fileName: `${stem}.dxf`, mimeType: 'application/dxf', url: textDataUrl('application/dxf', dxf), outputFormat: 'DXF',
      validationDetail: 'Closed 100 × 60 unit DXF profile with a Ø28 bore, generated and drawn back in the browser',
      ...(preview ? { previewImageUrl: svgDataUrl(preview) } : {}),
    };
  }
  if (kind === 'model3d') {
    const stl = asciiStlBox(stem, [100, 60, 40]);
    const preview = stlPreviewSvg(stl);
    return {
      artifactKind: kind, fileName: `${stem}.stl`, mimeType: 'model/stl', url: textDataUrl('model/stl', stl), outputFormat: 'STL',
      validationDetail: 'Closed 12-facet ASCII STL solid generated and rendered back in the browser',
      ...(preview ? { previewImageUrl: svgDataUrl(preview) } : {}),
    };
  }
  if (kind === 'resume') {
    const markdown = `# ${title}\n\n${brief}\n\n## Experience\n\n- Add measurable achievement\n\n## Skills\n\n- Add relevant skills\n`;
    return { artifactKind: kind, fileName: `${stem}.md`, mimeType: 'text/markdown', url: textDataUrl('text/markdown', markdown), outputFormat: 'Markdown', validationDetail: 'Portable Markdown resume generated in the browser' };
  }
  if (kind === 'podcast') {
    const script = `# ${title}\n\n## Episode brief\n\n${brief}\n\n## Opening\n\nWelcome to ${title}.\n\n## Production notes\n\nRecord, edit, and approve this script before audio export.\n`;
    return { artifactKind: 'podcast-script', fileName: `${stem}-script.md`, mimeType: 'text/markdown', url: textDataUrl('text/markdown', script), outputFormat: 'Markdown script', validationDetail: 'Production-ready podcast script generated; no audio render is claimed' };
  }
  const template = JSON.stringify({ schema: 'builderforce.creative-template/v1', kind, title, brief, templateId: data.templateId || null, createdAt: new Date().toISOString() }, null, 2);
  return { artifactKind: kind, fileName: `${stem}.json`, mimeType: 'application/json', url: textDataUrl('application/json', template), outputFormat: 'JSON', validationDetail: 'Valid Builderforce creative template manifest generated in the browser' };
}

/* ---------- generated creative artifacts ---------- */

/**
 * A creative deliverable and where it came from.
 *
 * One shape for all three generators — the server, the tenant's own Evermind model,
 * and the browser baseline — so the canvas attaches a deliverable the same way
 * whichever produced it, and the only difference the user sees is `provider`.
 */
export interface CreativeArtifact extends BrowserCreativeArtifact {
  provider: string;
  /** Which model authored it, when a model did. */
  model?: string;
  /** The generator's own account of what it made, when it gave one. */
  summary?: string;
}

/**
 * Kinds the server generator answers for.
 *
 * Geometry is authored as a parametric spec and evaluated server-side; the text
 * kinds are authored directly and shape-checked. See `api/.../creativeRoutes`.
 */
export const SERVER_CREATIVE_KINDS = new Set(['cad', 'model3d', 'game', 'resume', 'podcast', 'template']);
/** Kinds rendered by the tenant's own published Evermind media model. */
export const EVERMIND_CREATIVE_KINDS = new Set(['image', 'comic', 'animation']);

interface GeneratedCreativeResponse {
  artifactKind: string;
  fileName: string;
  mimeType: string;
  outputFormat: string;
  content: string;
  provider: string;
  model: string;
  validationDetail: string;
  summary: string | null;
}

/**
 * The brief a creative object was given, wherever the author typed it — plus the brand
 * it must be composed for.
 *
 * ── WHY THE BRAND RIDES THE BRIEF ────────────────────────────────────────────────
 * Every generative path on the canvas converges here: the Evermind media call, the
 * server generator, the game targets and the browser baseline all ask this function what
 * to make. That makes it the ONE place a brand binding can be applied without seventeen
 * call sites each remembering to. Before this, `image`, `video`, `animation`, `comic`,
 * `podcast`, `website`, `prototype`, `emailTemplate` and `socialCampaign` all reached a
 * generator with no palette, no logo, no typography, no voice and no claim list, so the
 * output was per-object plausible and cross-object inconsistent — the failure that makes
 * a generative marketing tool unusable at brand scale.
 *
 * The binding is OPTIONAL and absent means unbranded, exactly as before: a board with no
 * `brandKit` on it composes the way it always did.
 */
export function creativeBrief(data: CreationNodeData, brand?: BrandBinding): string {
  let brief = String(data.title ?? '').trim();
  for (const candidate of [data.prompt, data.content, data.subtitle]) {
    if (typeof candidate === 'string' && candidate.trim()) { brief = candidate.trim(); break; }
  }
  const directive = brandDirective(brand);
  return directive ? `${brief}

${directive}` : brief;
}

/**
 * Generate a creative deliverable with the server generator.
 *
 * Rejects rather than degrading: the caller decides whether an unavailable
 * generator means "try the browser baseline" (it does) — that choice belongs with
 * the canvas, which is the thing that has to end up with a file either way.
 */
export async function generateServerCreativeArtifact(data: CreationNodeData, brand?: BrandBinding): Promise<CreativeArtifact> {
  const generated = await apiRequest<GeneratedCreativeResponse>('/api/creative/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: data.kind,
      title: String(data.title ?? data.kind),
      brief: creativeBrief(data, brand),
      ...(typeof data.templateId === 'string' && data.templateId ? { templateId: data.templateId } : {}),
      // A game's PLATFORM changes the machine it is authored for, not just the
      // file extension — Roblox is Luau on a server-authoritative engine, not a
      // document in a browser. Carried on the object so regenerating a Roblox
      // game does not silently produce an HTML one.
      ...(data.kind === 'game' && typeof data.gamePlatform === 'string' ? { platform: data.gamePlatform } : {}),
    }),
  });
  // Geometry is not an image, so the file is drawn back rather than pointed at —
  // the same reader the 3D view uses, so the tile and the space agree.
  const preview = generated.artifactKind === 'cad'
    ? dxfPreviewSvg(generated.content)
    : generated.artifactKind === 'model3d' ? stlPreviewSvg(generated.content) : null;
  // A game is a program, and the frame that runs it is origin-isolated, so its
  // pixels genuinely cannot be read from here. The poster is built from what the
  // document declares about itself instead — including which inputs it actually
  // binds, which is the thing worth knowing before shipping it to a phone.
  const poster = generated.artifactKind === 'game' || generated.artifactKind === 'roblox-place'
    ? gamePosterDataUrl({
      title: String(data.title ?? 'Game'),
      brief: creativeBrief(data, brand),
      // A place file has no input handlers to read, so the poster omits the
      // control badges rather than guessing at them.
      ...(generated.artifactKind === 'game' ? { html: generated.content } : {}),
    })
    : null;
  return {
    artifactKind: generated.artifactKind,
    fileName: generated.fileName,
    mimeType: generated.mimeType,
    outputFormat: generated.outputFormat,
    url: textDataUrl(generated.mimeType, generated.content),
    validationDetail: generated.validationDetail,
    provider: generated.provider,
    model: generated.model,
    ...(preview ? { previewImageUrl: svgDataUrl(preview) } : poster ? { previewImageUrl: poster } : {}),
    ...(generated.summary ? { summary: generated.summary } : {}),
  };
}

/**
 * Turn frames a published Evermind model rendered into a creative deliverable.
 *
 * A still kind keeps the first frame as a PNG. An animation keeps ALL of them in
 * a self-contained page that plays them back — the point of the kind is motion,
 * and a single frame of a generated sequence is a screenshot of the deliverable
 * rather than the deliverable. Null when the frames cannot be decoded here, which
 * is the caller's signal to fall back.
 */
export function evermindMediaArtifact(
  data: CreationNodeData,
  media: EvermindMediaResult,
  modelSlug: string,
): CreativeArtifact | null {
  const kind = String(data.kind);
  const stem = fileSafe(data.title);
  const frames = media.frames
    .map((frame) => mediaFrameDataUrl(frame, media.width, media.height, media.channels))
    .filter((frame): frame is string => !!frame);
  if (!frames.length) return null;

  const common = { provider: 'evermind', model: modelSlug };
  if (kind !== 'animation') {
    return {
      ...common,
      artifactKind: kind,
      fileName: `${stem}.png`,
      mimeType: 'image/png',
      url: frames[0]!,
      outputFormat: 'PNG',
      validationDetail: `${media.width}×${media.height} frame rendered by ${modelSlug}`,
      previewImageUrl: frames[0]!,
    };
  }
  const escapedTitle = escapeHtml(data.title);
  const page = `<!doctype html><meta charset="utf-8"><title>${escapedTitle}</title>`
    + '<style>html,body{height:100%;margin:0;background:#11152b;display:grid;place-items:center}'
    + 'img{max-width:100vw;max-height:100vh;image-rendering:pixelated}'
    + 'h1{position:fixed;left:4vw;bottom:5vh;margin:0;color:#fff;font:700 4vw system-ui}</style>'
    + `<img id="f" alt="${escapedTitle}"><h1>${escapedTitle}</h1>`
    + `<script>const frames=${JSON.stringify(frames)};let i=0;const img=document.getElementById('f');`
    + 'const tick=()=>{img.src=frames[i++%frames.length]};tick();setInterval(tick,1000/12);</script>';
  return {
    ...common,
    artifactKind: kind,
    fileName: `${stem}.html`,
    mimeType: 'text/html',
    url: textDataUrl('text/html', page),
    outputFormat: 'HTML',
    validationDetail: `${frames.length} ${media.width}×${media.height} frames rendered by ${modelSlug} and played back at 12 fps`,
    previewImageUrl: frames[0]!,
  };
}

/** Build a complete, dependency-free site from an authored Website object. */
export function buildWebsiteAssets(data: CreationNodeData): Array<{ path: string; data: Uint8Array }> {
  const title = escapeHtml(data.title || 'Created with Builderforce');
  const pages = websitePagesFrom(data);
  const theme = websiteThemeFrom(data);
  const headline = escapeHtml(data.websiteHeadline || data.title || 'Bring your idea to life');
  const body = escapeHtml(data.websiteBody || data.content || data.subtitle || 'Created collaboratively in Builderforce.');
  const cta = escapeHtml(data.websiteCta || 'Get started');
  const accent = safeColor(theme.accent || data.websiteAccent);
  const background = safeColor(theme.background || '#f7f4ef');
  const foreground = safeColor(theme.foreground || '#171717');
  const sectionHtml = (section: WebsiteSection): string => {
    const heading = section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : '';
    const copy = section.body ? `<p>${escapeHtml(section.body)}</p>` : '';
    if (section.kind === 'hero') return `<section class="hero"><div>${section.eyebrow ? `<small>${escapeHtml(section.eyebrow)}</small>` : ''}<h1>${escapeHtml(section.heading)}</h1>${copy}<span>${section.cta ? `<a class="cta" href="#contact">${escapeHtml(section.cta)}</a>` : ''}${section.secondaryCta ? `<a class="secondary" href="#content">${escapeHtml(section.secondaryCta)}</a>` : ''}</span></div><aside aria-hidden="true"><i></i><i></i><i></i></aside></section>`;
    if (section.kind === 'features') return `<section class="content" id="content">${heading}${copy}<div class="features">${(section.items || []).map((item, index) => `<article><b>${String(index + 1).padStart(2, '0')}</b><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p></article>`).join('')}</div></section>`;
    if (section.kind === 'stats') return `<section class="stats">${(section.items || []).map((item) => `<span><strong>${escapeHtml(item.value)}</strong><small>${escapeHtml(item.label)}</small></span>`).join('')}</section>`;
    if (section.kind === 'testimonial') return `<section class="quote"><blockquote>“${escapeHtml(section.quote || section.body)}”</blockquote>${section.author ? `<cite>${escapeHtml(section.author)}</cite>` : ''}</section>`;
    if (section.kind === 'cta') return `<section class="final" id="contact">${heading}${copy}${section.cta ? `<a href="mailto:hello@example.com">${escapeHtml(section.cta)}</a>` : ''}</section>`;
    return `<section class="content">${heading}${copy}</section>`;
  };
  if (pages.length) {
    const encoder = new TextEncoder();
    const nav = pages.map((page) => `<a href="${page.path === '/' ? '/' : `${page.path.replace(/\/$/, '')}/`}">${escapeHtml(page.name)}</a>`).join('');
    const assets = pages.map((page, index) => {
      const pageTitle = `${escapeHtml(page.name)} · ${title}`;
      const description = page.sections.find((section) => section.body)?.body || data.content || data.subtitle || data.title;
      const html = `<!doctype html><html lang="en" data-theme="${theme.style}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${pageTitle}</title><meta name="description" content="${escapeHtml(String(description).slice(0, 155))}"><link rel="stylesheet" href="${index === 0 ? '' : '../'}styles.css"></head><body><nav><strong>${title}</strong><span>${nav}</span></nav><main>${page.sections.map(sectionHtml).join('')}</main><footer>${title}</footer></body></html>`;
      return { path: index === 0 ? 'index.html' : `${page.path.replace(/^\/+|\/+$/g, '') || page.id}/index.html`, data: encoder.encode(html) };
    });
    const css = `:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:${foreground};background:${background};--accent:${accent}}*{box-sizing:border-box}body{margin:0;background:${background};color:${foreground}}nav{height:72px;padding:0 clamp(24px,6vw,88px);display:flex;align-items:center;gap:32px;border-bottom:1px solid color-mix(in srgb,${foreground} 12%,transparent)}nav span{display:flex;justify-content:flex-end;gap:22px;flex:1}nav a{color:inherit;text-decoration:none}.hero{min-height:72vh;padding:clamp(48px,9vw,128px) clamp(24px,8vw,120px);display:grid;grid-template-columns:minmax(0,1.2fr) minmax(240px,.8fr);gap:8vw;align-items:center;background:linear-gradient(125deg,color-mix(in srgb,${background} 90%,white),color-mix(in srgb,${background} 72%,${foreground}))}.hero small{color:var(--accent);font-weight:800;letter-spacing:.16em;text-transform:uppercase}.hero h1{max-width:14ch;font-size:clamp(48px,7.5vw,108px);line-height:.92;letter-spacing:-.06em;margin:14px 0 24px}.hero p,.content>p{font-size:clamp(17px,2vw,24px);line-height:1.6;opacity:.68;max-width:720px}.hero span{display:flex;gap:12px;margin-top:28px}.hero a,.final a{display:inline-block;padding:14px 22px;border-radius:999px;background:var(--accent);color:white;text-decoration:none;font-weight:750}.hero .secondary{background:transparent;color:inherit;border:1px solid currentColor}.hero aside{height:400px;display:grid;grid-template-columns:1fr 1fr;gap:12px;transform:rotate(-2deg)}.hero aside i{display:block;border-radius:70px 12px 48px 12px;background:var(--accent);opacity:.65}.hero aside i:first-child{grid-row:1/3;opacity:.22}.content{padding:clamp(64px,8vw,120px) clamp(24px,8vw,120px)}.content h2,.final h2{font-size:clamp(36px,5vw,72px);letter-spacing:-.045em;line-height:1;max-width:16ch}.features{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:48px}.features article{padding:28px;border:1px solid color-mix(in srgb,${foreground} 13%,transparent);border-radius:18px}.features b{color:var(--accent)}.features p{opacity:.62;line-height:1.55}.stats{display:grid;grid-template-columns:repeat(3,1fr);padding:0 clamp(24px,8vw,120px) 80px}.stats span{display:grid;text-align:center}.stats strong{color:var(--accent);font-size:clamp(38px,5vw,70px)}.quote{padding:100px 24px;text-align:center;background:color-mix(in srgb,${background} 82%,white)}blockquote{font:600 clamp(28px,4vw,54px)/1.2 Georgia,serif;max-width:24ch;margin:0 auto 20px}.final{padding:clamp(70px,10vw,140px) clamp(24px,8vw,120px);background:var(--accent);color:white}.final a{background:white;color:${foreground}}footer{padding:28px clamp(24px,6vw,88px);opacity:.55}html[data-theme=bold] .hero{background:${foreground};color:${background}}html[data-theme=minimal] .hero{grid-template-columns:1fr}html[data-theme=minimal] .hero aside{display:none}@media(max-width:760px){nav span{display:none}.hero{grid-template-columns:1fr}.hero aside{height:260px}.features,.stats{grid-template-columns:1fr}}`;
    return [...assets, { path: 'styles.css', data: encoder.encode(css) }];
  }
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="description" content="${body.slice(0, 155)}"><link rel="stylesheet" href="styles.css"></head>
<body><nav><strong>${title}</strong><a href="#main">Explore</a></nav><main id="main"><section><p class="eyebrow">Created with Builderforce</p><h1>${headline}</h1><p class="lead">${body}</p><a class="cta" href="#contact">${cta}</a></section><aside aria-hidden="true">${title.slice(0, 2).toUpperCase()}</aside></main><footer id="contact">${title}</footer></body></html>`;
  const css = `:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#172033;background:#f8fafc}*{box-sizing:border-box}body{margin:0}nav{height:72px;padding:0 clamp(24px,6vw,88px);display:flex;align-items:center;justify-content:space-between;background:white;border-bottom:1px solid #e5e7eb}nav a{color:${accent}}main{min-height:calc(100vh - 132px);padding:clamp(48px,9vw,128px) clamp(24px,8vw,120px);display:grid;grid-template-columns:minmax(0,1.25fr) minmax(240px,.75fr);gap:8vw;align-items:center}h1{font-size:clamp(44px,7vw,92px);line-height:.98;letter-spacing:-.055em;margin:12px 0 24px}.eyebrow{color:${accent};font-weight:750;text-transform:uppercase;letter-spacing:.12em}.lead{font-size:clamp(18px,2vw,25px);line-height:1.6;color:#526079;max-width:680px}.cta{display:inline-block;margin-top:24px;padding:14px 22px;border-radius:9999px;background:${accent};color:white;text-decoration:none;font-weight:750}aside{aspect-ratio:1;border-radius:32%;display:grid;place-items:center;background:${accent};color:white;font-size:clamp(64px,10vw,150px);font-weight:850;box-shadow:0 40px 90px ${accent}44}footer{height:60px;padding:20px clamp(24px,6vw,88px);color:#64748b}@media(max-width:760px){main{grid-template-columns:1fr}aside{max-width:320px}}`;
  const encoder = new TextEncoder();
  return [{ path: 'index.html', data: encoder.encode(html) }, { path: 'styles.css', data: encoder.encode(css) }];
}

export interface EvermindMediaResult {
  model: string;
  modality: 'video' | 'image';
  width: number;
  height: number;
  channels: number;
  frameCount: number;
  frames: string[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function generateEvermindMedia(slug: string, input: { prompt?: string; maxFrames?: number; seed?: number }): Promise<EvermindMediaResult> {
  return apiRequest<EvermindMediaResult>(`/api/studio/models/${encodeURIComponent(slug)}/generate-media`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}

/** Convert one raw RGB/RGBA model frame to a browser-previewable PNG. */
export function mediaFrameDataUrl(frame: string, width: number, height: number, channels: number): string | null {
  if (typeof document === 'undefined' || (channels !== 3 && channels !== 4)) return null;
  const binary = atob(frame);
  if (binary.length < width * height * channels) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const pixels = context.createImageData(width, height);
  for (let source = 0, target = 0; source < width * height * channels; source += channels, target += 4) {
    pixels.data[target] = binary.charCodeAt(source);
    pixels.data[target + 1] = binary.charCodeAt(source + 1);
    pixels.data[target + 2] = binary.charCodeAt(source + 2);
    pixels.data[target + 3] = channels === 4 ? binary.charCodeAt(source + 3) : 255;
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
}
