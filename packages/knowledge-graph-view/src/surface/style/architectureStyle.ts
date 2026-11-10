/**
 * The Architecture Style model — PURE: which of six architectural styles the code follows, scored from the graph
 * alone (no model call). Each style is a fixed list of weighted checks over the readings of `signals.ts`; a check is
 * met by a fraction 0–1 and carries the reading it was scored on, so the verdict comes with its evidence. A style's
 * fit is the weighted share of its checks met. Equal graphs give equal rankings (ties keep {@link STYLE_IDS} order).
 *
 * What tells the styles apart (the dependency rule is the strongest signal):
 *  - DDD: a real domain layer, files named as DDD building blocks, a domain that depends on nothing outside it.
 *  - Onion: the domain depends on nothing outside it AND infrastructure depends inward (dependency inversion).
 *  - N-Layer: several logical layers in ONE deployable, dependencies pointing down.
 *  - N-Tier: layers that never skip one, with presentation and data in separate deployables.
 *  - Client-Server: client and server sides in their own folders, the server exposing routes.
 *  - Microservices: several deployables with their own entry points that barely reference each other.
 */

import { readStyleSignals, type Reading, type StyleSignals } from './signals';

export type StyleId = 'ddd' | 'onion' | 'nLayer' | 'nTier' | 'clientServer' | 'microservices';
export const STYLE_IDS: readonly StyleId[] = ['ddd', 'onion', 'nLayer', 'nTier', 'clientServer', 'microservices'];

export type CheckId =
    | 'domainLayer' | 'dddNamed' | 'domainIsolated' | 'inverted' | 'layered' | 'downward' | 'noSkips'
    | 'singleUnit' | 'tierSplit' | 'clientSide' | 'serverSide' | 'routes' | 'manyUnits' | 'independent';

export interface StyleCheck {
    id: CheckId;
    weight: number;
    /** 0 (not met) to 1 (fully met). */
    met: number;
    /** The reading the check was scored on. */
    evidence: Reading;
}

export interface StyleScore {
    id: StyleId;
    /** Weighted share of the checks met, 0–1. */
    fit: number;
    checks: StyleCheck[];
}

export interface StyleAnalysis {
    /** Best fit first. */
    styles: StyleScore[];
    /** The best style when it fits at least {@link FIT_THRESHOLD} and beats the runner-up; null = no clear style. */
    winner: StyleId | null;
    signals: StyleSignals;
}

export const FIT_THRESHOLD = 0.5;

/** A fit as the whole percent every reading shows (the style card, the stage's verdict caption). */
export const percentOf = (fit: number): number => Math.round(fit * 100);

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
/** The share `count / total`, full marks at `full`; nothing measured scores 0. */
const share = (r: Reading, full: number): number => (r.total === 0 ? 0 : clamp01(r.count / r.total / full));
/** Full marks at `n` counted files. */
const atLeast = (r: Reading, n: number): number => clamp01(r.count / n);
/** Full marks when none of the measured dependencies is counted; nothing measured scores `empty`. */
const noneOf = (r: Reading, empty: number): number => (r.total === 0 ? empty : clamp01(1 - r.count / r.total));

type Rule = (s: StyleSignals) => Omit<StyleCheck, 'weight'>;

const RULES: Record<CheckId, Rule> = {
    domainLayer: (s) => ({ id: 'domainLayer', met: share(s.domain, 0.15), evidence: s.domain }),
    dddNamed: (s) => ({ id: 'dddNamed', met: atLeast(s.dddNamed, 3), evidence: s.dddNamed }),
    // A domain with no files is not isolated, it is absent; a domain with files and no outgoing dependency is.
    domainIsolated: (s) => ({ id: 'domainIsolated', met: s.domain.count === 0 ? 0 : noneOf(s.domainOutward, 1), evidence: s.domainOutward }),
    inverted: (s) => ({ id: 'inverted', met: share(s.inverted, 0.25), evidence: s.inverted }),
    layered: (s) => ({ id: 'layered', met: clamp01((s.layers.count - 1) / 3), evidence: s.layers }),
    downward: (s) => ({ id: 'downward', met: noneOf(s.upward, 0), evidence: s.upward }),
    noSkips: (s) => ({ id: 'noSkips', met: noneOf(s.skips, 0), evidence: s.skips }),
    singleUnit: (s) => ({ id: 'singleUnit', met: s.units.count <= 1 ? 1 : 0, evidence: s.units }),
    tierSplit: (s) => ({ id: 'tierSplit', met: atLeast(s.tierSplit, 2), evidence: s.tierSplit }),
    clientSide: (s) => ({ id: 'clientSide', met: atLeast(s.client, 3), evidence: s.client }),
    serverSide: (s) => ({ id: 'serverSide', met: atLeast(s.server, 3), evidence: s.server }),
    routes: (s) => ({ id: 'routes', met: atLeast(s.routes, 1), evidence: s.routes }),
    manyUnits: (s) => ({ id: 'manyUnits', met: clamp01((s.unitsWithEntry.count - 1) / 2), evidence: s.unitsWithEntry }),
    independent: (s) => ({ id: 'independent', met: s.units.count < 2 ? 0 : noneOf(s.crossUnit, 1), evidence: s.crossUnit }),
};

/** Each style's checks and their weights: THE recipe, in one table. */
export const STYLE_CHECKS: Record<StyleId, ReadonlyArray<readonly [CheckId, number]>> = {
    ddd: [['domainLayer', 2], ['dddNamed', 2], ['domainIsolated', 1]],
    onion: [['domainLayer', 1], ['domainIsolated', 2], ['inverted', 2]],
    nLayer: [['layered', 2], ['downward', 2], ['singleUnit', 1]],
    nTier: [['layered', 1], ['noSkips', 2], ['downward', 1], ['tierSplit', 2]],
    clientServer: [['clientSide', 2], ['serverSide', 2], ['routes', 1]],
    microservices: [['manyUnits', 3], ['independent', 2], ['routes', 1]],
};

/** Score the six styles from already-read signals (the tests drive this directly). */
export function scoreStyles(signals: StyleSignals): StyleAnalysis {
    const styles = STYLE_IDS.map((id): StyleScore => {
        const checks = STYLE_CHECKS[id].map(([check, weight]): StyleCheck => {
            const c = RULES[check](signals);
            return { ...c, met: round4(c.met), weight };
        });
        const weights = checks.reduce((sum, c) => sum + c.weight, 0);
        const fit = checks.reduce((sum, c) => sum + c.weight * c.met, 0) / weights;
        return { id, fit: round4(fit), checks };
    });
    const order = (id: StyleId): number => STYLE_IDS.indexOf(id);
    styles.sort((a, b) => b.fit - a.fit || order(a.id) - order(b.id));
    const [top, next] = styles;
    const winner = top && top.fit >= FIT_THRESHOLD && (!next || top.fit > next.fit) ? top.id : null;
    return { styles, winner, signals };
}

/** Read and score the graph. */
export function architectureStyleOf(graph: Parameters<typeof readStyleSignals>[0]): StyleAnalysis {
    return scoreStyles(readStyleSignals(graph));
}
