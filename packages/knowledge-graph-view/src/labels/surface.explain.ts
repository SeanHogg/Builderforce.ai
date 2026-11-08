/**
 * The words that EXPLAIN what the view shows: why a channel is "Not set up", that the map is a cut
 * of the real graph, what the review status chip's counts mean, and what a one-station path can and cannot
 * do. The interface and its English defaults (a host overrides them per key).
 */

export interface ExplainLabels {
    explain: {
        /** The map notice when the server sent no outline: `{shown}`, `{total}`. */
        cutNote: string;
        /** "Not set up · {reason}". */
        notSetUpWhy: string;
        /** Reasons. `{shown}` `{total}` files; `{metric}` the metric's name, lower-cased. */
        whyNoOutline: string;
        whyNoBadges: string;
        whyNotCollected: string;
        /** The path strip with fewer than two stations. */
        oneStation: string;
        /** What an unset channel means for the picture. */
        legendNotSetUp: string;
        /** The overlay menu's note on a preset most of whose channels have no data. */
        presetNeeds: string;
    };
}

export const EXPLAIN_DEFAULTS: ExplainLabels = {
    explain: {
        cutNote: 'Showing {shown} of {files}. The server did not send the full map; it updates when the server is updated.',
        notSetUpWhy: 'Not set up · {reason}',
        whyNoOutline: 'the server sent only {shown} of {files}',
        whyNoBadges: 'no file has {metric} yet; review again to collect it',
        whyNotCollected: '{metric} was not collected in this review',
        oneStation: 'This line has one station: nothing to step through.',
        legendNotSetUp: 'so every station stays plain',
        presetNeeds: 'needs {metrics}',
    },
};
