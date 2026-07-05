import * as vscode from "vscode";
import * as bfApi from "./bfApi";
import { getBaseUrl, getWebBaseUrl, SECRET_KEY } from "./gateway";

/**
 * Meetings surface for the editor: a tree of upcoming/live meetings fed by the
 * user-scoped `/api/meetings` (the editor key is exchanged for a tenant JWT under
 * the hood by bfApi). Two ways to join, per the product decision:
 *   • Join in browser — opens the authenticated web meeting (camera/mic work reliably).
 *   • Join here — a native VS Code webview running the same mesh WebRTC call.
 * Both hit the SAME authorization-scoped `/join` endpoint, so only members of the
 * tenant/project may enter.
 */
export class MeetingItem extends vscode.TreeItem {
  constructor(public readonly detail: bfApi.BfMeetingDetail) {
    super(detail.meeting.title, vscode.TreeItemCollapsibleState.None);
    const m = detail.meeting;
    const when = m.scheduledAt
      ? new Date(m.scheduledAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
      : vscode.l10n.t("Anytime");
    this.description = m.status === "live" ? vscode.l10n.t("● Live") : when;
    this.tooltip = `${m.title} — ${m.kind}\n${when}\n${detail.attendees.length} ${vscode.l10n.t("participants")}`;
    this.contextValue = "bfMeeting";
    this.iconPath = new vscode.ThemeIcon(m.status === "live" ? "broadcast" : "device-camera-video");
    this.command = { command: "builderforce.joinMeetingBrowser", title: "Join", arguments: [this] };
  }
}

export class MeetingsTreeProvider implements vscode.TreeDataProvider<MeetingItem> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  constructor(private readonly secrets: vscode.SecretStorage) {}
  refresh(): void { this._onDidChange.fire(); }
  getTreeItem(el: MeetingItem): vscode.TreeItem { return el; }
  async getChildren(): Promise<MeetingItem[]> {
    if (!(await this.secrets.get(SECRET_KEY))) return [];
    try {
      const meetings = await bfApi.listMeetings(this.secrets);
      return meetings.map((d) => new MeetingItem(d));
    } catch {
      return [];
    }
  }
}

export class MeetingsController implements vscode.Disposable {
  private readonly provider: MeetingsTreeProvider;
  private readonly view: vscode.TreeView<MeetingItem>;
  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.provider = new MeetingsTreeProvider(ctx.secrets);
    this.view = vscode.window.createTreeView("builderforce.meetings", { treeDataProvider: this.provider });
  }
  refresh(): void { this.provider.refresh(); }
  dispose(): void { this.view.dispose(); }
}

/** Open the authenticated web meeting in the external browser. */
export async function joinMeetingInBrowser(item: MeetingItem | string): Promise<void> {
  const id = typeof item === "string" ? item : item.detail.meeting.id;
  await vscode.env.openExternal(vscode.Uri.parse(`${getWebBaseUrl()}/meetings?join=${encodeURIComponent(id)}`));
}

/** Open the "New meeting" web page (scheduling with find-a-time + availability). */
export async function openMeetingsWeb(): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(`${getWebBaseUrl()}/meetings`));
}

/**
 * Join a meeting natively inside a VS Code webview: joins server-side to get the
 * media room + ICE, then runs a mesh WebRTC client (mirrors the web useMediaRoom).
 * Camera/mic access in webviews can be denied by the OS/VS Code — the webview shows
 * a clear error and the "Join in browser" path remains the reliable fallback.
 */
