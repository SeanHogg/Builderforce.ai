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
    zoom: Record<'group' | 'system' | 'class' | 'method', string>;
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
    },
};
