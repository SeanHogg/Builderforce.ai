/** Diagram identities are stable across persisted or imported models. */
export const UML_STRUCTURE = ['classDiagram', 'objectDiagram', 'packageDiagram', 'componentDiagram', 'compositeDiagram', 'deploymentDiagram', 'profileDiagram'] as const;
export const UML_BEHAVIOR = ['useCaseDiagram', 'activityDiagram', 'stateDiagram'] as const;
export const UML_INTERACTION = ['sequenceDiagram', 'communicationDiagram', 'timingDiagram', 'interactionDiagram'] as const;

export const STANDARD_VIEWS = [
    'c4Context', 'c4Containers', 'c4Components', 'c4Code', 'archimate', 'viewpoints', 'arc42', 'sysml', 'sysmlV2',
    'bpmnProcess', 'bpmnCollaboration', 'bpmnChoreography', 'bpmnConversation', 'dmn', 'cmmn', 'flowchart', 'nassi',
    'valueStream', 'erd', 'erdChen', 'erdIdef1x', 'dfd', 'dfdGane', 'lineage', 'threatDfd', 'contextMap',
    'eventStorming', 'statechart', 'petri', 'msc', 'sdl', 'openapi', 'asyncapi', 'codeCity', 'dsm', 'callGraph', 'hotspots', 'wardley',
] as const;

export type UmlDiagramId = typeof UML_STRUCTURE[number] | typeof UML_BEHAVIOR[number] | typeof UML_INTERACTION[number];
export type DiagramId = UmlDiagramId | typeof STANDARD_VIEWS[number];
export const DIAGRAM_IDS: readonly DiagramId[] = [
    ...UML_STRUCTURE, ...UML_BEHAVIOR, ...UML_INTERACTION, ...STANDARD_VIEWS,
];