export async function joinMeetingNative(ctx: vscode.ExtensionContext, item: MeetingItem | string): Promise<void> {
  const id = typeof item === "string" ? item : item.detail.meeting.id;
  const title = typeof item === "string" ? "Meeting" : item.detail.meeting.title;
  const token = await bfApi.getTenantJwt(ctx.secrets);
  if (!token) { void vscode.window.showWarningMessage(vscode.l10n.t("Sign in to BuilderForce first.")); return; }

  let join: bfApi.BfMeetingJoin;
  try {
    join = await bfApi.joinMeeting(ctx.secrets, id);
  } catch (e) {
    void vscode.window.showErrorMessage(`BuilderForce: ${(e as Error).message}`);
    return;
  }
  const userId = (await bfApi.getCurrentUserId(ctx.secrets)) ?? "vscode";
  const wsBase = getBaseUrl().replace(/^http/, "ws");
  const wsUrl = `${wsBase}/api/meetings/rooms/${encodeURIComponent(join.roomKey)}/ws?token=${encodeURIComponent(token)}`;

  const panel = vscode.window.createWebviewPanel("builderforceMeeting", `📹 ${title}`, vscode.ViewColumn.Active, {
    enableScripts: true, retainContextWhenHidden: true,
  });
  panel.webview.html = meetingHtml(panel.webview, {
    wsUrl,
    iceServers: join.iceServers,
    videoEnabled: join.videoEnabled,
    title,
    me: { ref: userId, name: vscode.l10n.t("You") },
  });
  panel.webview.onDidReceiveMessage((msg) => {
    if (msg?.type === "leave") {
      // Best-effort presence leave (mirrors the web MeetingRoom).
      void fetch(`${getBaseUrl()}/api/meetings/${encodeURIComponent(id)}/leave`, {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      }).catch(() => undefined);
      panel.dispose();
    }
  });
}

