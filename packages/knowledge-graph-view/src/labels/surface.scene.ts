/** The words of the 3D scene's link budget and the mind map's folded branches: the interface and its English defaults (a host overrides them per key). */

export interface SceneLabels {
    /** The scenes draw only part of the links: `{shown}`, `{total}` (already formatted for the locale). */
    scene: Record<'edgesCapped' | 'layingOut' | 'errorTitle' | 'errorRetry' | 'errorBack' | 'depth', string>;
    /**
     * The mind map's "+N folders" leaf and its accessible name, in One and Other forms (`{count}`); a language with no
     * plural form repeats the one. Read through `isOne` (surface/plural.ts), like `counted()`.
     */
    mind: Record<`${'moreFolders' | 'moreFoldersAria'}${'One' | 'Other'}`, string>;
    /** The semantic-zoom bands (PRD 43 B1a rules 9–10): the control's group name and one word per band. */
    zoom: Record<'group' | 'system' | 'class' | 'method' | 'code', string>;
    /**
     * The code band's panel (B1a rule 9): its accessible name (`{name}`, `{from}`, `{to}`), the read in progress, the
     * note when the host has no file contents (the panel then shows `path:line` and "Open at line"), and the note when
     * the host cut the range short (`{count}` lines shown); then the step card's and the map trail's words.
     */
    code: Record<
        | 'aria' | 'loading' | 'unavailable' | 'truncated' | 'button' | 'buttonAria' | 'drillAria' | 'stepAria' | 'step' | 'crumbsAria' | 'follow' | 'out'
        | 'prevStep' | 'nextStep' | 'drillCallee' | 'atLine' | 'codeLevel' | 'callsInOrder' | 'sameFile' | 'otherFile' | 'stepThrough' | 'stepNote' | 'trailAria',
        string
    >;
    /**
     * The stage's navigation control (bottom-right): its group name, the pan pad (on 3D, up / down move through the
     * plane stack) and the orbit buttons shown on the 3D camera. Zoom in / out and Fit reuse `zoomIn`, `zoomOut`, `zoomReset`.
     */
    nav: Record<'group' | 'panUp' | 'panDown' | 'panLeft' | 'panRight' | 'rotateLeft' | 'rotateRight' | 'tiltUp' | 'tiltDown', string>;
}

export const SCENE_DEFAULTS: SceneLabels = {
    scene: {
        edgesCapped: 'Showing {shown} of {total} links',
        layingOut: 'Laying out…',
        /** A camera that threw: the error boundary's heading, then its two actions (Back leaves a drilled level). */
        errorTitle: 'This view hit an error',
        errorRetry: 'Try again',
        errorBack: 'Back',
        /** The stage's depth control (PRD 43 B2): tilts the view into depth; Map's stations rise into towers. */
        depth: 'Depth',
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
        follow: 'Follow the code',
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
    },
    nav: {
        group: 'Move the view',
        panUp: 'Move up',
        panDown: 'Move down',
        panLeft: 'Move left',
        panRight: 'Move right',
        rotateLeft: 'Rotate left',
        rotateRight: 'Rotate right',
        tiltUp: 'Tilt up',
        tiltDown: 'Tilt down',
    },
};
