/** The words of the 3D scene's link budget and the mind map's folded branches: the interface and its English defaults (a host overrides them per key). */

export interface SceneLabels {
    /** The scenes draw only part of the links: `{shown}`, `{total}` (already formatted for the locale). */
    scene: Record<'edgesCapped' | 'layingOut', string>;
    /**
     * The mind map's "+N folders" leaf and its accessible name, in One and Other forms (`{count}`); a language with no
     * plural form repeats the one. Read through `isOne` (surface/plural.ts), like `counted()`.
     */
    mind: Record<`${'moreFolders' | 'moreFoldersAria'}${'One' | 'Other'}`, string>;
}

export const SCENE_DEFAULTS: SceneLabels = {
    scene: {
        edgesCapped: 'Showing {shown} of {total} links',
        layingOut: 'Laying out…',
    },
    mind: {
        moreFoldersOne: '+{count} folder',
        moreFoldersOther: '+{count} folders',
        moreFoldersAriaOne: '{count} more folder: show the next ones',
        moreFoldersAriaOther: '{count} more folders: show the next ones',
    },
};
