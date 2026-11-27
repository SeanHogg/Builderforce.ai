import { useMemo, useState } from 'react';
import { cmp } from '../../order';
import type { CodeFile, HierarchyView } from '../../surface/codeHierarchy';

type FileView = Exclude<HierarchyView, 'picture'>;

interface Folder {
    folders: Map<string, { name: string; node: Folder }>;
    files: CodeFile[];
}

const folder = (): Folder => ({ folders: new Map(), files: [] });

function fileTree(files: ReadonlyMap<string, CodeFile>, view: FileView): Folder {
    const root = folder();
    for (const file of files.values()) {
        if (view === 'architecture' && !file.isCode) continue;
        let current = root;
        for (const part of file[view]) {
            let branch = current.folders.get(part.id);
            if (!branch) {
                branch = { name: part.name, node: folder() };
                current.folders.set(part.id, branch);
            }
            current = branch.node;
        }
        current.files.push(file);
    }
    return root;
}

interface Location { ref: string; folders: readonly string[] }
interface TreeProps { node: Folder; location: Location | null; onFile(ref: string): void }

const revealCurrentFile = (row: HTMLButtonElement | null) => row?.scrollIntoView?.({ block: 'nearest' });

function TreeFolder({ name, node, location, onFile }: TreeProps & { name: string }) {
    const ref = location?.ref;
    const [expanded, setExpanded] = useState(!!ref);
    const [lastRef, setLastRef] = useState(ref);
    if (lastRef !== ref) {
        setLastRef(ref);
        if (ref) setExpanded(true);
    }
    return (
        <details open={expanded} onToggle={(e) => setExpanded(e.currentTarget.open)}>
            <summary className="kg-file-tree__row">{name}</summary>
            {expanded && <div style={{ paddingInlineStart: 14 }}><FolderContents node={node} location={location} onFile={onFile} /></div>}
        </details>
    );
}

function FolderContents({ node, location, onFile }: TreeProps) {
    const head = location?.folders[0];
    return <>
        {[...node.folders].sort(([a, left], [b, right]) => cmp(left.name, right.name) || cmp(a, b)).map(([id, child]) => (
            <TreeFolder key={id} name={child.name} node={child.node} location={location && head === id ? { ref: location.ref, folders: location.folders.slice(1) } : null} onFile={onFile} />
        ))}
        {[...node.files].sort((a, b) => cmp(a.name, b.name) || cmp(a.path, b.path)).map(({ ref, name, path }) => (
            <button key={ref} type="button" className="kg-file-tree__row" title={path} aria-current={location?.ref === ref ? 'true' : undefined}
                ref={location?.ref === ref ? revealCurrentFile : undefined} onClick={() => onFile(ref)}>{name}</button>
        ))}
    </>;
}

export function CodeHierarchyTree({ files, view, label, selected, onFile }: { files: ReadonlyMap<string, CodeFile>; view: FileView; label: string; selected: string | null; onFile(ref: string): void }) {
    const tree = useMemo(() => fileTree(files, view), [files, view]);
    const current = selected ? files.get(selected) : undefined;
    return (
        <div className="kg-file-tree" role="group" aria-label={label}>
            <FolderContents node={tree} location={current ? { ref: current.ref, folders: current[view].map((part) => part.id) } : null} onFile={onFile} />
        </div>
    );
}
