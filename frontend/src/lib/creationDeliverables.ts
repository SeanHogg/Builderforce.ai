import { apiRequest } from './apiClient';
import type { CreationNodeData } from '@/components/creation-canvas/types';

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

export interface BrowserCreativeArtifact {
  artifactKind: string;
  fileName: string;
  mimeType: string;
  url: string;
  outputFormat: string;
  validationDetail: string;
}

/** Produce a real, portable baseline artifact without claiming an unavailable
 * binary encoder. Provider renderers can replace these outputs later. */
export function buildBrowserCreativeArtifact(data: CreationNodeData): BrowserCreativeArtifact {
  const kind = data.kind;
  const title = String(data.title || kind);
  const brief = String(data.prompt || data.content || data.subtitle || title);
  const stem = fileSafe(title);
  const escapedTitle = escapeHtml(title);
  const escapedBrief = escapeHtml(brief);
  const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#202b5f"/><stop offset="1" stop-color="#7c4dff"/></linearGradient></defs><rect width="1200" height="675" rx="32" fill="url(#g)"/>${body}<text x="70" y="555" fill="white" font-family="system-ui,sans-serif" font-size="58" font-weight="750">${escapedTitle}</text><text x="70" y="610" fill="#ddd7ff" font-family="system-ui,sans-serif" font-size="24">${escapedBrief.slice(0, 86)}</text></svg>`;
  if (kind === 'image' || kind === 'comic') {
    const content = svg(kind === 'comic' ? '<g fill="#fff" opacity=".92"><rect x="70" y="70" width="310" height="390" rx="18"/><rect x="445" y="70" width="310" height="390" rx="18"/><rect x="820" y="70" width="310" height="390" rx="18"/></g>' : '<circle cx="600" cy="290" r="180" fill="#fff" opacity=".88"/><circle cx="650" cy="250" r="110" fill="#ffb35c"/>');
    return { artifactKind: kind, fileName: `${stem}.svg`, mimeType: 'image/svg+xml', url: textDataUrl('image/svg+xml', content), outputFormat: 'SVG', validationDetail: 'Valid standalone SVG generated in the browser' };
  }
  if (kind === 'animation') {
    const content = `<!doctype html><meta charset="utf-8"><title>${escapedTitle}</title><style>html,body{height:100%;margin:0;background:#11152b;overflow:hidden}.orb{position:absolute;width:22vmin;aspect-ratio:1;border-radius:50%;background:linear-gradient(135deg,#ffb35c,#7c4dff);animation:move 4s ease-in-out infinite alternate;box-shadow:0 0 80px #7c4dff88}@keyframes move{from{transform:translate(20vw,20vh) scale(.7)}to{transform:translate(65vw,55vh) scale(1.4)}}h1{position:absolute;color:white;font:700 6vw system-ui;left:6vw;bottom:8vh}</style><div class="orb"></div><h1>${escapedTitle}</h1>`;
    return { artifactKind: kind, fileName: `${stem}.html`, mimeType: 'text/html', url: textDataUrl('text/html', content), outputFormat: 'HTML', validationDetail: 'Self-contained animated HTML generated in the browser' };
  }
  if (kind === 'game') {
    const content = `<!doctype html><meta charset="utf-8"><title>${escapedTitle}</title><style>body{font:20px system-ui;background:#151a35;color:white;text-align:center;padding:8vh}button{font:inherit;padding:16px 24px}#score{font-size:64px}</style><h1>${escapedTitle}</h1><p>${escapedBrief}</p><div id="score">0</div><button onclick="score.textContent=+score.textContent+1">Play</button>`;
    return { artifactKind: kind, fileName: `${stem}.html`, mimeType: 'text/html', url: textDataUrl('text/html', content), outputFormat: 'HTML', validationDetail: 'Self-contained interactive HTML game generated in the browser' };
  }
  if (kind === 'cad') {
    const dxf = `0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\n0\n90\n4\n70\n1\n10\n0\n20\n0\n10\n100\n20\n0\n10\n100\n20\n60\n10\n0\n20\n60\n0\nENDSEC\n0\nEOF\n`;
    return { artifactKind: kind, fileName: `${stem}.dxf`, mimeType: 'application/dxf', url: textDataUrl('application/dxf', dxf), outputFormat: 'DXF', validationDetail: 'Closed 100 × 60 unit DXF polyline generated in the browser' };
  }
  if (kind === 'model3d') {
    const stl = `solid ${stem}\nfacet normal 0 0 -1\nouter loop\nvertex 0 0 0\nvertex 1 1 0\nvertex 1 0 0\nendloop\nendfacet\nfacet normal 0 0 -1\nouter loop\nvertex 0 0 0\nvertex 0 1 0\nvertex 1 1 0\nendloop\nendfacet\nfacet normal 0 0 1\nouter loop\nvertex 0 0 1\nvertex 1 0 1\nvertex 1 1 1\nendloop\nendfacet\nfacet normal 0 0 1\nouter loop\nvertex 0 0 1\nvertex 1 1 1\nvertex 0 1 1\nendloop\nendfacet\nendsolid ${stem}`;
    return { artifactKind: kind, fileName: `${stem}.stl`, mimeType: 'model/stl', url: textDataUrl('model/stl', stl), outputFormat: 'STL', validationDetail: 'ASCII STL mesh generated in the browser' };
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

/** Build a complete, dependency-free site from an authored Website object. */
export function buildWebsiteAssets(data: CreationNodeData): Array<{ path: string; data: Uint8Array }> {
  const title = escapeHtml(data.title || 'Created with Builderforce');
  const headline = escapeHtml(data.websiteHeadline || data.title || 'Bring your idea to life');
  const body = escapeHtml(data.websiteBody || data.content || data.subtitle || 'Created collaboratively in Builderforce.');
  const cta = escapeHtml(data.websiteCta || 'Get started');
  const accent = safeColor(data.websiteAccent);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="description" content="${body.slice(0, 155)}"><link rel="stylesheet" href="styles.css"></head>
<body><nav><strong>${title}</strong><a href="#main">Explore</a></nav><main id="main"><section><p class="eyebrow">Created with Builderforce</p><h1>${headline}</h1><p class="lead">${body}</p><a class="cta" href="#contact">${cta}</a></section><aside aria-hidden="true">${title.slice(0, 2).toUpperCase()}</aside></main><footer id="contact">${title}</footer></body></html>`;
  const css = `:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#172033;background:#f8fafc}*{box-sizing:border-box}body{margin:0}nav{height:72px;padding:0 clamp(24px,6vw,88px);display:flex;align-items:center;justify-content:space-between;background:white;border-bottom:1px solid #e5e7eb}nav a{color:${accent}}main{min-height:calc(100vh - 132px);padding:clamp(48px,9vw,128px) clamp(24px,8vw,120px);display:grid;grid-template-columns:minmax(0,1.25fr) minmax(240px,.75fr);gap:8vw;align-items:center}h1{font-size:clamp(44px,7vw,92px);line-height:.98;letter-spacing:-.055em;margin:12px 0 24px}.eyebrow{color:${accent};font-weight:750;text-transform:uppercase;letter-spacing:.12em}.lead{font-size:clamp(18px,2vw,25px);line-height:1.6;color:#526079;max-width:680px}.cta{display:inline-block;margin-top:24px;padding:14px 22px;border-radius:999px;background:${accent};color:white;text-decoration:none;font-weight:750}aside{aspect-ratio:1;border-radius:32%;display:grid;place-items:center;background:${accent};color:white;font-size:clamp(64px,10vw,150px);font-weight:850;box-shadow:0 40px 90px ${accent}44}footer{height:60px;padding:20px clamp(24px,6vw,88px);color:#64748b}@media(max-width:760px){main{grid-template-columns:1fr}aside{max-width:320px}}`;
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
