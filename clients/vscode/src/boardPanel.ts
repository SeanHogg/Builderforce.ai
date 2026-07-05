import * as vscode from "vscode";
import { BfTask, DEFAULT_HIDE_DONE, invalidateTasks, listTasks, updateTaskStatus } from "./bfApi";
import { makeNonce } from "./webviewShared";

/**
 * Native Kanban board rendered directly in a webview panel — NOT the embedded web
 * page. The `/embed/*` iframe approach proved unreliable inside a VS Code webview
 * (COEP/credentialless + the web app's global provider stack fail to mount there),
 * so this draws the board from the SAME data the sidebar already loads via `bfApi`
 * (the shared data layer), over the proven gateway → tenant-JWT → /api/tasks path.
 * Drag a card to restage it (→ updateTaskStatus, which also drives lane automation
 * server-side); click a card to start a task-scoped chat session.
 */

/** Board columns, in flow order. Keep the status keys in sync with `setTaskStatus`
 *  in extension.ts and the web app's task statuses (the one runtime boundary we
 *  can't share a component across — same model, separate render). */
const COLUMNS: { key: string; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "todo", label: "To Do" },
  { key: "ready", label: "Ready" },
  { key: "in_progress", label: "In Progress" },
  { key: "in_review", label: "In Review" },
  { key: "done", label: "Done" },
  { key: "blocked", label: "Blocked" },
];
const KNOWN = new Set(COLUMNS.map((c) => c.key));
/** Tasks with an unknown/empty status bucket into Backlog so nothing is hidden. */
const FALLBACK_STATUS = "backlog";

export class BoardPanel {
  private static readonly panels = new Map<number, BoardPanel>();

