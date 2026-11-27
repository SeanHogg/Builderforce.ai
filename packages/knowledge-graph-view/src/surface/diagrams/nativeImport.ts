import type { Diagram, DiagramEdge, DiagramNode } from './model';
import type { DiagramId } from './catalog';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined;
const str = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 240) : '';
const LIST = 100;
const xmlViews = new Set<DiagramId>(['archimate', 'sysml', 'bpmnProcess', 'bpmnCollaboration', 'bpmnChoreography', 'bpmnConversation', 'dmn', 'cmmn', 'statechart', 'stateDiagram', 'petri']);

const bpmnNodes: Record<string, string> = {
    startEvent: 'event', endEvent: 'event', intermediateCatchEvent: 'event', intermediateThrowEvent: 'event', boundaryEvent: 'event',
    task: 'activity', userTask: 'activity', serviceTask: 'activity', scriptTask: 'activity', sendTask: 'activity', receiveTask: 'activity',
    manualTask: 'activity', businessRuleTask: 'decision', callActivity: 'activity', subProcess: 'activity', exclusiveGateway: 'gateway',
    inclusiveGateway: 'gateway', parallelGateway: 'gateway', eventBasedGateway: 'gateway',
    participant: 'participant', choreographyTask: 'activity', subChoreography: 'activity', conversation: 'conversation', subConversation: 'conversation',
};
const bpmnLinks = new Set(['sequenceFlow', 'messageFlow', 'conversationLink', 'association']);
const bpmnRoot: Partial<Record<DiagramId, string>> = {
    bpmnProcess: 'process', bpmnCollaboration: 'collaboration', bpmnChoreography: 'choreography', bpmnConversation: 'collaboration',
};

