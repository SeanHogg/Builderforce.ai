/**
 * The view's colour TOKENS as pure data: `--kg-*`, each falling back to an existing shared token (`--bf-*`, the
 * brain-ui palette every host already defines — the web app, the VS Code webview and Rovr). No React, no DOM: the
 * compute worker (`stage/tones.ts`, paint and placement tasks) imports this, and `themeColors.ts` resolves it in the
 * DOM. Keep it free of imports.
 */

/** token → the existing token it falls back to. */
export const KG_TOKENS = {
    bg: ['--kg-bg', '--bf-surface'],
    panel: ['--kg-panel', '--bf-surface-2'],
    panel2: ['--kg-panel2', '--bf-surface-2'],
    text: ['--kg-text', '--bf-text'],
    muted: ['--kg-muted', '--bf-text-muted'],
    border: ['--kg-border', '--bf-border'],
    accent: ['--kg-accent', '--bf-accent'],
    accentSoft: ['--kg-accent-soft', '--bf-accent-soft'],
    onAccent: ['--kg-on-accent', '--bf-on-accent'],
    nodeFile: ['--kg-node-file', '--bf-accent'],
    nodeSection: ['--kg-node-section', '--bf-link'],
    nodeSymbol: ['--kg-node-symbol', '--bf-text-secondary'],
    nodeEntity: ['--kg-node-entity', '--bf-success'],
    nodeClaim: ['--kg-node-claim', '--bf-warning'],
    nodeFact: ['--kg-node-fact', '--bf-danger'],
    nodeMissing: ['--kg-node-missing', '--bf-danger'],
    // The file-category hues (PRD 38's redundant encoding): a file node reads its category from
    // `./fileCategory`, and each category gets one tone. They fall back to the existing `--bf-*`
    // palette so a host that defines no `--kg-cat-*` still gets a distinct, coherent hue per category.
    catSource: ['--kg-cat-source', '--bf-accent'],
    catTest: ['--kg-cat-test', '--bf-link'],
    catDoc: ['--kg-cat-doc', '--bf-text-secondary'],
    catConfig: ['--kg-cat-config', '--bf-warning'],
    catStyle: ['--kg-cat-style', '--bf-danger'],
    catData: ['--kg-cat-data', '--bf-success'],
    catOther: ['--kg-cat-other', '--bf-text-muted'],
    // The 1138 area nodes: a visible tone, distinct from the `plane` background surface (`--bf-surface-2`).
    nodeArea: ['--kg-node-area', '--bf-border-strong'],
    edge: ['--kg-edge', '--bf-border-strong'],
    violation: ['--kg-violation', '--bf-danger'],
    cycle: ['--kg-cycle', '--bf-warning'],
    // The file an anti-pattern's offender reaches into (the Tower highlight's amber).
    partner: ['--kg-partner', '--bf-warning'],
    duplicate: ['--kg-duplicate', '--bf-warning'],
    contradicts: ['--kg-contradicts', '--bf-danger'],
    agrees: ['--kg-agrees', '--bf-success'],
    stale: ['--kg-stale', '--bf-text-muted'],
    unused: ['--kg-unused', '--bf-text-muted'],
    changed: ['--kg-changed', '--bf-accent'],
    plane: ['--kg-plane', '--bf-surface-2'],
    warnBg: ['--kg-warn-bg', '--bf-warning-bg'],
    errorText: ['--kg-error', '--bf-error'],
    // The tower camera's pipe underlay (a step above the page) and the translucent shadow under a tower.
    raise: ['--kg-raise', '--bf-border'],
    scrim: ['--kg-scrim', '--bf-border-strong'],
    // The darker side face of a tower (the design's `rgba(0,0,0,.22)`, a shade over whatever the body's fill is).
    towerSide: ['--kg-tower-side', '--bf-border-strong'],
    // The 5-step severity ramp (1 clean … 5 worst) and the line palette of the transit map.
    sev1: ['--kg-sev-1', '--bf-success'],
    sev2: ['--kg-sev-2', '--bf-success'],
    sev3: ['--kg-sev-3', '--bf-warning'],
    sev4: ['--kg-sev-4', '--bf-warning'],
    sev5: ['--kg-sev-5', '--bf-danger'],
    line1: ['--kg-line-1', '--bf-accent'],
    line2: ['--kg-line-2', '--bf-text-secondary'],
    line3: ['--kg-line-3', '--bf-link'],
    line4: ['--kg-line-4', '--bf-text-secondary'],
    line5: ['--kg-line-5', '--bf-success'],
    line6: ['--kg-line-6', '--bf-warning'],
    line7: ['--kg-line-7', '--bf-danger'],
    line8: ['--kg-line-8', '--bf-text-muted'],
    // The surface's heat ramp (w1 quiet … w5 hot) and its four route hues (l1..l4).
    w1: ['--kg-w-1', '--bf-border'],
    w2: ['--kg-w-2', '--bf-accent'],
    w3: ['--kg-w-3', '--bf-warning'],
    w4: ['--kg-w-4', '--bf-warning'],
    w5: ['--kg-w-5', '--bf-danger'],
    l1: ['--kg-l-1', '--bf-accent'],
    l2: ['--kg-l-2', '--bf-success'],
    l3: ['--kg-l-3', '--bf-text-secondary'],
    l4: ['--kg-l-4', '--bf-warning'],
    // Architecture layer bands.
    bandEntry: ['--kg-band-entry', '--bf-accent'],
    bandPresentation: ['--kg-band-presentation', '--bf-accent'],
    bandApplication: ['--kg-band-application', '--bf-text-secondary'],
    bandDomain: ['--kg-band-domain', '--bf-success'],
    bandInfrastructure: ['--kg-band-infrastructure', '--bf-warning'],
    bandData: ['--kg-band-data', '--bf-warning'],
    bandOther: ['--kg-band-other', '--bf-text-muted'],
} as const satisfies Record<string, readonly [string, string]>;

export type ThemeTone = keyof typeof KG_TOKENS;
export type ThemeColors = Record<ThemeTone, string>;
