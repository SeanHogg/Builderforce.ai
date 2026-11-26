/** The words of the station transition probabilities (PRD 38 P7): path-strip hops, Simulate and "Run to end". */

export interface TransitionLabels {
    transition: {
        /** After a hop's count: the chance the walk goes this way. `{rate}` is `rateFormat`'s text. */
        hop: string;
        /** The most likely walk out of a station. `{name}` the station. */
        walkTitle: string;
        /** One hop of that walk: `{name}` the next station, `{rate}` its probability. */
        walkHop: string;
        /** No recorded or referenced hop leaves the station. `{name}`. */
        walkNone: string;
    };
}

export const TRANSITION_DEFAULTS: TransitionLabels = {
    transition: {
        hop: 'next {rate}',
        walkTitle: 'Most likely from {name}',
        walkHop: '{name} · {rate}',
        walkNone: 'No hop leaves {name}, so there is no likely next station.',
    },
};
