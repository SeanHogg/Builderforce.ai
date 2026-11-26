/**
 * The Domains drawer: the host's proposed folder layout for one folder (loose files grouped by name and imports),
 * a checkbox per domain, Apply and Undo. It renders what the host returns and computes nothing: the layout, the
 * moves, the import rewrites, the branch and the undo record are the host's (`source.domains`,
 * `source.organizeDomains`, `source.undoOrganize`).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fillTemplate } from '../../labels';
import type { AppliedFix } from '../../fixPorts';
import type { DomainLayout, DomainReason } from '../../domainsPort';
import { button, card, input, list, muted, primaryButton } from '../../styles';
import type { PanelProps } from '../registry';
import { foldersByLooseFiles } from './domainsModel';
import { NotSetUp, Section } from './ui';

const REASON_LABEL = { 'existing-folder': 'domainsReasonFolder', name: 'domainsReasonName', 'test-subject': 'domainsReasonTest', imports: 'domainsReasonImports' } as const satisfies Record<DomainReason, string>;

type Load = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; layout: DomainLayout };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function DomainsPanel({ graph, labels, source, rootId, onChanged }: PanelProps) {
    const folders = useMemo(() => (rootId ? foldersByLooseFiles(graph, rootId) : []), [graph, rootId]);
    const [folder, setFolder] = useState<string | null>(null);
    const [load, setLoad] = useState<Load>({ status: 'loading' });
    const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [applied, setApplied] = useState<AppliedFix | null>(null);
    const [error, setError] = useState<string | null>(null);
    const current = folder ?? folders[0] ?? '';

    const refresh = useCallback(() => {
        if (!source?.domains || !rootId) return;
        setLoad({ status: 'loading' });
        source.domains(rootId, current).then(
            (layout) => { setLoad({ status: 'ready', layout }); setChosen(new Set(layout.domains.map((d) => d.id))); },
            (e: unknown) => setLoad({ status: 'failed', message: messageOf(e) }),
        );
    }, [source, rootId, current]);
    useEffect(refresh, [refresh]);

    if (!source?.domains || !source.organizeDomains || !rootId) return <NotSetUp title={labels.domainsTitle} body={labels.domainsNotSetUp} />;
    const { organizeDomains, undoOrganize } = source;

    const run = (work: () => Promise<void>) => {
        setBusy(true);
        setError(null);
        work().catch((e: unknown) => setError(messageOf(e))).finally(() => setBusy(false));
    };
    const apply = () => run(async () => {
        setApplied(await organizeDomains.call(source, rootId, current, [...chosen]));
        onChanged?.();
    });
    const undo = () => run(async () => {
        if (!applied?.fixId) return;
        await undoOrganize?.call(source, rootId, applied.fixId);
        setApplied(null);
        onChanged?.();
        refresh();
    });
    const toggle = (id: string) => setChosen((now) => { const next = new Set(now); if (!next.delete(id)) next.add(id); return next; });

    return (
        <div style={{ display: 'grid', gap: 12 }}>
            <Section title={labels.domainsTitle}>
                <label style={{ display: 'grid', gap: 4 }}>
                    <span style={muted}>{labels.domainsFolder}</span>
                    <select style={input} value={current} onChange={(e) => { setFolder(e.target.value); setApplied(null); }}>
                        {(folders.length > 0 ? folders : ['']).map((f) => <option key={f} value={f}>{f || '.'}</option>)}
                    </select>
                </label>
                <p style={{ ...muted, margin: 0 }}>{labels.domainsNote}</p>
                {load.status === 'failed' && <p role="alert" style={{ ...muted, margin: 0 }}>{load.message}</p>}
                {load.status === 'ready' && <Layout layout={load.layout} labels={labels} chosen={chosen} onToggle={toggle} />}
            </Section>
            {error && <p role="alert" style={{ ...muted, margin: 0 }}>{error}</p>}
            {applied && <p role="status" style={{ ...muted, margin: 0 }}>{fillTemplate(labels.domainsDone, { count: String(applied.changed.length) })}{applied.branch ? ` · ${applied.branch}` : ''}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={primaryButton} disabled={busy || applied !== null || load.status !== 'ready' || chosen.size === 0} onClick={apply}>{labels.domainsApply}</button>
                {applied?.fixId && <button type="button" style={button} disabled={busy} onClick={undo}>{labels.domainsUndo}</button>}
            </div>
        </div>
    );
}

function Layout({ layout, labels, chosen, onToggle }: { layout: DomainLayout; labels: PanelProps['labels']; chosen: ReadonlySet<string>; onToggle(id: string): void }) {
    if (layout.domains.length === 0 && layout.unassigned.length === 0 && layout.conflicts.length === 0) return <p style={{ ...muted, margin: 0 }}>{labels.domainsEmpty}</p>;
    return (
        <div style={{ display: 'grid', gap: 8 }}>
            <p style={{ ...muted, margin: 0 }}>{fillTemplate(labels.domainsCross, { before: String(layout.crossEdges.before), after: String(layout.crossEdges.after) })}</p>
            <ul style={list}>
                {layout.domains.map((domain) => (
                    <li key={domain.id} style={{ ...card, display: 'grid', gap: 4 }}>
                        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <input type="checkbox" checked={chosen.has(domain.id)} onChange={() => onToggle(domain.id)} />
                            <strong>{domain.id}</strong>
                            <span style={muted}>{domain.files.length}{domain.isNew ? ` · ${labels.domainsNew}` : ''}</span>
                        </label>
                        <ul style={{ ...list, gap: 2 }}>
                            {layout.moves.filter((m) => m.domain === domain.id).map((m) => (
                                <li key={m.from} style={muted}>{m.from} → {m.to} · {labels[REASON_LABEL[m.reason]]}</li>
                            ))}
                        </ul>
                    </li>
                ))}
            </ul>
            {layout.conflicts.length > 0 && <FileList title={labels.domainsConflicts} files={layout.conflicts.map((c) => `${c.from} → ${c.to}`)} />}
            {layout.unassigned.length > 0 && <FileList title={labels.domainsUnassigned} files={layout.unassigned} />}
        </div>
    );
}

function FileList({ title, files }: { title: string; files: string[] }) {
    return (
        <div style={{ display: 'grid', gap: 2 }}>
            <strong>{title} ({files.length})</strong>
            <ul style={{ ...list, gap: 2 }}>{files.map((f) => <li key={f} style={muted}>{f}</li>)}</ul>
        </div>
    );
}