  static open(ctx: vscode.ExtensionContext, projectId: number, projectName: string): void {
    const existing = BoardPanel.panels.get(projectId);
    if (existing) {
      existing.panel.reveal();
      void existing.refresh();
      return;
    }
    BoardPanel.panels.set(projectId, new BoardPanel(ctx, projectId, projectName));
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly projectId: number,
    private readonly projectName: string,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "builderforce.board",
      `BuilderForce Board — ${projectName}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "icon.png");
    this.panel.webview.html = this.html(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(
      (m: { type: string; taskId?: number; status?: string }) => void this.onMessage(m),
      undefined,
      this.disposables,
    );
    this.panel.onDidDispose(
      () => {
        BoardPanel.panels.delete(this.projectId);
        for (const d of this.disposables) {
          try {
            d.dispose();
          } catch {
            /* noop */
          }
        }
      },
      undefined,
      this.disposables,
    );
  }

  private async onMessage(m: { type: string; taskId?: number; status?: string }): Promise<void> {
    switch (m.type) {
      case "ready":
      case "refresh":
        await this.refresh(m.type === "refresh");
        break;
      case "move":
        if (typeof m.taskId === "number" && m.status) await this.move(m.taskId, m.status);
        break;
      case "open":
        if (typeof m.taskId === "number") this.openTask(m.taskId);
        break;
      case "run":
        if (typeof m.taskId === "number") await this.runTask(m.taskId);
        break;
    }
  }

  /** Load tasks (shared bfApi cache) and push the board to the webview. */
  private async refresh(force = false): Promise<void> {
    this.post({ type: "loading" });
    try {
      const tasks = await listTasks(this.ctx.secrets, this.projectId, force);
      this.lastTasks = tasks;
      this.post({ type: "data", projectName: this.projectName, columns: COLUMNS, tasks: tasks.map(toCard) });
    } catch (e) {
      this.post({ type: "error", message: (e as Error).message });
    }
  }

  /** Optimistic restage: tell the server, bust the shared task cache, re-pull. */
  private async move(taskId: number, status: string): Promise<void> {
    if (!KNOWN.has(status)) return;
    try {
      await updateTaskStatus(this.ctx.secrets, taskId, status);
      invalidateTasks(this.projectId);
      await this.refresh(true);
    } catch (e) {
      vscode.window.showErrorMessage(`BuilderForce: could not move task (${(e as Error).message}).`);
      await this.refresh(true); // resync to the server's truth
    }
  }

  private openTask(taskId: number): void {
    const task = this.lastTasks.find((t) => t.id === taskId);
    if (task) void vscode.commands.executeCommand("builderforce.startTaskSession", { kind: "task", task });
  }

  /** Dispatch a PLATFORM run for a card — delegates to the shared runTask command (DRY:
   *  same dispatch/approval/plan-limit handling as the tree's inline Run action), then
   *  re-pulls so a status change from the run surfaces on the board. */
  private async runTask(taskId: number): Promise<void> {
    const task = this.lastTasks.find((t) => t.id === taskId);
    if (!task) return;
    await vscode.commands.executeCommand("builderforce.runTask", { kind: "task", task });
    await this.refresh(true);
  }

  private lastTasks: BfTask[] = [];

  private post(msg: unknown): void {
    void this.panel.webview.postMessage(msg);
  }

  private html(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource}`,
      `style-src 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); display: flex; flex-direction: column; }
  #bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  #bar h1 { font-size: 13px; font-weight: 600; margin: 0; }
  #bar .spacer { flex: 1; }
  #bar .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
  button { font: inherit; padding: 3px 10px; border: 0; border-radius: 2px; cursor: pointer;
    color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  #board { flex: 1; display: flex; gap: 10px; padding: 12px; overflow-x: auto; align-items: flex-start; }
  .col { flex: 0 0 240px; display: flex; flex-direction: column; max-height: 100%;
    background: var(--vscode-sideBar-background, rgba(127,127,127,0.06)); border: 1px solid var(--vscode-panel-border); border-radius: 6px; }
  .col h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin: 0; padding: 8px 10px;
    color: var(--vscode-descriptionForeground); display: flex; justify-content: space-between; }
  .col .count { opacity: .7; }
  .drop { flex: 1; min-height: 24px; padding: 6px; display: flex; flex-direction: column; gap: 6px; overflow-y: auto; }
  .col.over .drop { outline: 1px dashed var(--vscode-focusBorder); outline-offset: -3px; border-radius: 4px; }
  .card { background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); border: 1px solid var(--vscode-panel-border);
    border-radius: 5px; padding: 8px; cursor: grab; }
  .card:hover { border-color: var(--vscode-focusBorder); }
  .card .key { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .card .title { font-size: 13px; margin-top: 2px; }
  .card .meta { margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .card .run { margin-left: auto; font-size: 10px; padding: 1px 8px; border-radius: 8px; border: 0;
    color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
  .card .run:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
  .chip { font-size: 10px; padding: 1px 6px; border-radius: 8px; border: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); }
  .chip.p-high, .chip.p-urgent { color: #f87171; border-color: #f8717155; }
  #overlay { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; gap: 12px;
    background: var(--vscode-editor-background); text-align: center; padding: 24px; }
  #overlay.show { display: flex; }
  #overlay .sub { color: var(--vscode-descriptionForeground); font-size: 12px; max-width: 420px; }
  .spinner { width: 18px; height: 18px; border: 2px solid var(--vscode-descriptionForeground); border-top-color: transparent;
    border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div id="bar">
  <h1 id="proj">BuilderForce Board</h1>
  <span id="summary" class="muted"></span>
  <span class="spacer"></span>
  <button id="toggle-done" class="secondary" aria-pressed="false">Hide done</button>
  <button id="refresh" class="secondary">Refresh</button>
</div>
<div id="board"></div>
<div id="overlay" class="show">
  <div class="spinner"></div>
  <div class="sub" id="overlay-sub">Loading board…</div>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const boardEl = document.getElementById('board');
  const overlay = document.getElementById('overlay');
  const overlaySub = document.getElementById('overlay-sub');
  const projEl = document.getElementById('proj');
  const summaryEl = document.getElementById('summary');
  const toggleDoneBtn = document.getElementById('toggle-done');
  document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));

  // "Hide done" is a pure view filter (no refetch); persist it across reloads via
  // the webview state so the board reopens the way the user left it. Defaults to
  // hiding done (show only active work) until the user explicitly toggles.
  const savedState = vscode.getState();
  let hideDone = savedState ? !!savedState.hideDone : ${DEFAULT_HIDE_DONE};
  let lastTasks = [];
  function syncToggle() {
    toggleDoneBtn.textContent = hideDone ? 'Show done' : 'Hide done';
    toggleDoneBtn.setAttribute('aria-pressed', String(hideDone));
  }
  toggleDoneBtn.addEventListener('click', () => {
    hideDone = !hideDone;
    vscode.setState({ hideDone });
    syncToggle();
    render(lastTasks);
  });
  syncToggle();

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function showOverlay(text) { overlaySub.textContent = text; overlay.classList.add('show'); }
  function hideOverlay() { overlay.classList.remove('show'); }

  let columns = [];
  function render(tasks) {
    boardEl.innerHTML = '';
    const cols = hideDone ? columns.filter(c => c.key !== 'done') : columns;
    const byStatus = {};
    cols.forEach(c => byStatus[c.key] = []);
    // toCard() already normalised every task to a known status, so a task with no
    // bucket here means its column is filtered out (done, when hidden) → drop it.
    let shown = 0;
    tasks.forEach(t => { const b = byStatus[t.status]; if (b) { b.push(t); shown++; } });
    summaryEl.textContent = shown + ' task' + (shown === 1 ? '' : 's') + (hideDone && shown < tasks.length ? ' (' + (tasks.length - shown) + ' done hidden)' : '');

    cols.forEach(col => {
      const items = byStatus[col.key] || [];
      const colEl = document.createElement('div');
      colEl.className = 'col';
      colEl.dataset.status = col.key;
      const head = document.createElement('h2');
      head.innerHTML = esc(col.label) + '<span class="count">' + items.length + '</span>';
      const drop = document.createElement('div');
      drop.className = 'drop';
      items.forEach(t => drop.appendChild(card(t)));
      colEl.appendChild(head);
      colEl.appendChild(drop);

      colEl.addEventListener('dragover', (e) => { e.preventDefault(); colEl.classList.add('over'); });
      colEl.addEventListener('dragleave', () => colEl.classList.remove('over'));
      colEl.addEventListener('drop', (e) => {
        e.preventDefault();
        colEl.classList.remove('over');
        const id = Number(e.dataTransfer.getData('text/plain'));
        if (id) vscode.postMessage({ type: 'move', taskId: id, status: col.key });
      });
      boardEl.appendChild(colEl);
    });
  }

  function card(t) {
    const el = document.createElement('div');
    el.className = 'card';
    el.draggable = true;
    const pr = t.priority ? '<span class="chip p-' + esc(t.priority) + '">' + esc(t.priority) + '</span>' : '';
    const as = t.assignee ? '<span class="chip">' + esc(t.assignee) + '</span>' : '';
    el.innerHTML =
      (t.key ? '<div class="key">' + esc(t.key) + '</div>' : '') +
      '<div class="title">' + esc(t.title) + '</div>' +
      '<div class="meta">' + pr + as + '<button class="run" title="Dispatch this task to the platform runtime">Run</button></div>';
    el.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', String(t.id)));
    el.addEventListener('click', () => vscode.postMessage({ type: 'open', taskId: t.id }));
    // Run dispatches a PLATFORM run; stop the click so it doesn't also open the session.
    el.querySelector('.run').addEventListener('click', (e) => { e.stopPropagation(); vscode.postMessage({ type: 'run', taskId: t.id }); });
    return el;
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'loading') { showOverlay('Loading board…'); }
    else if (m.type === 'data') {
      columns = m.columns;
      lastTasks = m.tasks;
      projEl.textContent = 'BuilderForce Board — ' + (m.projectName || '');
      render(lastTasks);
      hideOverlay();
    } else if (m.type === 'error') {
      showOverlay('Could not load the board — ' + (m.message || 'unknown error'));
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}

function toCard(t: BfTask): { id: number; key?: string; title: string; status: string; priority?: string; assignee?: string } {
  const status = t.status && KNOWN.has(t.status) ? t.status : FALLBACK_STATUS;
  return {
    id: t.id,
    key: t.key,
    title: t.title,
    status,
    priority: t.priority,
    assignee: t.assignedUserId ?? undefined,
  };
}
