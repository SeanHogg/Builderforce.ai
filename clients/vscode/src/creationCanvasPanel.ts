import * as vscode from "vscode";
import * as bfApi from "./bfApi";
import { makeNonce, WebviewPanelBase, type WebviewInbound } from "./webviewShared";
import { CREATION_OBJECT_KINDS, isCreationObjectKind } from "@builderforce/creation-canvas-contract";

interface CanvasInbound extends WebviewInbound {
  objectId?: string;
  x?: number;
  y?: number;
  kind?: string;
  title?: string;
  path?: string;
  body?: string;
}

/** Native VS Code editor for the same durable Creation Session used by the web app. */
export class CreationCanvasPanel extends WebviewPanelBase<CanvasInbound> {
  private static readonly panels = new Map<string, CreationCanvasPanel>();
  private detail?: bfApi.BfCreationSessionDetail;
  private selectedObjectId?: string;

  static open(ctx: vscode.ExtensionContext, sessionId: string, title: string): void {
    const existing = this.panels.get(sessionId);
    if (existing) { existing.panel.reveal(); void existing.refresh(); return; }
    this.panels.set(sessionId, new CreationCanvasPanel(ctx, sessionId, title));
  }

  private constructor(ctx: vscode.ExtensionContext, private readonly sessionId: string, title: string) {
    super(ctx, { viewType: "builderforce.creationCanvas", title: vscode.l10n.t("Create — {0}", title), htmlTitle: vscode.l10n.t("BuilderForce Creation Canvas") });
    const timer = setInterval(() => void this.publishPresence(), 8_000);
    const eventTimer = setInterval(() => void this.catchUp(), 2_000);
    this.disposables.push(new vscode.Disposable(() => { clearInterval(timer); clearInterval(eventTimer); }));
    this.onDidBecomeVisible(() => void this.refresh());
  }

