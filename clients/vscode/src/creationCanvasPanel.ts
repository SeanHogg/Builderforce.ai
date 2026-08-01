import * as vscode from "vscode";
import * as bfApi from "./bfApi";
import { makeNonce, WebviewPanelBase, type WebviewInbound } from "./webviewShared";

interface CanvasInbound extends WebviewInbound {
  objectId?: string;
  x?: number;
  y?: number;
  kind?: string;
  title?: string;
  path?: string;
}

/** Native VS Code editor for the same durable Creation Session used by the web app. */
export class CreationCanvasPanel extends WebviewPanelBase<CanvasInbound> {
  private static readonly panels = new Map<string, CreationCanvasPanel>();
  private detail?: bfApi.BfCreationSessionDetail;

  static open(ctx: vscode.ExtensionContext, sessionId: string, title: string): void {
    const existing = this.panels.get(sessionId);
    if (existing) { existing.panel.reveal(); void existing.refresh(); return; }
    this.panels.set(sessionId, new CreationCanvasPanel(ctx, sessionId, title));
  }

  private constructor(ctx: vscode.ExtensionContext, private readonly sessionId: string, title: string) {
    super(ctx, { viewType: "builderforce.creationCanvas", title: `Create — ${title}`, htmlTitle: "BuilderForce Creation Canvas" });
  }

