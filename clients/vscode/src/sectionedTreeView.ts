import * as vscode from "vscode";

/**
 * One part of a sectioned sidebar view: an existing tree provider shown under a
 * collapsible header (or, with no `label`, inlined at the view's root).
 *
 * The composite never wraps the provider's elements: it hands the provider's own
 * objects to VS Code and remembers which section owns each one. That keeps every
 * context-menu and click command receiving exactly the argument it received when
 * the provider had a view of its own.
 */
export interface TreeSection {
  /** Stable id, unique within the view. Also prefixes the provider's item ids. */
  readonly id: string;
  /** Header text. Omit to inline the provider's rows at the view root. */
  readonly label?: string;
  readonly icon?: string;
  /** Start collapsed (VS Code remembers the user's choice after that). */
  readonly collapsed?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each section owns its own element type
  readonly provider: vscode.TreeDataProvider<any>;
  /** Shown in place of the rows when the provider returns none. */
  readonly empty?: { label: string; command?: string };
  /** Header description, read each time the header repaints. */
  readonly describe?: () => string | undefined;
}

export interface SectionedViewChrome {
  /** The view title's description, re-read whenever a section loads. */
  readonly describe?: () => string | undefined;
  /** The view badge, re-read whenever a section loads. */
  readonly badge?: () => vscode.ViewBadge | undefined;
}

class SectionHeader {
  constructor(readonly section: TreeSection) {}
}

class SectionEmpty {
  constructor(readonly section: TreeSection) {}
}

type Element = object;

/** Composite provider: section headers at the root, each delegating to its provider. */
class SectionedTreeProvider implements vscode.TreeDataProvider<Element>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Element | undefined | void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly loaded = new vscode.EventEmitter<void>();
  /** Fires after any section's rows load, so the view chrome can re-read counts. */
  readonly onDidLoad = this.loaded.event;

  private readonly owner = new WeakMap<Element, TreeSection>();
  private readonly headers = new Map<TreeSection, SectionHeader>();
  private readonly subs: vscode.Disposable[] = [];

  constructor(private readonly viewId: string, private readonly sections: readonly TreeSection[]) {
    for (const section of sections) {
      if (section.label) this.headers.set(section, new SectionHeader(section));
      const sub = section.provider.onDidChangeTreeData?.((el) => this.onSectionChanged(section, el));
      if (sub) this.subs.push(sub);
    }
  }

  /** Repaint only what changed: the provider's element, else its header, else the root. */
  private onSectionChanged(section: TreeSection, el: unknown): void {
    if (el && typeof el === "object" && !Array.isArray(el) && this.owner.get(el) === section) {
      this.changed.fire(el);
      return;
    }
    this.changed.fire(this.headers.get(section));
  }

  getTreeItem(el: Element): vscode.TreeItem | Thenable<vscode.TreeItem> {
    if (el instanceof SectionHeader) return this.headerItem(el.section);
    if (el instanceof SectionEmpty) {
      const empty = el.section.empty!;
      const item = new vscode.TreeItem(empty.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("info");
      if (empty.command) item.command = { command: empty.command, title: empty.label };
      return item;
    }
    const section = this.owner.get(el);
    if (!section) return new vscode.TreeItem("");
    return Promise.resolve(section.provider.getTreeItem(el)).then((item) => this.scopeId(section, item));
  }

  async getChildren(el?: Element): Promise<Element[]> {
    if (!el) {
      const root: Element[] = [];
      for (const section of this.sections) {
        const header = this.headers.get(section);
        if (header) root.push(header);
        else root.push(...(await this.load(section, undefined)));
      }
      return root;
    }
    if (el instanceof SectionHeader) {
      const rows = await this.load(el.section, undefined);
      return rows.length === 0 && el.section.empty ? [new SectionEmpty(el.section)] : rows;
    }
    if (el instanceof SectionEmpty) return [];
    const section = this.owner.get(el);
    return section ? this.load(section, el) : [];
  }

  private async load(section: TreeSection, el: Element | undefined): Promise<Element[]> {
    const rows = ((await section.provider.getChildren(el)) ?? []) as Element[];
    for (const row of rows) this.owner.set(row, section);
    this.loaded.fire();
    return rows;
  }

  private headerItem(section: TreeSection): vscode.TreeItem {
    const item = new vscode.TreeItem(
      section.label!,
      section.collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
    );
    item.id = `${this.viewId}/${section.id}`;
    item.contextValue = `bfSection.${section.id}`;
    item.description = section.describe?.();
    if (section.icon) item.iconPath = new vscode.ThemeIcon(section.icon);
    return item;
  }

  /** Item ids must be unique across the WHOLE tree; two providers can reuse an id. */
  private scopeId(section: TreeSection, item: vscode.TreeItem): vscode.TreeItem {
    const prefix = `${section.id}/`;
    if (item.id && !item.id.startsWith(prefix)) item.id = `${prefix}${item.id}`;
    return item;
  }

  dispose(): void {
    for (const sub of this.subs) sub.dispose();
    this.changed.dispose();
    this.loaded.dispose();
  }
}

/**
 * Register a sidebar view built from several existing tree providers. Returns one
 * disposable that owns the view, the composite provider and the chrome listener.
 */
export function createSectionedTreeView(
  viewId: string,
  sections: readonly TreeSection[],
  chrome: SectionedViewChrome = {},
): vscode.Disposable {
  const provider = new SectionedTreeProvider(viewId, sections);
  const view = vscode.window.createTreeView(viewId, { treeDataProvider: provider });
  const paint = () => {
    if (chrome.describe) view.description = chrome.describe();
    if (chrome.badge) view.badge = chrome.badge();
  };
  paint();
  const sub = provider.onDidLoad(paint);
  return vscode.Disposable.from(sub, view, provider);
}
