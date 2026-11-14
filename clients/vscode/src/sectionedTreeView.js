import * as vscode from "vscode";
class SectionHeader {
    section;
    constructor(section) {
        this.section = section;
    }
}
class SectionEmpty {
    section;
    constructor(section) {
        this.section = section;
    }
}
/** Composite provider: section headers at the root, each delegating to its provider. */
class SectionedTreeProvider {
    viewId;
    sections;
    changed = new vscode.EventEmitter();
    onDidChangeTreeData = this.changed.event;
    loaded = new vscode.EventEmitter();
    /** Fires after any section's rows load, so the view chrome can re-read counts. */
    onDidLoad = this.loaded.event;
    owner = new WeakMap();
    headers = new Map();
    subs = [];
    constructor(viewId, sections) {
        this.viewId = viewId;
        this.sections = sections;
        for (const section of sections) {
            if (section.label)
                this.headers.set(section, new SectionHeader(section));
            const sub = section.provider.onDidChangeTreeData?.((el) => this.onSectionChanged(section, el));
            if (sub)
                this.subs.push(sub);
        }
    }
    /** Repaint only what changed: the provider's element, else its header, else the root. */
    onSectionChanged(section, el) {
        if (el && typeof el === "object" && !Array.isArray(el) && this.owner.get(el) === section) {
            this.changed.fire(el);
            return;
        }
        this.changed.fire(this.headers.get(section));
    }
    getTreeItem(el) {
        if (el instanceof SectionHeader)
            return this.headerItem(el.section);
        if (el instanceof SectionEmpty) {
            const empty = el.section.empty;
            const item = new vscode.TreeItem(empty.label, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon("info");
            if (empty.command)
                item.command = { command: empty.command, title: empty.label };
            return item;
        }
        const section = this.owner.get(el);
        if (!section)
            return new vscode.TreeItem("");
        return Promise.resolve(section.provider.getTreeItem(el)).then((item) => this.scopeId(section, item));
    }
    async getChildren(el) {
        if (!el) {
            const root = [];
            for (const section of this.sections) {
                const header = this.headers.get(section);
                if (header)
                    root.push(header);
                else
                    root.push(...(await this.load(section, undefined)));
            }
            return root;
        }
        if (el instanceof SectionHeader) {
            const rows = await this.load(el.section, undefined);
            return rows.length === 0 && el.section.empty ? [new SectionEmpty(el.section)] : rows;
        }
        if (el instanceof SectionEmpty)
            return [];
        const section = this.owner.get(el);
        return section ? this.load(section, el) : [];
    }
    async load(section, el) {
        const rows = ((await section.provider.getChildren(el)) ?? []);
        for (const row of rows)
            this.owner.set(row, section);
        this.loaded.fire();
        return rows;
    }
    headerItem(section) {
        const item = new vscode.TreeItem(section.label, section.collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded);
        item.id = `${this.viewId}/${section.id}`;
        item.contextValue = `bfSection.${section.id}`;
        item.description = section.describe?.();
        if (section.icon)
            item.iconPath = new vscode.ThemeIcon(section.icon);
        return item;
    }
    /** Item ids must be unique across the WHOLE tree; two providers can reuse an id. */
    scopeId(section, item) {
        const prefix = `${section.id}/`;
        if (item.id && !item.id.startsWith(prefix))
            item.id = `${prefix}${item.id}`;
        return item;
    }
    dispose() {
        for (const sub of this.subs)
            sub.dispose();
        this.changed.dispose();
        this.loaded.dispose();
    }
}
/**
 * Register a sidebar view built from several existing tree providers. Returns one
 * disposable that owns the view, the composite provider and the chrome listener.
 */
export function createSectionedTreeView(viewId, sections, chrome = {}) {
    const provider = new SectionedTreeProvider(viewId, sections);
    const view = vscode.window.createTreeView(viewId, { treeDataProvider: provider });
    const paint = () => {
        if (chrome.describe)
            view.description = chrome.describe();
        if (chrome.badge)
            view.badge = chrome.badge();
    };
    paint();
    const sub = provider.onDidLoad(paint);
    const subs = [sub];
    if (chrome.onVisibility) {
        const onVisibility = chrome.onVisibility;
        onVisibility(view.visible);
        subs.push(view.onDidChangeVisibility((e) => onVisibility(e.visible)));
    }
    return vscode.Disposable.from(...subs, view, provider);
}
//# sourceMappingURL=sectionedTreeView.js.map