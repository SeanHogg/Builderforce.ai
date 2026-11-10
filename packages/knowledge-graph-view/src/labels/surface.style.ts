/** The words of the Architecture style camera: the six styles, the verdict, each check and its evidence. */

import type { CheckId, StyleId } from '../surface/style/architectureStyle';

export interface ArchitectureStyleLabels {
    architectureStyle: {
        title: string;
        description: string;
        /** `{style}`, `{percent}`. */
        verdict: string;
        verdictNone: string;
        /** A style's fit: `{percent}`. */
        fit: string;
        styles: Record<StyleId, string>;
        /** What each check looks for. */
        checks: Record<CheckId, string>;
        /** The measured evidence of a check: `{count}`, `{total}`. */
        evidence: string;
        status: Record<'met' | 'partial' | 'missed', string>;
        examples: string;
        empty: string;
    };
}

export const ARCHITECTURE_STYLE_DEFAULTS: ArchitectureStyleLabels = {
    architectureStyle: {
        title: 'Architecture style',
        description: 'Read from the code alone: each style is scored on fixed checks over its layers, dependency directions, file names and deployable units.',
        verdict: 'Closest match: {style} ({percent}% of its checks met)',
        verdictNone: 'No style fits clearly: none meets more than half of its checks ahead of the others.',
        fit: '{percent}% fit',
        styles: {
            ddd: 'Domain-Driven Design', onion: 'Onion', nLayer: 'N-Layer', nTier: 'N-Tier',
            clientServer: 'Client-Server', microservices: 'Microservices',
        },
        checks: {
            domainLayer: 'A domain layer holds a real share of the code',
            dddNamed: 'Files are named as aggregates, entities, value objects or repositories',
            domainIsolated: 'The domain depends on no other layer',
            inverted: 'Infrastructure depends inward, on the domain or application',
            layered: 'The code is split into several layers',
            downward: 'Dependencies point down, never to a higher layer',
            noSkips: 'No dependency skips a layer',
            singleUnit: 'The layers ship as one deployable unit',
            tierSplit: 'Presentation and data live in separate deployable units',
            clientSide: 'A client side has its own folders',
            serverSide: 'A server side has its own folders',
            routes: 'The server exposes routes',
            manyUnits: 'Several deployable units have their own entry points',
            independent: 'The units barely reference each other',
        },
        evidence: 'Measured: {count} of {total}',
        status: { met: 'Met', partial: 'Partly met', missed: 'Not met' },
        examples: 'Examples',
        empty: 'No source files sit in a layer, so there is nothing to classify.',
    },
};
