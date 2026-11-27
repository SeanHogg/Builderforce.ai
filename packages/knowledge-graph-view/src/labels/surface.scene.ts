import type { DiagramId } from '../surface/diagrams/catalog';

/** The words of the 3D scene's link budget and the mind map's folded branches: the interface and its English defaults (a host overrides them per key). */

export interface SceneLabels {
    /** The scenes draw only part of the links: `{shown}`, `{total}` (already formatted for the locale). */
    scene: Record<
        | 'edgesCapped' | 'stationsCapped' | 'layingOut' | 'errorTitle' | 'errorRetry' | 'errorBack' | 'view3d' | 'viewFlat' | 'flatToggle'
        | 'legendRisk' | 'legendTests' | 'legendActivity' | 'legendOwner',
        string
    >;
    /**
     * The mind map's "+N folders" leaf and its accessible name, in One and Other forms (`{count}`); a language with no
     * plural form repeats the one. Read through `isOne` (surface/plural.ts), like `counted()`.
     */
    mind: Record<`${'moreFolders' | 'moreFoldersAria'}${'One' | 'Other'}`, string>;
    /**
     * The semantic-zoom bands (PRD 43 B1a rules 9–10): the rail's group name, one word per band (the status line), the
     * rail's five levels (where you are: System, Component, Class, Method, Line) and its hints (`{name}`).
     */
    zoom: Record<
        | 'group' | 'system' | 'class' | 'method' | 'code'
        | 'levelSystem' | 'levelComponent' | 'levelClass' | 'levelMethod' | 'levelLine'
        | 'hintIn' | 'hintInto' | 'hintBack' | 'hintDeepest',
        string
    >;
    /**
     * The code band's panel (B1a rule 9): its accessible name (`{name}`, `{from}`, `{to}`), the read in progress, the
     * note when the host has no file contents (the panel then shows `path:line` and "Open at line"), and the note when
     * the host cut the range short (`{count}` lines shown); then the step card's and the map trail's words, the editor
     * chrome's (lens lines, the sticky header, the Outline, the tabs), the map bar's view switches, the symbol card's
     * and the status line's.
     */
    code: Record<
        | 'aria' | 'loading' | 'unavailable' | 'truncated' | 'button' | 'buttonAria' | 'drillAria' | 'stepAria' | 'step' | 'crumbsAria' | 'follow' | 'out'
        | 'prevStep' | 'nextStep' | 'drillCallee' | 'atLine' | 'codeLevel' | 'callsInOrder' | 'sameFile' | 'otherFile' | 'stepThrough' | 'stepNote' | 'trailAria'
        | 'toastNoMethod' | 'toastNoCalls' | 'toastFollowOn' | 'toastFollowOff'
        | 'lensReferences' | 'lensCallers' | 'lensCaller' | 'referencesToast' | 'calledBy' | 'showInMap' | 'drillIn' | 'stickyAria'
        | 'kindCalls' | 'kindReads' | 'kindSuper' | 'awaited' | 'sync' | 'openCallee' | 'callers'
        | 'outline' | 'outlineAria' | 'tabsAria'
        | 'followsEditor'
        | 'stateSelected' | 'stateReading' | 'statePinned' | 'methodsCount' | 'fieldsCount' | 'callsCount' | 'imported' | 'drillInAction' | 'showCode' | 'openFile'
        | 'status' | 'following' | 'pinnedStatus' | 'statusLine'
        | 'dockAria' | 'dockHide' | 'dockShow' | 'levelAria' | 'levelEmpty' | 'levelNoSource' | 'rowNoTest' | 'rowAntiPattern'
        | 'paneCode' | 'panePicture' | 'architecture' | 'filesystem' | 'lensOut' | 'lensSimulate' | 'lensRestructure' | 'gutterWarn'
        | 'samePlace' | 'sayLead' | 'sayHint' | 'fileLines' | 'fileLine'
        | DiagramId
        | 'diagramUml' | 'diagramStructure' | 'diagramBehavior' | 'diagramInteraction' | 'diagramStandards' | 'diagramImport' | 'diagramIndexed' | 'diagramProvided' | 'diagramInvalid' | 'diagramNoData'
        | 'logicalView' | 'processView' | 'developmentView' | 'physicalView' | 'scenarioView' | 'evolutionAxis' | 'visibilityAxis',
        string
    >;
    /**
     * The stage's camera column (bottom-right): its group name, the orbit buttons shown on an orbit camera, Look from above
     * and the help tooltip. Zoom in / out and Fit reuse `zoomIn`, `zoomOut`, `zoomReset`.
     */
    nav: Record<'group' | 'rotateLeft' | 'rotateRight' | 'tiltUp' | 'tiltDown' | 'top' | 'help' | 'helpText', string>;
}

