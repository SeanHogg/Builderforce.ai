/** The words of the 4+1 camera (Kruchten's 4+1 view model): the five views, what each answers, the Physical and Scenarios views. */

export type FourPlusOneView = 'logical' | 'development' | 'process' | 'physical' | 'scenarios';

export interface FourPlusOneLabels {
    fourPlusOne: {
        /** The accessible name of the view switcher. */
        viewsLabel: string;
        views: Record<FourPlusOneView, string>;
        /** One line under the switcher: the question the view answers. */
        hints: Record<FourPlusOneView, string>;
        /** Physical: the deployable units and their apps (`{apps}`), then where the lines end. */
        unitsTitle: string;
        unitApps: string;
        storesTitle: string;
        storesEmpty: string;
        /** Scenarios: one card per line from an entry point, `{from}` → `{to}`. */
        scenariosTitle: string;
        scenariosEmpty: string;
        scenarioRoute: string;
    };
}

export const FOUR_PLUS_ONE_DEFAULTS: FourPlusOneLabels = {
    fourPlusOne: {
        viewsLabel: '4+1 views',
        views: { logical: 'Logical', development: 'Development', process: 'Process', physical: 'Physical', scenarios: 'Scenarios' },
        hints: {
            logical: 'What the system is made of: its components, tier by tier.',
            development: 'How the code is organised: folders and modules.',
            process: 'What runs when: the calls along the selected line.',
            physical: 'Where it runs: the deployable units and the stores and services they reach.',
            scenarios: 'What it is for: the paths that start at each entry point.',
        },
        unitsTitle: 'Deployable units',
        unitApps: 'Apps: {apps}',
        storesTitle: 'Data stores and external services',
        storesEmpty: 'No line ends in a data store or an external service.',
        scenariosTitle: 'Scenarios',
        scenariosEmpty: 'No entry points were found, so there are no scenarios to trace.',
        scenarioRoute: '{from} → {to}',
    },
};
