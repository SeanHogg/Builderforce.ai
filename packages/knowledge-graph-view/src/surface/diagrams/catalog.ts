import type { ViewMode } from '../../types';

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

/**
 * Diagrams the 3D stage already draws better than a DOM board: picking one switches the camera instead of opening a board.
 * Sequence is the stage's `sequence` camera (call-site order, depth, activation bars); the code city is the Tower, which `towerCameraOf` resolves among the available cameras.
 */
export const STAGE_CAMERA_VIEWS: Partial<Record<DiagramId, ViewMode | 'tower'>> = {
    sequenceDiagram: 'sequence', msc: 'sequence', codeCity: 'tower',
};