function xmlDiagram(id: DiagramId, text: string): Diagram | null {
    if (!xmlViews.has(id) || typeof DOMParser === 'undefined' || /<!DOCTYPE|<!ENTITY/i.test(text)) return null;
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) return null;
    const bpmn = bpmnRoot[id];
    const rootName = doc.documentElement.localName;
    const expected = id === 'petri' ? 'pnml' : id === 'statechart' || id === 'stateDiagram' ? 'scxml' : id === 'archimate' ? 'model' : 'definitions';
    if (!bpmn && id !== 'sysml' && rootName !== expected) return null;
    if (bpmn && !doc.documentElement.namespaceURI?.includes('BPMN')) return null;
    const elements = [...doc.getElementsByTagName('*')];
    const key = (element: Element) => element.getAttribute('id') || element.getAttribute('identifier') || element.getAttribute('xmi:id') || '';
    const direct = (element: Element, name: string) => [...element.children].find((child) => child.localName === name);
    const value = (element: Element, name: string) => direct(element, name)?.textContent?.trim().slice(0, 240) || '';
    const type = (element: Element) => (element.getAttribute('xsi:type') || element.getAttribute('xmi:type') || element.localName).split(':').at(-1) ?? '';
    const inside = (element: Element, name: string): boolean => {
        for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent.localName === name) return true;
        return false;
    };
    const poolFor = new Map<string, string>();
    const laneFor = new Map<string, string>();
    if (bpmn) for (const element of elements) {
        const label = element.getAttribute('name') || key(element);
        const process = element.getAttribute('processRef');
        if (element.localName === 'participant' && process && inside(element, 'collaboration')) poolFor.set(process, label);
        if (element.localName === 'lane' && label) for (const child of element.children) {
            if (child.localName === 'flowNodeRef' && child.textContent) laneFor.set(child.textContent.trim(), label);
        }
    }
    const processOf = (element: Element) => {
        for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent.localName === 'process') return parent;
        return undefined;
    };
    const bpmnMember = (element: Element) => {
        if (!bpmn) return false;
        if (inside(element, bpmn)) return true;
        const process = processOf(element);
        return id === 'bpmnCollaboration' && process && poolFor.has(key(process));
    };
    const positions = new Map<string, { x: number; y: number }>();
    for (const shape of elements.filter((element) => element.localName === 'BPMNShape')) {
        const bounds = direct(shape, 'Bounds'), ref = shape.getAttribute('bpmnElement');
        if (!bounds || !ref) continue;
        const x = Number(bounds.getAttribute('x')), y = Number(bounds.getAttribute('y'));
        if (Number.isFinite(x) && Number.isFinite(y)) positions.set(ref, { x, y });
    }
    const nodes = new Map<string, DiagramNode>();
    const edges: DiagramEdge[] = [];
    const nodeKind = (element: Element): string | undefined => {
        const name = element.localName, declared = type(element);
        if (bpmn) {
            if (!bpmnMember(element)) return;
            if (id === 'bpmnConversation' && !['participant', 'conversation', 'subConversation'].includes(name)) return;
            return Object.hasOwn(bpmnNodes, name) ? bpmnNodes[name] : undefined;
        }
        if (id === 'dmn') return ['decision', 'inputData', 'knowledgeSource', 'businessKnowledgeModel'].includes(name) ? (name === 'inputData' ? 'data' : 'decision') : undefined;
        if (id === 'cmmn') return ['casePlanModel', 'stage', 'humanTask', 'processTask', 'caseTask', 'milestone', 'planItem', 'caseFileItem', 'sentry'].includes(name) ? name : undefined;
        if (id === 'petri') return ['place', 'transition'].includes(name) ? name : undefined;
        if (id === 'statechart' || id === 'stateDiagram') return ['state', 'parallel', 'final', 'history'].includes(name) ? name : undefined;
        if (id === 'sysml') return /^(Requirement|Block|ConstraintBlock|ConstraintProperty|ValueType)$/.test(declared) ? declared : undefined;
        return name === 'element' ? declared : undefined;
    };
    for (const element of elements) {
        const ref = key(element), kind = nodeKind(element);
        if (!ref || !kind || nodes.size >= LIST) continue;
        const name = element.getAttribute('name') || value(element, 'name') || ref;
        let members = [...element.children].filter((child) => ['documentation', 'initialMarking', 'constraint', 'text'].includes(child.localName))
            .map((child) => str(child.textContent)).filter(Boolean);
        if (id === 'dmn') {
            const table = direct(element, 'decisionTable');
            if (table) members = [...table.children].filter((row) => row.localName === 'rule').slice(0, 40).map((row) =>
                [...row.children].map((cell) => str(cell.textContent)).filter(Boolean).join(' | '));
        }
        if (id === 'sysml') members.push(...['text', 'expression'].map((name) => str(element.getAttribute(name))).filter(Boolean));
        const parent = processOf(element);
        const layer = id === 'archimate' ? /^(Business|Application|Technology|Strategy|Motivation|Physical|Implementation)/.exec(kind)?.[1] : undefined;
        const group = laneFor.get(ref) || (parent ? poolFor.get(key(parent)) || parent.getAttribute('name') : null) || layer;
        nodes.set(ref, { id: ref, kind, label: name.slice(0, 240), ...positions.get(ref),
            ...(group ? { group: group.slice(0, 160) } : {}), members: members.slice(0, 40).map((text) => ({ text })) });
    }
    for (const element of elements) {
        const name = element.localName;
        let from = element.getAttribute('sourceRef') || element.getAttribute('source') || '';
        let to = element.getAttribute('targetRef') || element.getAttribute('target') || '';
        let kind = type(element);
        if (bpmn && (!bpmnLinks.has(name) || !bpmnMember(element))) continue;
        if (id === 'bpmnConversation' && name !== 'conversationLink') continue;
        if (id === 'statechart' || id === 'stateDiagram') {
            if (name !== 'transition') continue;
            from = element.parentElement ? key(element.parentElement) : '';
        }
        if (id === 'dmn') {
            if (!['informationRequirement', 'knowledgeRequirement', 'authorityRequirement'].includes(name)) continue;
            from = element.firstElementChild?.getAttribute('href')?.replace(/^#/, '') ?? '';
            to = element.parentElement ? key(element.parentElement) : '';
        }
        if (id === 'cmmn' && name === 'planItem') {
            from = key(element); to = element.getAttribute('definitionRef') ?? '';
            kind = 'references';
        }
        if (id === 'sysml') { from ||= element.getAttribute('client') ?? ''; to ||= element.getAttribute('supplier') ?? ''; }
        if (nodes.has(from) && nodes.has(to) && edges.length < 450) {
            const label = element.getAttribute('name') || element.getAttribute('event') || element.getAttribute('cond');
            edges.push({ from, to, kind, ...(label ? { label: str(label) } : {}) });
        }
    }
    return nodes.size ? { nodes: [...nodes.values()], edges } : null;
}

/** OpenLineage RunEvent data, as a JSON object, array or NDJSON stream. */
function lineage(events: readonly unknown[]): Diagram | null {
    const nodes = new Map<string, DiagramNode>(), edges = new Map<string, DiagramEdge>();
    const add = (value: unknown, kind: string) => {
        const item = record(value), namespace = str(item?.namespace), name = str(item?.name);
        if (!namespace || !name) return null;
        const id = JSON.stringify([kind, namespace, name]);
        if (!nodes.has(id) && nodes.size < LIST) nodes.set(id, { id, label: name, kind, members: [{ text: namespace }] });
        return nodes.has(id) ? id : null;
    };
    const connect = (from: string, to: string, kind: string) => edges.set(JSON.stringify([from, to]), { from, to, kind });
    for (const event of events) {
        const item = record(event);
        const job = item?.eventType && record(item.run) ? add(item.job, 'process') : null;
        if (!job || !item) continue;
        for (const input of Array.isArray(item.inputs) ? item.inputs : []) { const id = add(input, 'data'); if (id) connect(id, job, 'reads'); }
        for (const output of Array.isArray(item.outputs) ? item.outputs : []) { const id = add(output, 'data'); if (id) connect(job, id, 'writes'); }
    }
    return nodes.size ? { nodes: [...nodes.values()], edges: [...edges.values()].slice(0, 450) } : null;
}