export const SCENE_DEFAULTS: SceneLabels = {
    scene: {
        edgesCapped: 'Showing {shown} of {total} links',
        stationsCapped: 'Showing {shown} of {total} stations',
        layingOut: 'Laying out…',
        /** A camera that threw: the error boundary's heading, then its two actions (Back leaves a drilled level). */
        errorTitle: 'This view hit an error',
        errorRetry: 'Try again',
        errorBack: 'Back',
        /** The ONE 3D / Flat switch beside the view switcher (PRD 43 C4): the two states' words, and the switch's accessible name. */
        view3d: '3D',
        viewFlat: 'Flat',
        flatToggle: 'Flat view',
        /** The Colour-by legend's short preset words (the design's mini segment); the overlay menu keeps the presets' full names. */
        legendRisk: 'Risk',
        legendTests: 'Tests',
        legendActivity: 'Activity',
        legendOwner: 'Owner',
    },
    mind: {
        moreFoldersOne: '+{count} folder',
        moreFoldersOther: '+{count} folders',
        moreFoldersAriaOne: '{count} more folder: show the next ones',
        moreFoldersAriaOther: '{count} more folders: show the next ones',
    },
    zoom: {
        group: 'Zoom level',
        system: 'Systems',
        class: 'Classes',
        method: 'Methods',
        code: 'Code',
        levelSystem: 'System',
        levelComponent: 'Component',
        levelClass: 'Class',
        levelMethod: 'Method',
        levelLine: 'Line',
        hintIn: 'Zoom into a shape to go inside it',
        hintInto: 'Keep zooming · going inside {name}',
        hintBack: 'Keep zooming out · back to {name}',
        hintDeepest: 'Deepest level · zoom out to come back',
    },
    code: {
        aria: 'Code of {name}, lines {from} to {to}',
        loading: 'Reading the code…',
        unavailable: 'The code is not available here.',
        truncated: 'Showing the first {count} lines',
        /** The overlay button on a selected mark, its accessible name (`{name}`), and a method name's drill control (`{name}`). */
        button: 'Code',
        buttonAria: 'Show the code of {name}',
        drillAria: 'Show {name} on the stage',
        /** A numbered call (`{n}`, `{count}`), the step card's name (`{n}`, `{count}`, `{name}`), the crumbs' name, the follow toggle, Out, the Previous / Next call buttons and "Into" the current callee (`{name}`). */
        stepAria: 'Call {n} of {count}',
        step: 'Call {n} of {count} → {name}',
        crumbsAria: 'Where you are reading',
        follow: 'Follow editor',
        out: 'Out',
        prevStep: 'Previous call',
        nextStep: 'Next call',
        drillCallee: 'Into {name}',
        /** The step card: the call's line (`{line}`), the open method's kicker and its call count (`{count}`), where the callee is, "Step through", the note; then the map trail's name. */
        atLine: 'line {line}',
        codeLevel: 'Code level',
        callsInOrder: 'Calls in order: {count}',
        sameFile: 'Same file',
        otherFile: 'Another file',
        stepThrough: 'Step through',
        stepNote: 'Scroll the method in the code. The call on the reading line lights up here and on the map.',
        trailAria: 'Zoom path',
        /** The stage's toasts: zooming into code with no method (`{name}` has no calls), and Follow turned on / off. */
        toastNoMethod: 'Scroll to a method, or select one, to zoom into its code.',
        toastNoCalls: '{name} has no calls to show.',
        toastFollowOn: 'Following the editor again.',
        toastFollowOff: 'Pinned. Scrolling the editor no longer moves the map.',
        /** The lens line above a class (`{count}` references, its toast with `{name}`) or a method (`{count}` callers, One and Other; "Called by" `{names}`), its actions, and the sticky header's name. */
        lensReferences: '{count} references',
        lensCallers: '{count} callers',
        lensCaller: '{count} caller',
        referencesToast: '{count} references to {name} in the knowledge graph.',
        calledBy: 'Called by {names}',
        showInMap: 'Show in map',
        drillIn: 'Drill in ⤓',
        stickyAria: 'Enclosing symbols',
        /** The step card's chips: what the step does, awaited or not; "Open" a callee not loaded here (`{name}`); the method's callers (`{count}`). */
        kindCalls: 'calls',
        kindReads: 'reads',
        kindSuper: 'super call',
        awaited: 'awaited',
        sync: 'sync',
        openCallee: 'Open {name} ↗',
        callers: 'Callers: {count}',
        /** The code pane's Outline toggle and list, and its file tabs. */
        outline: 'Outline',
        outlineAria: 'Symbols in this file',
        tabsAria: 'Open files',
        /** The map bar's crumb that follows the editor. */
        followsEditor: 'Follows the editor',
        /** The symbol card: why it shows (selected, reading, pinned), its chips (`{count}`), its actions. */
        stateSelected: 'selected',
        stateReading: 'reading',
        statePinned: 'pinned',
        methodsCount: 'Methods: {count}',
        fieldsCount: 'Fields: {count}',
        callsCount: 'Calls: {count}',
        imported: 'imported',
        drillInAction: 'Drill in',
        showCode: 'Show code',
        openFile: 'Open file ↗',
        /** The status line: `{level}` and `{state}` (following `{file}`, or pinned), then the line read (`{line}`). */
        status: 'Visualization · {level} level · {state}',
        following: 'following {file}',
        pinnedStatus: 'pinned',
        statusLine: 'Ln {line}',
        /** The docked pane (PRD 43 Part C1): its name, its hide / show control, and the outline of the level (`{name}`, the marks on a member). */
        dockAria: 'Code and outline',
        dockHide: 'Hide code',
        dockShow: 'Show code',
        levelAria: 'Members of this level',
        levelEmpty: 'Nothing at this level yet.',
        levelNoSource: 'The source is not available here: showing the outline.',
        classDiagram: "Class diagram",
        objectDiagram: "Object diagram",
        packageDiagram: "Package diagram",
        componentDiagram: "Component diagram",
        compositeDiagram: "Composite structure diagram",
        deploymentDiagram: "Deployment diagram",
        profileDiagram: "Profile diagram",
        useCaseDiagram: "Use case diagram",
        activityDiagram: "Activity diagram",
        stateDiagram: "State machine diagram",
        sequenceDiagram: "Sequence diagram",
        communicationDiagram: "Communication diagram",
        timingDiagram: "Timing diagram",
        interactionDiagram: "Interaction overview diagram",
        diagramUml: "Diagrams",
        diagramStructure: "Structure",
        diagramBehavior: "Behavior",
        diagramInteraction: "Interaction",
        diagramStandards: "Other standards",
        diagramImport: "Import diagram data",
        diagramIndexed: "Indexed data",
        diagramProvided: "Imported data",
        diagramInvalid: "Invalid diagram data",
        logicalView: "Logical view",
        processView: "Process view",
        developmentView: "Development view",
        physicalView: "Physical view",
        scenarioView: "Scenarios",
        evolutionAxis: "Evolution",
        visibilityAxis: "Visibility",
        diagramNoData: "No data for this diagram. Import a model or trace for this view.",
        c4Context: "C4 · System Context",
        c4Containers: "C4 · Container",
        c4Components: "C4 · Component",
        c4Code: "C4 · Code",
        archimate: "ArchiMate",
        viewpoints: "4+1 / ISO/IEC/IEEE 42010",
        arc42: "arc42",
        sysml: "SysML v1",
        sysmlV2: "SysML v2",
        bpmnProcess: "BPMN · Process",
        bpmnCollaboration: "BPMN · Collaboration",
        bpmnChoreography: "BPMN · Choreography",
        bpmnConversation: "BPMN · Conversation",
        dmn: "DMN",
        cmmn: "CMMN",
        flowchart: "ISO 5807",
        nassi: "Nassi–Shneiderman",
        valueStream: "Value Stream Map",
        erd: "ERD · Crow’s Foot",
        erdChen: "ERD · Chen",
        erdIdef1x: "ERD · IDEF1X",
        dfd: "DFD · Yourdon/DeMarco",
        dfdGane: "DFD · Gane–Sarson",
        lineage: "OpenLineage",
        threatDfd: "STRIDE · Threat Model",
        contextMap: "DDD Context Map",
        eventStorming: "Event Storming",
        statechart: "Harel Statecharts",
        petri: "Petri Net",
        msc: "ITU MSC Z.120",
        sdl: "SDL",
        openapi: "OpenAPI",
        asyncapi: "AsyncAPI",
        codeCity: "CodeCity",
        dsm: "DSM",
        callGraph: "Call Graph",
        hotspots: "Hotspots / Churn",
        wardley: "Wardley Map",
        rowNoTest: 'No test',
        rowAntiPattern: 'Anti-pattern: {name}',
        /** The pane's heading, and (a box too narrow to split) the picture it trades places with. */
        paneCode: 'Code',
        architecture: 'System & components',
        filesystem: 'Filesystem',
        panePicture: 'Picture',
        /** The lens line's added actions (PRD 43 Part C2): out of the level, simulate an untested symbol, restructure by its anti-pattern (`{name}`); the gutter's warning. */
        lensOut: 'Out',
        lensSimulate: 'No test · Simulate',
        lensRestructure: '{name}',
        gutterWarn: 'Anti-pattern: {name}',
        /** The pane's header note, the file bar's line range (`{from}`, `{to}`; `{line}`), and the plain-words box. */
        samePlace: 'same place as the picture',
        sayLead: 'In plain words:',
        sayHint: 'Click a line or an outline row and the picture goes there. The mark beside a line is its shape in the picture.',
        fileLines: 'lines {from}–{to}',
        fileLine: 'line {line}',
    },
    nav: {
        group: 'Move the view',
        rotateLeft: 'Rotate left',
        rotateRight: 'Rotate right',
        tiltUp: 'Tilt up',
        tiltDown: 'Tilt down',
        top: 'Look from above',
        help: 'How to move around',
        helpText: 'Drag to rotate. Scroll to zoom: keep zooming into a shape to go inside it, zoom out to come back. Right-drag to pan. Double-click a shape to enter, Esc to go out.',
    },
};
