import { useMemo, useRef, useState } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { STAGE_CAMERA_VIEWS, STANDARD_VIEWS, UML_BEHAVIOR, UML_INTERACTION, UML_STRUCTURE, type DiagramId, type UmlDiagramId } from '../../surface/diagrams/catalog';
import { diagramFromFile, sourceDiagram, type Diagram } from '../../surface/diagrams/model';
import type { Station } from '../../surface/stations';
import { TYPE } from '../../surface/ui/type';
import type { SymbolRecord, ViewMode } from '../../types';
import { DiagramView } from './DiagramView';

interface Props {
    active: DiagramId | null; onPick(id: DiagramId | null): void;
    graph: KnowledgeGraph; records: readonly SymbolRecord[]; scope: string | null;
    stations: readonly Station[]; flat: boolean; labels: KnowledgeGraphLabels; onOpen(ref: string): void;
    /** Switches the stage camera. Without it, or when the camera is not available, the views the stage draws are not offered. */
    onCamera?: ((mode: ViewMode) => void) | undefined; cameras?: readonly ViewMode[] | undefined;
    onLoadSymbols?: ((ref: string) => void) | undefined;
}

const IMPORT_BYTES = 1024 * 1024;
const C4_NEXT: Partial<Record<DiagramId, DiagramId>> = { c4Context: 'c4Containers', c4Containers: 'c4Components', c4Components: 'c4Code' };

export function DiagramPicker(props: Props) {
    return <ProjectDiagramPicker key={props.graph.scope.rootId} {...props} />;
}

function ProjectDiagramPicker({ active, onPick, graph, records, scope, stations, flat, labels, onOpen, onCamera, cameras, onLoadSymbols }: Props) {
    const t = labels.surface.code;
    const input = useRef<HTMLInputElement>(null);
    const [imported, setImported] = useState<ReadonlyMap<string, Diagram>>(() => new Map());
    const [failed, setFailed] = useState<string | null>(null);
    const [c4Anchor, setC4Anchor] = useState<{ level: DiagramId; ref: string } | null>(null);
    const anchored = c4Anchor?.level === active ? c4Anchor.ref : active === 'c4Containers' || active === 'c4Components' ? null : scope;
    const indexed = useMemo(() => active ? sourceDiagram(active, graph, records, anchored, stations) : null, [active, graph, records, anchored, stations]);
    const key = active ? JSON.stringify([graph.scope.rootId, active]) : null;
    const provided = key ? imported.get(key) : undefined;
    const diagram = provided ?? indexed;
    const offered = <T extends DiagramId>(options: readonly T[]) => options.filter((option) => {
        const mode = STAGE_CAMERA_VIEWS[option];
        return !mode || !!onCamera && !!cameras?.includes(mode);
    });
    const group = (name: string, options: readonly UmlDiagramId[]) => <optgroup label={name}>
        {offered(options).map((option) => <option key={option} value={option}>{t[option]}</option>)}
    </optgroup>;
    const load = async (file: File, keyOfRequest: string, id: DiagramId) => {
        let candidate: Diagram | null = null;
        try {
            if (file.size <= IMPORT_BYTES) candidate = diagramFromFile(id, JSON.parse(await file.text()));
        } catch { /* Invalid JSON has the same status as an invalid model. */ }
        if (!candidate) { setFailed(keyOfRequest); return; }
        const model = candidate;
        setImported((current) => new Map(current).set(keyOfRequest, model));
        setFailed(null);
    };
    return <>
        <div data-diagram-controls style={{
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '4px 10px',
            background: cssVar('panel'), borderBottom: `1px solid ${cssVar('border')}`, ...TYPE.meta,
        }}>
            <select aria-label={t.diagramUml} value={active ?? ''} onChange={(event) => {
                setC4Anchor(null);
                const pick = event.currentTarget.value as DiagramId || null;
                const mode = pick ? STAGE_CAMERA_VIEWS[pick] : undefined;
                onPick(mode ? null : pick);
                if (mode) onCamera?.(mode);
            }}>
                <option value="">{t.diagramUml}</option>
                {group(t.diagramStructure, UML_STRUCTURE)}
                {group(t.diagramBehavior, UML_BEHAVIOR)}
                {group(t.diagramInteraction, UML_INTERACTION)}
                <optgroup label={t.diagramStandards}>
                    {offered(STANDARD_VIEWS).map((id) => <option key={id} value={id}>{t[id]}</option>)}
                </optgroup>
            </select>
            {active && key && <>
                <button type="button" onClick={() => input.current?.click()}>{t.diagramImport}</button>
                <input ref={input} type="file" accept=".json,application/json" hidden onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) void load(file, key, active);
                }} />
                {provided ? <button type="button" onClick={() => setImported((current) => {
                    const next = new Map(current); next.delete(key); return next;
                })}>{labels.close}</button> : null}
                {diagram?.nodes.length ? <span>{provided ? t.diagramProvided : t.diagramIndexed}</span> : null}
                {failed === key && <span role="alert">{t.diagramInvalid}</span>}
            </>}
        </div>
        {active && <div data-diagram-pane style={{
            position: 'relative', flex: 1, minHeight: 0, minWidth: 0, overflow: 'auto', perspective: '1200px', background: cssVar('bg'),
        }}>
            {diagram?.nodes.length
                ? <DiagramView id={active} model={diagram} flat={flat} labels={labels} onOpen={(ref) => {
                    const next = C4_NEXT[active];
                    if (!next) { onOpen(ref); return; }
                    setC4Anchor({ level: next, ref });
                    if (next === 'c4Code') onLoadSymbols?.(ref);
                    onPick(next);
                }} />
                : <p role="status" style={{ ...TYPE.body, margin: 14 }}>{t.diagramNoData}</p>}
        </div>}
    </>;
}