/** OTLP JSON spans. Use integer nanoseconds for ordering and relative milliseconds for display. */
function traceDiagram(id: DiagramId, envelopes: readonly unknown[]): Diagram | null {
    const array = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];
    const spanRows: { id: string; parent: string; name: string; service: string; start: bigint; end: bigint }[] = [];
    const nanos = (value: unknown) => {
        if (typeof value === 'string' && /^\d{1,20}$/.test(value)) return BigInt(value);
        return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
    };
    for (const envelope of envelopes) for (const source of array(record(envelope)?.resourceSpans)) {
        const bundle = record(source);
        const attribute = array(record(bundle?.resource)?.attributes).map(record).find((item) => item?.key === 'service.name');
        const service = str(record(attribute?.value)?.stringValue);
        for (const scope of array(bundle?.scopeSpans)) for (const item of array(record(scope)?.spans)) {
            const span = record(item), trace = str(span?.traceId), key = str(span?.spanId), name = str(span?.name);
            const start = nanos(span?.startTimeUnixNano), end = nanos(span?.endTimeUnixNano);
            if (!trace || !key || !name || start === null || end === null || end < start || spanRows.length >= 1000) continue;
            spanRows.push({ id: `${trace}:${key}`, parent: `${trace}:${str(span?.parentSpanId)}`, name, service: service || str(record(record(scope)?.scope)?.name) || name, start, end });
        }
    }
    if (!spanRows.length) return null;
    const seen = new Set<string>();
    const ordered = spanRows.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0).filter((row) => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
    }).slice(0, LIST);
    const origin = ordered[0]!.start;
    const clock = (at: bigint) => Number(at - origin) / 1e6;
    const byId = new Map(ordered.map((span) => [span.id, span]));
    const nodes = new Map<string, DiagramNode>(), edges: DiagramEdge[] = [];
    for (const [i, span] of ordered.entries()) {
        const parent = byId.get(span.parent);
        if (id === 'timingDiagram') {
            const y = i * 42;
            nodes.set(span.id, { id: span.id, label: span.name, kind: 'activity', x: clock(span.start), y,
                members: [{ text: span.service }, { text: `${(Number(span.end - span.start) / 1e6).toFixed(2)} ms` }] });
            const end = `${span.id}:end`;
            nodes.set(end, { id: end, label: span.name, kind: 'event', x: clock(span.end), y });
            edges.push({ from: span.id, to: end, kind: 'duration', label: `${(Number(span.end - span.start) / 1e6).toFixed(2)} ms` });
        } else {
            nodes.set(span.service, { id: span.service, label: span.service, kind: 'participant' });
            if (parent) edges.push({ from: parent.service, to: span.service, kind: 'calls', label: span.name, time: clock(span.start) });
        }
    }
    return { nodes: [...nodes.values()], edges };
}

