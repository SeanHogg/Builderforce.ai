/** The words of a folder of many systems (PRD 41 A9): why a line stops, the system groups, the stray-copy card, the partition picker. */

export interface SystemsLabels {
    /** Why a line stops where it does (shown in place of "Ends here", unless it ends at a real store or service). */
    stopReasons: Record<'noReferences' | 'onlyUpward' | 'onlyVisited' | 'onlyHigherLayer' | 'maxStops', string>;
    /** `{name}`. */
    systems: Record<'loose' | 'copyMark' | 'groupAria', string>;
    /** `{copy}`, `{original}`, `{similarity}`. */
    duplicateCopy: Record<'title' | 'body' | 'reasonNoGit' | 'reasonNameMismatch' | 'reasonLaterName' | 'exclude' | 'excludeAria' | 'excluding' | 'failed' | 'note', string>;
    partitionPicker: Record<'label', string>;
}

export const SYSTEMS_DEFAULTS: SystemsLabels = {
    stopReasons: {
        noReferences: 'No further references',
        onlyUpward: 'Only upward references',
        onlyVisited: 'Only loops back',
        onlyHigherLayer: 'Only higher-layer references',
        maxStops: 'Cut at the stop limit',
    },
    systems: {
        loose: 'Loose files',
        copyMark: 'copy',
        groupAria: '{name} system',
    },
    duplicateCopy: {
        title: 'Stray copy of a project',
        body: '{copy} looks like a stray copy of {original} ({similarity}% of the sampled files match).',
        reasonNoGit: 'It has no .git folder and the original does.',
        reasonNameMismatch: 'Its folder name differs from the project name.',
        reasonLaterName: 'The two look alike, so the later name is taken as the copy.',
        exclude: 'Exclude from review',
        excludeAria: 'Exclude {copy} from review',
        excluding: 'Excluding…',
        failed: 'The folder could not be excluded.',
        note: 'Until you exclude it, the copy stays on the map, marked as a copy, and its lines and findings are folded under the original.',
    },
    partitionPicker: {
        label: 'Show the files of a partition',
    },
};