  protected renderHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Creation Canvas</title><style>
      :root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);overflow:hidden}.bar{height:48px;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background)}.bar strong{flex:1}.bar button,.palette button,.composer button{font:inherit;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;border-radius:6px;padding:7px 10px;cursor:pointer}.palette{position:absolute;z-index:4;left:14px;top:62px;width:170px;padding:10px;background:var(--vscode-sideBar-background);border:1px solid var(--vscode-panel-border);border-radius:9px;box-shadow:0 8px 24px #0003}.palette b{display:block;margin-bottom:8px}.palette button{display:block;width:100%;margin:5px 0;text-align:left;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border)}#canvas{position:absolute;inset:48px 0 0;background-image:radial-gradient(circle,var(--vscode-panel-border) 1px,transparent 1px);background-size:22px 22px;overflow:auto}.world{position:relative;width:3000px;height:2000px}.edges{position:absolute;inset:0;pointer-events:none}.card{position:absolute;width:300px;min-height:140px;border:1px solid var(--vscode-panel-border);border-top:3px solid var(--vscode-focusBorder);border-radius:10px;background:var(--vscode-editorWidget-background);box-shadow:0 5px 18px #0002;overflow:hidden;user-select:none}.card header{padding:10px 12px;border-bottom:1px solid var(--vscode-panel-border);font-weight:700;cursor:grab}.card main{padding:12px}.kind{font-size:11px;text-transform:uppercase;color:var(--vscode-descriptionForeground)}.card p{color:var(--vscode-descriptionForeground);line-height:1.45}.composer{position:fixed;z-index:5;bottom:18px;left:50%;transform:translateX(-50%);width:min(680px,70vw);display:flex;gap:8px;padding:9px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-panel-border);border-radius:12px;box-shadow:0 8px 30px #0005}.composer input{flex:1;font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:6px;padding:9px}.empty{padding:90px 220px;color:var(--vscode-descriptionForeground)}
    </style></head><body><div class="bar"><strong id="title">Creation Session</strong><span id="presence"></span><button id="file">+ Current file</button><button id="refresh">Refresh</button><button id="web">Open on web</button></div><aside class="palette"><b>Add to canvas</b><button data-kind="chat">● Chat</button><button data-kind="workflow">⌘ Workflow</button><button data-kind="website">◎ Website</button><button data-kind="dataset">▤ Dataset</button><button data-kind="note">◇ Note</button><button data-kind="agent">✦ Agent</button></aside><div id="canvas"><div class="world"><svg class="edges" width="3000" height="2000"></svg><div id="objects"></div><div class="empty">Loading your canvas…</div></div></div><form class="composer"><input placeholder="Ask Brain or describe what to add…"><button>Send</button></form><script nonce="${nonce}">
      const vscode=acquireVsCodeApi();let detail=null,drag=null;const q=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      function render(){if(!detail)return;q('#title').textContent=detail.session.title;q('#presence').textContent=(detail.members?.length||1)+' collaborator'+((detail.members?.length||1)===1?'':'s');q('.empty').hidden=detail.objects.length>0;const map=new Map(detail.objects.map(o=>[o.id,o]));q('#objects').innerHTML=detail.objects.map(o=>{const c=o.canvasData||{},d=o.content||{};return '<article class="card" data-id="'+esc(o.id)+'" style="left:'+Number(c.x||80)+'px;top:'+Number(c.y||80)+'px"><header>'+esc(d.title||o.kind)+'</header><main><div class="kind">'+esc(o.kind)+'</div><p>'+esc(d.subtitle||d.status||'Live session object')+'</p></main></article>'}).join('');q('.edges').innerHTML=(detail.connections||[]).map(e=>{const a=map.get(e.sourceObjectId),b=map.get(e.targetObjectId);if(!a||!b)return'';const ac=a.canvasData||{},bc=b.canvasData||{},x1=Number(ac.x||80)+300,y1=Number(ac.y||80)+70,x2=Number(bc.x||80),y2=Number(bc.y||80)+70;return '<path d="M'+x1+' '+y1+' C'+(x1+70)+' '+y1+' '+(x2-70)+' '+y2+' '+x2+' '+y2+'" fill="none" stroke="var(--vscode-focusBorder)" stroke-width="2"/><text x="'+((x1+x2)/2)+'" y="'+((y1+y2)/2-6)+'" fill="var(--vscode-descriptionForeground)" font-size="11">'+esc(e.label||e.kind||'reference')+'</text>'}).join('')}
      addEventListener('message',e=>{if(e.data.type==='session'){detail=e.data.detail;render()}if(e.data.type==='error')q('.empty').textContent=e.data.message});q('#refresh').onclick=()=>vscode.postMessage({type:'refresh'});q('#web').onclick=()=>vscode.postMessage({type:'web'});q('#file').onclick=()=>vscode.postMessage({type:'file.add'});document.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>vscode.postMessage({type:'object.add',kind:b.dataset.kind,title:b.textContent.trim().replace(/^\\S+\\s/,'')}));q('.composer').onsubmit=e=>{e.preventDefault();const input=q('.composer input');if(input.value.trim())vscode.postMessage({type:'prompt',title:input.value.trim()});input.value=''};
      q('#objects').addEventListener('pointerdown',e=>{const card=e.target.closest('.card');if(!card||e.button!==0)return;const o=detail.objects.find(x=>x.id===card.dataset.id);drag={card,o,sx:e.clientX,sy:e.clientY,x:Number(o.canvasData?.x||0),y:Number(o.canvasData?.y||0)};card.setPointerCapture(e.pointerId)});addEventListener('pointermove',e=>{if(!drag)return;drag.card.style.left=(drag.x+e.clientX-drag.sx)+'px';drag.card.style.top=(drag.y+e.clientY-drag.sy)+'px'});addEventListener('pointerup',e=>{if(!drag)return;const x=Math.round(drag.x+e.clientX-drag.sx),y=Math.round(drag.y+e.clientY-drag.sy);vscode.postMessage({type:'object.move',objectId:drag.o.id,x,y});drag=null});q('#objects').addEventListener('dblclick',e=>{const card=e.target.closest('.card');const o=detail.objects.find(x=>x.id===card?.dataset.id);if(o?.content?.path)vscode.postMessage({type:'file.open',path:o.content.path})});vscode.postMessage({type:'ready'});
    </script></body></html>`;
  }

  protected async onMessage(message: CanvasInbound): Promise<void> {
    try {
      if (message.type === "ready" || message.type === "refresh") return void await this.refresh();
      if (message.type === "web") return void vscode.env.openExternal(vscode.Uri.parse(`https://builderforce.ai/create/${this.sessionId}`));
      if (message.type === "file.open" && message.path) return void vscode.window.showTextDocument(vscode.Uri.file(message.path));
      if (message.type === "file.add") {
        const editor = vscode.window.activeTextEditor;
        if (!editor) throw new Error("Open a file first");
        await this.command({ type: "object.add", kind: "code", geometry: { x: 220, y: 180 }, content: { kind: "code", title: vscode.workspace.asRelativePath(editor.document.uri), path: editor.document.uri.fsPath, language: editor.document.languageId, subtitle: "VS Code file — double-click to open" } });
      } else if (message.type === "object.add" && message.kind) {
        await this.command({ type: "object.add", kind: message.kind, geometry: { x: 260, y: 180 }, content: { kind: message.kind, title: message.title || message.kind, status: "Draft" } });
      } else if (message.type === "prompt" && message.title) {
        await this.command({ type: "object.add", kind: "chat", geometry: { x: 300, y: 230 }, content: { kind: "chat", title: "Brain", subtitle: message.title, status: "Queued from VS Code" } });
      } else if (message.type === "object.move" && message.objectId && Number.isFinite(message.x) && Number.isFinite(message.y)) {
        await this.command({ type: "object.move", objectId: message.objectId, geometry: { x: message.x, y: message.y } });
      }
    } catch (error) { this.post({ type: "error", message: (error as Error).message }); }
  }

  private async command(command: unknown): Promise<void> {
    if (!this.detail) await this.refresh();
    const saved = await bfApi.applyCreationCommands(this.ctx.secrets, this.sessionId, this.detail!.session.canvasRevision, [command]);
    this.detail!.session.canvasRevision = saved.revision;
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    this.detail = await bfApi.getCreationSession(this.ctx.secrets, this.sessionId);
    this.post({ type: "session", detail: this.detail });
  }

  protected onDispose(): void { CreationCanvasPanel.panels.delete(this.sessionId); }
}
