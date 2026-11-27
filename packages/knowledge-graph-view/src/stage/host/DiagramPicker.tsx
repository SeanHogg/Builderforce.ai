import { useMemo, useRef, useState } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { STANDARD_VIEWS, UML_BEHAVIOR, UML_INTERACTION, UML_STRUCTURE, type DiagramId, type UmlDiagramId } from '../../surface/diagrams/catalog';
import { diagramFromFile, sourceDiagram, type Diagram } from '../../surface/diagrams/model';
import type { Station } from '../../surface/stations';
import { TYPE } from '../../surface/ui/type';
import type { SymbolRecord } from '../../types';
import { DiagramView } from './DiagramView';

interface Props {
    active: DiagramId | null; onPick(id: DiagramId | null): void;
    graph: KnowledgeGraph; records: readonly SymbolRecord[]; scope: string | null;
    stations: readonly Station[]; flat: boolean; labels: KnowledgeGraphLabels; onOpen(ref: string): void;
}

const IMPORT_BYTES = 1024 * 1024;

export function DiagramPicker({ active, onPick, graph, records, scope, stations, flat, labels, onOpen }: Props) {
    const t = labels.surface.code;
    const input = useRef<HTMLInputElement>(null);
    const [imported, setImported] = useState<ReadonlyMap<string, Diagram>>(() => new Map());
    const [failed, setFailed] = useState<string | null>(null);
    const indexed = useMemo(() => active ? sourceDiagram(active, graph, records, scope, stations) : null, [active, graph, records, scope, stations]);
    const key = active ? JSON.stringify([graph.scope.rootId, active]) : null;
    const provided = key && imported.get(key);
    const diagram = provided || indexed;
    const group = (name: string, options: readonly UmlDiagramId[]) => <optgroup label={name}>
        {options.map((option) => <option key={option} value={option}>{t[option]}</option>)}
    </optgroup>;
    const load = async (file: File, keyOfRequest: string, id: DiagramId) => {
        let candidate: Diagram | null = null;
        try {
            if (file.size <= IMPORT_BYTES) candidate = diagramFromFile(id, JSON.parse(await file.text()));
        } catch { /* Invalid JSON has the same status as an invalid model. */ }
        if (!candidate) { setFailed(keyOfRequest); return; }
        setImported((current) => new Map(current).set(keyOfRequest, candidate!));
        setFailed(null);
    };
    return <>
        <div data-diagram-controls style={{
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '4px 10px',
            background: cssVar('panel'), borderBottom: `1px solid ${cssVar('border')}`, ...TYPE.meta,
        }}>
            <select aria-label={t.diagramUml} value={active ?? ''} onChange={(event) => onPick(event.currentTarget.value as DiagramId || null)}>
                <option value="">{t.diagramUml}</option>
                {group(t.diagramStructure, UML_STRUCTURE)}
                {group(t.diagramBehavior, UML_BEHAVIOR)}
                {group(t.diagramInteraction, UML_INTERACTION)}
                <optgroup label={t.diagramStandards}>
                    {(Object.keys(STANDARD_VIEWS) as (keyof typeof STANDARD_VIEWS)[]).map((id) => <option key={id} value={id}>{t[id]}</option>)}
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
                ? <DiagramView id={active} model={diagram} flat={flat} labels={labels} onOpen={onOpen} />
                : <p role="status" style={{ ...TYPE.body, margin: 14 }}>{t.diagramNoData}</p>}
        </div>}
    </>;
}
