/** Diagram identities are stable across persisted or imported models. */
export const UML_STRUCTURE = ['classDiagram', 'objectDiagram', 'packageDiagram', 'componentDiagram', 'compositeDiagram', 'deploymentDiagram', 'profileDiagram'] as const;
export const UML_BEHAVIOR = ['useCaseDiagram', 'activityDiagram', 'stateDiagram'] as const;
export const UML_INTERACTION = ['sequenceDiagram', 'communicationDiagram', 'timingDiagram', 'interactionDiagram'] as const;

/** Names of published standards and views keep their original spelling in the picker. */
export const STANDARD_VIEWS = {
    c4Context: 'C4 · System Context', c4Containers: 'C4 · Container', c4Components: 'C4 · Component', c4Code: 'C4 · Code',
    archimate: 'ArchiMate', viewpoints: '4+1 / ISO/IEC/IEEE 42010', arc42: 'arc42',
    sysml: 'SysML v1', sysmlV2: 'SysML v2',
    bpmnProcess: 'BPMN · Process', bpmnCollaboration: 'BPMN · Collaboration', bpmnChoreography: 'BPMN · Choreography',
    bpmnConversation: 'BPMN · Conversation', dmn: 'DMN', cmmn: 'CMMN', flowchart: 'ISO 5807', nassi: 'Nassi–Shneiderman',
    valueStream: 'Value Stream Map', erd: 'ERD · Crow’s Foot', erdChen: 'ERD · Chen', erdIdef1x: 'ERD · IDEF1X',
    dfd: 'DFD · Yourdon/DeMarco', dfdGane: 'DFD · Gane–Sarson', lineage: 'OpenLineage', threatDfd: 'STRIDE · Threat Model',
    contextMap: 'DDD Context Map', eventStorming: 'Event Storming', statechart: 'Harel Statecharts', petri: 'Petri Net',
    msc: 'ITU MSC Z.120', sdl: 'SDL', openapi: 'OpenAPI', asyncapi: 'AsyncAPI',
    codeCity: 'CodeCity', dsm: 'DSM', callGraph: 'Call Graph', hotspots: 'Hotspots / Churn', wardley: 'Wardley Map',
} as const;

export type UmlDiagramId = typeof UML_STRUCTURE[number] | typeof UML_BEHAVIOR[number] | typeof UML_INTERACTION[number];
export type DiagramId = UmlDiagramId | keyof typeof STANDARD_VIEWS;
export const DIAGRAM_IDS: readonly DiagramId[] = [
    ...UML_STRUCTURE, ...UML_BEHAVIOR, ...UML_INTERACTION, ...Object.keys(STANDARD_VIEWS) as (keyof typeof STANDARD_VIEWS)[],
];