/** The self-contained mesh WebRTC client HTML for the native meeting webview. */
function meetingHtml(
  webview: vscode.Webview,
  cfg: { wsUrl: string; iceServers: unknown[]; videoEnabled: boolean; title: string; me: { ref: string; name: string } },
): string {
  const nonce = String(Math.abs(hashStr(cfg.wsUrl + cfg.me.ref)));
  const data = JSON.stringify(cfg).replace(/</g, "\\u003c");
  const csp = `default-src 'none'; img-src ${webview.cspSource} data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; media-src blob: mediastream:; connect-src ws: wss:;`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-foreground); }
  #grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; padding: 10px; }
  .tile { position: relative; aspect-ratio: 4/3; background: #111; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
  .tile video { width: 100%; height: 100%; object-fit: cover; }
  .tile .name { position: absolute; left: 6px; bottom: 6px; font-size: 12px; background: rgba(0,0,0,.55); color:#fff; padding: 1px 6px; border-radius: 5px; }
  .tile .avatar { width: 54px; height: 54px; border-radius: 50%; background:#3b82f6; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:20px; }
  #bar { display:flex; gap:10px; justify-content:center; padding: 10px; border-top: 1px solid var(--vscode-panel-border); }
  button { cursor:pointer; border:none; border-radius:20px; padding:8px 14px; font-weight:600; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.off { background:#7f1d1d; color:#fff; }
  button.leave { background:#b91c1c; color:#fff; }
  #err { color:#f87171; padding: 10px; font-size: 13px; }
</style></head>
<body>
  <div id="err" hidden></div>
  <div id="grid"></div>
  <div id="bar">
    <button id="mic">🎤 Mic</button>
    <button id="cam" ${cfg.videoEnabled ? "" : "hidden"}>📷 Camera</button>
    <button id="leave" class="leave">Leave</button>
  </div>
<script nonce="${nonce}">
const vscodeApi = acquireVsCodeApi();
const CFG = ${data};
const grid = document.getElementById('grid');
const errEl = document.getElementById('err');
const peers = new Map(); // peerId -> { pc, stream, el }
let myId = '', ws, local, camOn = CFG.videoEnabled, micOn = true;

function showError(m){ errEl.hidden=false; errEl.textContent=m; }
function initials(n){ return (n||'?').trim().split(/\\s+/).slice(0,2).map(p=>p[0]||'').join('').toUpperCase(); }

function tile(id, name){
  let t = peers.get(id);
  if (t && t.el) return t.el;
  const el = document.createElement('div'); el.className='tile';
  const v = document.createElement('video'); v.autoplay=true; v.playsInline=true;
  const av = document.createElement('div'); av.className='avatar'; av.textContent=initials(name);
  const nm = document.createElement('div'); nm.className='name'; nm.textContent=name||'Guest';
  el.appendChild(v); el.appendChild(av); el.appendChild(nm); grid.appendChild(el);
  return el;
}
function selfTile(){
  const el = document.createElement('div'); el.className='tile';
  const v = document.createElement('video'); v.autoplay=true; v.playsInline=true; v.muted=true; v.style.transform='scaleX(-1)';
  const nm = document.createElement('div'); nm.className='name'; nm.textContent=CFG.me.name;
  el.appendChild(v); el.appendChild(nm); grid.appendChild(el); return v;
}
function send(o){ if (ws && ws.readyState===1) ws.send(JSON.stringify(o)); }
function shouldOffer(pid){ return myId > pid; }

function ensurePeer(p){
  let st = peers.get(p.id); if (st && st.pc) return st;
  const pc = new RTCPeerConnection({ iceServers: CFG.iceServers });
  const stream = new MediaStream();
  const el = tile(p.id, p.name); const v = el.querySelector('video'); v.srcObject = stream;
  st = { pc, stream, el, name: p.name };
  peers.set(p.id, st);
  if (local) local.getTracks().forEach(tk => pc.addTrack(tk, local));
  pc.onicecandidate = e => { if (e.candidate) send({ type:'rtc-ice', to:p.id, candidate:e.candidate.toJSON() }); };
  pc.ontrack = e => { (e.streams[0]?.getTracks()||[e.track]).forEach(tk=>{ if(!stream.getTracks().some(x=>x.id===tk.id)) stream.addTrack(tk); }); };
  return st;
}
function closePeer(id){ const st=peers.get(id); if(!st) return; try{st.pc.close();}catch{} st.el?.remove(); peers.delete(id); }
async function makeOffer(p){ const {pc}=ensurePeer(p); try{ const o=await pc.createOffer(); await pc.setLocalDescription(o); send({type:'rtc-offer',to:p.id,sdp:pc.localDescription}); }catch{} }

async function onFrame(msg){
  const from = msg.from;
  if (msg.type==='hello'){ myId=String(msg.id||''); return; }
  if (msg.type==='roster'){ (msg.peers||[]).forEach(p=>{ if(p.id!==myId){ ensurePeer(p); if(shouldOffer(p.id)) makeOffer(p); } }); return; }
  if (msg.type==='presence'){ const p=msg.peer; if(!p) return; if(msg.action==='join'){ ensurePeer(p); if(shouldOffer(p.id)) makeOffer(p); } else if(msg.action==='leave'){ closePeer(p.id); } return; }
  if (!from || (msg.to && msg.to!==myId)) return;
  if (msg.type==='rtc-offer'){ const st=ensurePeer({id:from,name:msg.name||''}); try{ await st.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp)); const a=await st.pc.createAnswer(); await st.pc.setLocalDescription(a); send({type:'rtc-answer',to:from,sdp:st.pc.localDescription}); }catch{} }
  else if (msg.type==='rtc-answer'){ const st=peers.get(from); if(st){ try{ await st.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp)); }catch{} } }
  else if (msg.type==='rtc-ice'){ const st=peers.get(from); if(st&&msg.candidate){ try{ await st.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); }catch{} } }
}

async function start(){
  const selfVideo = selfTile();
  try {
    local = await navigator.mediaDevices.getUserMedia({ video: CFG.videoEnabled, audio: true });
    selfVideo.srcObject = local;
  } catch (e) {
    showError('Camera/microphone unavailable in the editor: ' + (e && e.message ? e.message : e) + ' — use "Join in browser" instead.');
  }
  ws = new WebSocket(CFG.wsUrl);
  ws.onopen = () => send({ type:'join', name: CFG.me.name, kind:'human', ref: CFG.me.ref });
  ws.onmessage = ev => { let m; try{ m=JSON.parse(ev.data); }catch{ return; } if(m&&m.type) onFrame(m); };
  ws.onclose = () => showError('Disconnected.');
}
document.getElementById('mic').onclick = e => { micOn=!micOn; (local?.getAudioTracks()||[]).forEach(t=>t.enabled=micOn); e.target.classList.toggle('off',!micOn); };
document.getElementById('cam').onclick = e => { camOn=!camOn; (local?.getVideoTracks()||[]).forEach(t=>t.enabled=camOn); e.target.classList.toggle('off',!camOn); };
document.getElementById('leave').onclick = () => { try{ws&&ws.close();}catch{} peers.forEach((_,id)=>closePeer(id)); (local?.getTracks()||[]).forEach(t=>t.stop()); vscodeApi.postMessage({type:'leave'}); };
start();
</script></body></html>`;
}

function hashStr(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