/** Small authored formats for notations whose semantic information is not in the code index. */
function authored(id: DiagramId, raw: unknown): Diagram | null {
    const data = record(raw);
    if (!data) return null;
    const rows = (value: unknown) => Array.isArray(value) ? value.slice(0, LIST).map(record).filter((item) => item !== undefined) : [];
    const nodes = new Map<string, DiagramNode>(), edges: DiagramEdge[] = [];
    const add = (item: RecordValue, kind: string, members: string[] = [], position?: { x: number; y: number }) => {
        const key = str(item.id), label = str(item.name ?? item.label);
        if (!key || !label || nodes.has(key) || nodes.size >= LIST) return;
        const group = str(item.boundary ?? item.group);
        nodes.set(key, { id: key, label, kind, members: members.filter(Boolean).slice(0, 40).map((text) => ({ text })),
            ...(group ? { group } : {}), ...position });
    };
    const connect = (from: string, to: string, kind: string, label?: string) => {
        if (nodes.has(from) && nodes.has(to)) edges.push({ from, to, kind, ...(label ? { label } : {}) });
    };
    const links = (value: unknown, fallback: string) => {
        for (const item of rows(value)) connect(str(item.from), str(item.to), str(item.kind) || fallback, str(item.label));
    };
    const unit = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
    if (id === 'wardley') {
        for (const item of rows(data.components)) {
            const x = unit(item.evolution), y = unit(item.visibility);
            if (x !== undefined && y !== undefined) add(item, 'component', [], { x, y });
        }
        links(data.dependencies, 'uses');
    } else if (id === 'valueStream' || id === 'flowchart' || id === 'sdl') {
        for (const item of rows(data.steps)) {
            const minutes = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${value} min` : '';
            add(item, str(item.kind) || 'activity', [str(item.description), minutes(item.processMinutes), minutes(item.waitMinutes)]);
        }
        if (data.flows) links(data.flows, 'sequenceFlow');
        else {
            const ids = [...nodes.keys()];
            ids.slice(1).forEach((to, i) => connect(ids[i]!, to, 'sequenceFlow'));
        }
    } else if (id === 'eventStorming') {
        for (const kind of ['event', 'command', 'aggregate', 'policy']) for (const item of rows(data[`${kind}s`]))
            add(item, kind, [str(item.description)]);
        links(data.relationships, 'references');
    } else if (id === 'threatDfd') {
        const categories = new Set(['spoofing', 'tampering', 'repudiation', 'information disclosure', 'denial of service', 'elevation of privilege']);
        const threats = rows(data.threats);
        for (const item of rows(data.elements)) {
            const evidence = threats.filter((threat) => threat.element === item.id && categories.has(str(threat.category).toLowerCase()));
            add(item, str(item.kind) || 'process', evidence.map((threat) => `${str(threat.category)} · ${str(threat.description)}`));
        }
        links(data.flows, 'references');
    } else if (id === 'nassi') {
        const walk = (blocks: unknown, parent: string, depth: number): void => {
            if (depth > 12 || nodes.size >= LIST) return;
            for (const block of rows(blocks)) {
                add(block, str(block.kind) || 'activity', [str(block.condition)], { x: depth * 70, y: nodes.size * 66 });
                const key = str(block.id);
                connect(parent, key, 'contains');
                if (nodes.has(key)) walk(block.blocks, key, depth + 1);
            }
        };
        walk(data.blocks, '', 0);
    } else if (id === 'objectDiagram') {
        for (const item of rows(data.objects)) {
            const attributes = record(item.attributes) ?? {};
            add(item, 'instance', Object.entries(attributes).slice(0, 40).map(([name, value]) => `${name} = ${JSON.stringify(value)?.slice(0, 160) ?? ''}`));
        }
        links(data.links, 'references');
    }
    return nodes.size ? { nodes: [...nodes.values()], edges } : null;
}

export function nativeDiagram(id: DiagramId, text: string): Diagram | null {
    if (text.trimStart().startsWith('<')) return xmlDiagram(id, text);
    if (id === 'arc42' && /^#{1,4}\s/m.test(text)) {
        const sections = [...text.matchAll(/^#{1,4}\s+(.+)$/gm)].slice(0, 24);
        return { nodes: sections.map((section, i) => ({ id: String(i), kind: 'section', label: str(section[1]),
            members: text.slice(section.index! + section[0].length, sections[i + 1]?.index).trim().split(/\r?\n/)
                .filter((line) => line.trim()).slice(0, 20).map((line) => ({ text: str(line) })) })), edges: [] };
    }
    if (id === 'sysmlV2') {
        const declarations = [...text.matchAll(/\b(part|requirement|constraint|attribute|action|state|port|item)\s+def\s+([\w]+|'[^']+')/g)].slice(0, LIST);
        if (declarations.length) {
            const nodes = new Map(declarations.map((declaration) => [declaration[2]!, {
                id: declaration[2]!, kind: declaration[1]!, label: declaration[2]!.replace(/^'|'$/g, ''),
            }]));
            const edges = [...text.matchAll(/\bsatisfy\s+([\w]+|'[^']+')\s+by\s+([\w]+|'[^']+')/g)].slice(0, 250)
                .flatMap((match) => nodes.has(match[1]!) && nodes.has(match[2]!) ? [{ from: match[2]!, to: match[1]!, kind: 'satisfy' }] : []);
            return { nodes: [...nodes.values()], edges };
        }
    }
    try {
        const parsed: unknown = JSON.parse(text);
        const envelopes = Array.isArray(parsed) ? parsed : [parsed];
        if (id === 'lineage') return lineage(envelopes);
        if (['sequenceDiagram', 'msc', 'communicationDiagram', 'timingDiagram'].includes(id))
            return traceDiagram(id, envelopes);
        return authored(id, parsed);
    } catch {
        if (id !== 'lineage') return null;
        try { return lineage(text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 1000).map((line) => JSON.parse(line) as unknown)); }
        catch { return null; }
    }
}