  protected renderHtml(_webview: vscode.Webview): string {
    const nonce = makeNonce();
    const h = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
    const text = {
      creationCanvas: vscode.l10n.t("Creation Canvas"), creationSession: vscode.l10n.t("Creation Session"), file: vscode.l10n.t("File"), selection: vscode.l10n.t("Selection"), problems: vscode.l10n.t("Problems"), repository: vscode.l10n.t("Repository"), terminal: vscode.l10n.t("Terminal"), preview: vscode.l10n.t("Preview"), refresh: vscode.l10n.t("Refresh"), web: vscode.l10n.t("Web"), checkpoint: vscode.l10n.t("Checkpoint"), history: vscode.l10n.t("History"), branch: vscode.l10n.t("Branch"), merge: vscode.l10n.t("Merge"), remove: vscode.l10n.t("Delete"),
      addToCanvas: vscode.l10n.t("Add to Canvas"), comments: vscode.l10n.t("Comments"), session: vscode.l10n.t("Session"), selectedObject: vscode.l10n.t("Selected Object"), commentPlaceholder: vscode.l10n.t("Comment on selection…"), add: vscode.l10n.t("Add"), loading: vscode.l10n.t("Loading your Canvas…"), promptPlaceholder: vscode.l10n.t("Ask Brain or describe what to add…"), send: vscode.l10n.t("Send"), collaborator: vscode.l10n.t("Collaborator"), noComments: vscode.l10n.t("No comments yet"), active: vscode.l10n.t("{0} active", "__COUNT__"), liveObject: vscode.l10n.t("Live Session Object"), reference: vscode.l10n.t("Reference"),
    };
    const paletteHtml = CREATION_OBJECT_KINDS.map((kind) => {
      const label = kind.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (value) => value.toUpperCase());
      return `<button data-kind="${kind}">${h(vscode.l10n.t(label))}</button>`;
    }).join("");
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(text.creationCanvas)}</title><style>
      :root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);overflow:hidden}.bar{height:50px;display:flex;align-items:center;gap:5px;padding:0 10px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background)}.bar strong{flex:1;min-width:120px}.bar button,.palette button,.composer button,.comments button{font:inherit;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;border-radius:6px;padding:6px 8px;cursor:pointer}.palette{position:absolute;z-index:4;left:12px;top:62px;width:184px;max-height:calc(100vh - 145px);overflow:auto;padding:10px;background:var(--vscode-sideBar-background);border:1px solid var(--vscode-panel-border);border-radius:9px;box-shadow:0 8px 24px #0003}.palette b{display:block;margin-bottom:8px}.palette button{display:block;width:100%;margin:5px 0;text-align:left;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border)}#canvas{position:absolute;inset:50px 0 0;background-image:radial-gradient(circle,var(--vscode-panel-border) 1px,transparent 1px);background-size:22px 22px;overflow:auto}.world{position:relative;width:3000px;height:2000px}.edges{position:absolute;inset:0;pointer-events:none}.card{position:absolute;width:300px;min-height:140px;border:1px solid var(--vscode-panel-border);border-top:3px solid var(--vscode-focusBorder);border-radius:10px;background:var(--vscode-editorWidget-background);box-shadow:0 5px 18px #0002;overflow:hidden;user-select:none}.card.selected{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}.card header{padding:10px 12px;border-bottom:1px solid var(--vscode-panel-border);font-weight:700;cursor:grab}.card main{padding:12px}.kind{font-size:11px;text-transform:uppercase;color:var(--vscode-descriptionForeground)}.card p{color:var(--vscode-descriptionForeground);line-height:1.45}.composer{position:fixed;z-index:5;bottom:18px;left:50%;transform:translateX(-50%);width:min(680px,60vw);display:flex;gap:8px;padding:9px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-panel-border);border-radius:12px;box-shadow:0 8px 30px #0005}.composer input,.comments input{flex:1;min-width:0;font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:6px;padding:9px}.comments{position:fixed;z-index:6;right:12px;top:62px;width:280px;max-height:calc(100vh - 140px);overflow:auto;padding:10px;background:var(--vscode-sideBar-background);border:1px solid var(--vscode-panel-border);border-radius:9px}.comments form{display:flex;gap:6px}.comments ul{padding:0;list-style:none}.comments li{border-top:1px solid var(--vscode-panel-border);padding:8px 0}.comments p{white-space:pre-wrap}.comments small{color:var(--vscode-descriptionForeground)}.empty{padding:90px 220px;color:var(--vscode-descriptionForeground)}
    </style></head><body><div class="bar"><strong id="title">${h(text.creationSession)}</strong><span id="presence"></span><button id="file">${h(text.file)}</button><button id="selection">${h(text.selection)}</button><button id="diagnostics">${h(text.problems)}</button><button id="repo">${h(text.repository)}</button><button id="terminal">${h(text.terminal)}</button><button id="preview">${h(text.preview)}</button><button id="checkpoint">${h(text.checkpoint)}</button><button id="history">${h(text.history)}</button><button id="branch">${h(text.branch)}</button><button id="merge">${h(text.merge)}</button><button id="remove">${h(text.remove)}</button><button id="refresh">${h(text.refresh)}</button><button id="web">${h(text.web)}</button></div><aside class="palette"><b>${h(text.addToCanvas)}</b>${paletteHtml}</aside><aside class="comments"><b>${h(text.comments)}</b><small id="comment-scope"> · ${h(text.session)}</small><ul></ul><form><input placeholder="${h(text.commentPlaceholder)}"><button>${h(text.add)}</button></form></aside><div id="canvas"><div class="world"><svg class="edges" width="3000" height="2000"></svg><div id="objects"></div><div class="empty">${h(text.loading)}</div></div></div><form class="composer"><input placeholder="${h(text.promptPlaceholder)}"><button>${h(text.send)}</button></form><script nonce="${nonce}">
      const vscode=acquireVsCodeApi(),i18n=${JSON.stringify(text)};let detail=null,drag=null,selected=null,comments=[];const q=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      function renderComments(){q('#comment-scope').textContent=' · '+(selected?i18n.selectedObject:i18n.session);q('.comments ul').innerHTML=comments.map(c=>'<li><b>'+esc(c.authorName||i18n.collaborator)+'</b><p>'+esc(c.body)+'</p><small>'+esc(new Date(c.createdAt).toLocaleString())+'</small></li>').join('')||'<li><small>'+esc(i18n.noComments)+'</small></li>'}
      function render(){if(!detail)return;q('#title').textContent=detail.session.title;q('#presence').textContent=i18n.active.replace('__COUNT__',String(detail.members?.length||1));q('.empty').hidden=detail.objects.length>0;const map=new Map(detail.objects.map(o=>[o.id,o]));q('#objects').innerHTML=detail.objects.map(o=>{const c=o.canvasData||{},d=o.content||{};return '<article class="card '+(selected===o.id?'selected':'')+'" data-id="'+esc(o.id)+'" style="left:'+Number(c.x||80)+'px;top:'+Number(c.y||80)+'px"><header>'+esc(d.title||o.kind)+'</header><main><div class="kind">'+esc(o.kind)+'</div><p>'+esc(d.subtitle||d.status||i18n.liveObject)+'</p></main></article>'}).join('');q('.edges').innerHTML=(detail.connections||[]).map(e=>{const a=map.get(e.sourceObjectId),b=map.get(e.targetObjectId);if(!a||!b)return'';const ac=a.canvasData||{},bc=b.canvasData||{},x1=Number(ac.x||80)+300,y1=Number(ac.y||80)+70,x2=Number(bc.x||80),y2=Number(bc.y||80)+70;return '<path d="M'+x1+' '+y1+' C'+(x1+70)+' '+y1+' '+(x2-70)+' '+y2+' '+x2+' '+y2+'" fill="none" stroke="var(--vscode-focusBorder)" stroke-width="2"/><text x="'+((x1+x2)/2)+'" y="'+((y1+y2)/2-6)+'" fill="var(--vscode-descriptionForeground)" font-size="11">'+esc(e.label||e.kind||i18n.reference)+'</text>'}).join('');renderComments()}
      addEventListener('message',e=>{if(e.data.type==='session'){detail=e.data.detail;render()}if(e.data.type==='comments'){comments=e.data.comments;renderComments()}if(e.data.type==='error')q('.empty').textContent=e.data.message});q('#refresh').onclick=()=>vscode.postMessage({type:'refresh'});q('#web').onclick=()=>vscode.postMessage({type:'web'});q('#checkpoint').onclick=()=>vscode.postMessage({type:'checkpoint'});q('#history').onclick=()=>vscode.postMessage({type:'history'});q('#branch').onclick=()=>vscode.postMessage({type:'branch'});q('#merge').onclick=()=>vscode.postMessage({type:'merge'});q('#remove').onclick=()=>vscode.postMessage({type:'object.delete',objectId:selected});q('#file').onclick=()=>vscode.postMessage({type:'file.add'});q('#selection').onclick=()=>vscode.postMessage({type:'selection.add'});q('#diagnostics').onclick=()=>vscode.postMessage({type:'diagnostics.add'});q('#repo').onclick=()=>vscode.postMessage({type:'repository.add'});q('#terminal').onclick=()=>vscode.postMessage({type:'terminal.add'});q('#preview').onclick=()=>vscode.postMessage({type:'preview.add'});document.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>vscode.postMessage({type:'object.add',kind:b.dataset.kind,title:b.textContent.trim()}));q('.composer').onsubmit=e=>{e.preventDefault();const input=q('.composer input');if(input.value.trim())vscode.postMessage({type:'prompt',title:input.value.trim()});input.value=''};q('.comments form').onsubmit=e=>{e.preventDefault();const input=q('.comments input');if(input.value.trim())vscode.postMessage({type:'comment.add',body:input.value.trim(),objectId:selected});input.value=''};
      q('#objects').addEventListener('pointerdown',e=>{const card=e.target.closest('.card');if(!card||e.button!==0)return;selected=card.dataset.id;vscode.postMessage({type:'selection.change',objectId:selected});render();const o=detail.objects.find(x=>x.id===card.dataset.id);drag={card,o,sx:e.clientX,sy:e.clientY,x:Number(o.canvasData?.x||0),y:Number(o.canvasData?.y||0)};card.setPointerCapture(e.pointerId)});addEventListener('pointermove',e=>{if(!drag)return;drag.card.style.left=(drag.x+e.clientX-drag.sx)+'px';drag.card.style.top=(drag.y+e.clientY-drag.sy)+'px'});addEventListener('pointerup',e=>{if(!drag)return;const x=Math.round(drag.x+e.clientX-drag.sx),y=Math.round(drag.y+e.clientY-drag.sy);vscode.postMessage({type:'object.move',objectId:drag.o.id,x,y});drag=null});q('#objects').addEventListener('dblclick',e=>{const card=e.target.closest('.card');const o=detail.objects.find(x=>x.id===card?.dataset.id);if(o?.content?.path)vscode.postMessage({type:'file.open',path:o.content.path});else vscode.postMessage({type:'web'})});vscode.postMessage({type:'ready'});
    </script></body></html>`;
  }

  protected async onMessage(message: CanvasInbound): Promise<void> {
    try {
      if (message.type === "ready" || message.type === "refresh") return void await this.refresh();
      if (message.type === "web") return void vscode.env.openExternal(vscode.Uri.parse(`https://builderforce.ai/create/${this.sessionId}`));
      if (message.type === "file.open" && message.path) return void vscode.window.showTextDocument(vscode.Uri.file(message.path));
      if (message.type === "selection.change") {
        this.selectedObjectId = message.objectId;
        await this.publishPresence();
        await this.publishComments();
        return;
      }
      if (message.type === "comment.add" && message.body) {
        await bfApi.createCreationComment(this.ctx.secrets, this.sessionId, message.body.slice(0, 5_000), message.objectId);
        await this.publishComments();
        return;
      }
      if (message.type === "checkpoint") {
        const label = await vscode.window.showInputBox({ title: vscode.l10n.t("Create Canvas checkpoint"), prompt: vscode.l10n.t("Name this revision"), value: `VS Code checkpoint ${new Date().toLocaleString()}` });
        if (label?.trim()) await bfApi.createCreationCheckpoint(this.ctx.secrets, this.sessionId, label.trim());
        return;
      }
      if (message.type === "history") {
        const history = await bfApi.listCreationHistory(this.ctx.secrets, this.sessionId);
        const picked = await vscode.window.showQuickPick(history.map((entry) => ({ label: entry.label || vscode.l10n.t("Revision {0}", entry.revision), description: new Date(entry.createdAt).toLocaleString(), revision: entry.revision })), { title: vscode.l10n.t("Restore Canvas checkpoint as a new revision") });
        if (!picked) return;
        const confirm = await vscode.window.showWarningMessage(vscode.l10n.t("Replace the current Canvas with revision {0}? The current state remains recoverable in history.", picked.revision), { modal: true }, vscode.l10n.t("Restore"));
        if (confirm !== vscode.l10n.t("Restore")) return;
        const snapshot = await bfApi.getCreationSnapshot(this.ctx.secrets, this.sessionId, picked.revision);
        await this.command({ type: "graph.replace", objects: snapshot.graph.objects, connections: snapshot.graph.connections });
        return;
      }
      if (message.type === "branch") {
        const title = await vscode.window.showInputBox({ title: vscode.l10n.t("Create Canvas branch"), value: `${this.detail?.session.title || "Canvas"} — branch` });
        if (!title?.trim()) return;
        const result = await bfApi.createCreationBranch(this.ctx.secrets, this.sessionId, title.trim());
        CreationCanvasPanel.open(this.ctx, result.session.id, result.session.title);
        return;
      }
      if (message.type === "merge") return void await this.mergeIntoParent();
      if (message.type === "object.delete" && message.objectId) {
        const object = this.detail?.objects.find((candidate) => candidate.id === message.objectId);
        if (!object) throw new Error(vscode.l10n.t("Select an object to delete"));
        const title = String(object.content?.title || object.kind);
        const accepted = await vscode.window.showWarningMessage(vscode.l10n.t("Delete “{0}” and its Canvas connections? This change remains recoverable through checkpoint history.", title), { modal: true }, vscode.l10n.t("Delete"));
        if (accepted === vscode.l10n.t("Delete")) { await this.command({ type: "object.delete", objectId: object.id }); this.selectedObjectId = undefined; }
        return;
      }
      if (message.type === "file.add") {
        const editor = vscode.window.activeTextEditor;
        if (!editor) throw new Error(vscode.l10n.t("Open a file first"));
        await this.addObject("code", vscode.workspace.asRelativePath(editor.document.uri), {
          path: editor.document.uri.fsPath, language: editor.document.languageId,
          subtitle: vscode.l10n.t("VS Code file — double-click to open"),
        });
      } else if (message.type === "selection.add") {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) throw new Error(vscode.l10n.t("Select a range in an open file first"));
        const range = editor.selection;
        await this.addObject("selection", `${vscode.workspace.asRelativePath(editor.document.uri)}:${range.start.line + 1}-${range.end.line + 1}`, {
          path: editor.document.uri.fsPath, language: editor.document.languageId,
          range: { startLine: range.start.line + 1, startColumn: range.start.character + 1, endLine: range.end.line + 1, endColumn: range.end.character + 1 },
          subtitle: vscode.l10n.t("VS Code selection reference (source text remains in the editor)"),
        });
      } else if (message.type === "diagnostics.add") {
        const editor = vscode.window.activeTextEditor;
        if (!editor) throw new Error(vscode.l10n.t("Open a file with diagnostics first"));
        const diagnostics = vscode.languages.getDiagnostics(editor.document.uri).slice(0, 50).map((item) => ({
          severity: vscode.DiagnosticSeverity[item.severity], message: item.message.slice(0, 1_000),
          line: item.range.start.line + 1, source: item.source,
        }));
        await this.addObject("diagnostics", `Problems — ${vscode.workspace.asRelativePath(editor.document.uri)}`, {
          path: editor.document.uri.fsPath, subtitle: vscode.l10n.t("{0} diagnostics from VS Code", diagnostics.length), diagnostics,
        });
      } else if (message.type === "repository.add") {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) throw new Error(vscode.l10n.t("Open a repository or workspace folder first"));
        const git = vscode.extensions.getExtension("vscode.git")?.exports?.getAPI?.(1);
        const repository = git?.getRepository?.(folder.uri);
        await this.addObject("repository", folder.name, {
          path: folder.uri.fsPath, branch: repository?.state?.HEAD?.name || null,
          subtitle: repository?.state?.HEAD?.name ? vscode.l10n.t("Branch {0}", repository.state.HEAD.name) : vscode.l10n.t("VS Code workspace repository"),
        });
      } else if (message.type === "terminal.add") {
        const terminalName = vscode.window.activeTerminal?.name || "Terminal output";
        let terminalOutput = (await vscode.env.clipboard.readText()).trim();
        if (!terminalOutput) terminalOutput = await vscode.window.showInputBox({ title: vscode.l10n.t("Add terminal output"), prompt: vscode.l10n.t("Paste the terminal output to store in this Session") }) || "";
        if (!terminalOutput) return;
        const addToSession = vscode.l10n.t("Add to Session");
        const accepted = await vscode.window.showWarningMessage(vscode.l10n.t("Store the clipboard/pasted terminal output in this shared Creation Session? Review it for secrets first."), { modal: true }, addToSession);
        if (accepted !== addToSession) return;
        await this.addObject("terminal", terminalName, { subtitle: vscode.l10n.t("Terminal output added from VS Code"), text: terminalOutput.slice(0, 20_000), language: "text" });
      } else if (message.type === "preview.add") {
        const url = await vscode.window.showInputBox({ title: vscode.l10n.t("Add local service or browser preview"), prompt: vscode.l10n.t("Enter an http(s) URL"), placeHolder: "http://localhost:3000", validateInput: (value) => /^https?:\/\//i.test(value) ? undefined : vscode.l10n.t("Enter an http(s) URL") });
        if (!url) return;
        await this.addObject("service", new URL(url).host, { url, subtitle: vscode.l10n.t("Local service preview added from VS Code") });
      } else if (message.type === "object.add" && isCreationObjectKind(message.kind)) {
        await this.addObject(message.kind, message.title || message.kind, { status: vscode.l10n.t("Draft") });
      } else if (message.type === "prompt" && message.title) {
        await this.addObject("chat", "Brain", { subtitle: message.title, status: vscode.l10n.t("Queued from VS Code"), messages: [{ role: "user", content: message.title, createdAt: new Date().toISOString() }] });
      } else if (message.type === "object.move" && message.objectId && Number.isFinite(message.x) && Number.isFinite(message.y)) {
        await this.command({ type: "object.move", objectId: message.objectId, geometry: { x: message.x, y: message.y } });
      }
    } catch (error) { this.post({ type: "error", message: (error as Error).message }); }
  }

  private async addObject(kind: string, title: string, content: Record<string, unknown>): Promise<void> {
    await this.command({ type: "object.add", kind, geometry: { x: 260, y: 180 }, content: { kind, title, ...content } });
  }

  private async command(command: unknown): Promise<void> {
    if (!this.detail) await this.refresh();
    const saved = await bfApi.applyCreationCommands(this.ctx.secrets, this.sessionId, this.detail!.session.canvasRevision, [command]);
    this.detail!.session.canvasRevision = saved.revision;
    await this.refresh();
  }

  /** Native, per-object reviewed merge. Parent-only objects are preserved. */
  private async mergeIntoParent(): Promise<void> {
    if (!this.detail) await this.refresh();
    const parentId = this.detail!.session.branchParentSessionId;
    if (!parentId) throw new Error(vscode.l10n.t("This Canvas is not a branch"));
    const parent = await bfApi.getCreationSession(this.ctx.secrets, parentId);
    const remainingParentIds = new Set(parent.objects.map((object) => object.id));
    const merged: bfApi.BfCreationObject[] = [];
    const branchToParent = new Map<string, string>();
    for (const source of this.detail!.objects) {
      const origin = typeof source.content?._branchOriginId === "string" ? source.content._branchOriginId : undefined;
      const target = parent.objects.find((candidate) => remainingParentIds.has(candidate.id) && (candidate.id === origin || (candidate.kind === source.kind && candidate.content?.title === source.content?.title)));
      let useBranch = true;
      if (target && JSON.stringify({ c: target.content, p: target.canvasData }) !== JSON.stringify({ c: source.content, p: source.canvasData })) {
        const choice = await vscode.window.showQuickPick([
          { label: vscode.l10n.t("Use branch version"), value: "branch" },
          { label: vscode.l10n.t("Keep parent version"), value: "parent" },
        ], { title: vscode.l10n.t("Merge “{0}”", String(source.content?.title || source.kind)), placeHolder: vscode.l10n.t("Review this object before merging") });
        if (!choice) return;
        useBranch = choice.value === "branch";
      }
      const id = target?.id || crypto.randomUUID();
      branchToParent.set(source.id, id);
      if (target) remainingParentIds.delete(target.id);
      merged.push(useBranch ? { ...source, id } : target!);
    }
    merged.push(...parent.objects.filter((object) => remainingParentIds.has(object.id)));
    const mergedIds = new Set(merged.map((object) => object.id));
    const parentConnections = parent.connections.filter((edge) => mergedIds.has(edge.sourceObjectId) && mergedIds.has(edge.targetObjectId));
    const branchConnections = this.detail!.connections.flatMap((edge) => {
      const sourceObjectId = branchToParent.get(edge.sourceObjectId), targetObjectId = branchToParent.get(edge.targetObjectId);
      return sourceObjectId && targetObjectId ? [{ ...edge, id: crypto.randomUUID(), sourceObjectId, targetObjectId }] : [];
    });
    const unique = new Map([...parentConnections, ...branchConnections].map((edge) => [`${edge.sourceObjectId}:${edge.targetObjectId}:${edge.kind || "reference"}:${edge.label || ""}`, edge]));
    const accepted = await vscode.window.showWarningMessage(vscode.l10n.t("Apply the reviewed merge to “{0}” as a new revision?", parent.session.title), { modal: true }, vscode.l10n.t("Merge"));
    if (accepted !== vscode.l10n.t("Merge")) return;
    await bfApi.applyCreationCommands(this.ctx.secrets, parentId, parent.session.canvasRevision, [{ type: "graph.replace", objects: merged, connections: [...unique.values()] }]);
    CreationCanvasPanel.open(this.ctx, parentId, parent.session.title);
  }

  private async publishComments(): Promise<void> {
    const comments = await bfApi.listCreationComments(this.ctx.secrets, this.sessionId, this.selectedObjectId);
    this.post({ type: "comments", comments });
  }

  private async publishPresence(): Promise<void> {
    if (!this.detail) return;
    try {
      const presence = await bfApi.updateCreationPresence(this.ctx.secrets, this.sessionId, this.detail.session.canvasRevision, this.selectedObjectId ? [this.selectedObjectId] : []);
      this.detail.members = presence.members;
      this.detail.currentUserId = presence.currentUserId;
      this.post({ type: "session", detail: this.detail });
    } catch { /* Presence is best effort; durable Canvas editing remains available. */ }
  }

  /** Pull the canonical event log so web edits appear without manually refreshing. */
  private async catchUp(): Promise<void> {
    if (!this.detail || !this.panel.visible) return;
    try {
      const currentRevision = this.detail.session.canvasRevision;
      const delta = await bfApi.getCreationEvents(this.ctx.secrets, this.sessionId, currentRevision);
      if (delta.revision > currentRevision || delta.events.length > 0) await this.refresh();
    } catch { /* Reconnect polling is best effort; the next interval catches up. */ }
  }

  private async refresh(): Promise<void> {
    this.detail = await bfApi.getCreationSession(this.ctx.secrets, this.sessionId);
    this.post({ type: "session", detail: this.detail });
    await Promise.all([this.publishComments(), this.publishPresence()]);
  }

  protected onDispose(): void { CreationCanvasPanel.panels.delete(this.sessionId); }
}
