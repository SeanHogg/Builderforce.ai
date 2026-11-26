/** The words of the hidden-coupling channel (PRD 38 P4): the interface and its English defaults. */

export interface CouplingLabels {
    coupling: {
        /** The selected file's partners list heading. */
        title: string;
        /** Under the heading: what a hidden partner is. */
        hint: string;
        /** One partner: `{name}`, `{rate}` (the shared rate formatter's text). */
        partner: string;
    };
}

export const COUPLING_DEFAULTS: CouplingLabels = {
    coupling: {
        title: 'Hidden coupling',
        hint: 'Files that usually change with this one but share no reference with it.',
        partner: '{name} · {rate}',
    },
};
