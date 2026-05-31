import * as react_jsx_runtime from 'react/jsx-runtime';
import { CSSProperties } from 'react';

/**
 * The cross-origin postMessage contract between a host page (e.g. BurnRateOS,
 * via <BuilderForceEmbed>) and the embedded BuilderForce surface running inside
 * the iframe. This is the SINGLE source of truth for the wire protocol — both
 * the host component (this package) and the BuilderForce frame route import it,
 * so the two sides can never drift.
 *
 * Security model: the host NEVER puts the JWT in the iframe URL. The frame
 * announces `ready`; the host replies with `auth` carrying the token. Every
 * message is tagged with `source` and validated against the expected origin on
 * both ends before it is trusted.
 */
declare const BFEMBED_SOURCE: "builderforce-embed/v1";
type EmbedTheme = 'light' | 'dark';
type FrameToHostMessage = 
/** Frame mounted and is ready to receive auth. */
{
    source: typeof BFEMBED_SOURCE;
    type: 'ready';
}
/** Frame's content height changed; host should resize the iframe. */
 | {
    source: typeof BFEMBED_SOURCE;
    type: 'resize';
    height: number;
}
/** Frame navigated internally; host may mirror this into its own URL. */
 | {
    source: typeof BFEMBED_SOURCE;
    type: 'navigate';
    path: string;
}
/** Frame hit an error worth surfacing to the host. */
 | {
    source: typeof BFEMBED_SOURCE;
    type: 'error';
    message: string;
};
type HostToFrameMessage = 
/** Hand the frame the SSO/tenant JWT + optional federated segment coordinates. */
{
    source: typeof BFEMBED_SOURCE;
    type: 'auth';
    token: string;
    accountId?: string;
    companyId?: string;
    theme?: EmbedTheme;
}
/** Push a deep-link the frame should navigate to (host URL → frame sync). */
 | {
    source: typeof BFEMBED_SOURCE;
    type: 'navigate';
    path: string;
};
declare function isFrameToHostMessage(data: unknown): data is FrameToHostMessage;
declare function isHostToFrameMessage(data: unknown): data is HostToFrameMessage;

/**
 * The canonical registry of embeddable BuilderForce surfaces. This is the ONE
 * place the set of views lives — the host <BuilderForceEmbed> validates against
 * it, the BuilderForce frame route resolves `[view]` against it, and host nav
 * can render menus from it. Adding a surface = one entry here.
 *
 * `available` = the embed surface is wired to a real, working app component
 * today (resurfaced, not reimplemented). `available: false` = the view is
 * registered but renders a "coming soon" scaffold until its feature is built or
 * wired. Host nav should show available views as active.
 *
 * Keys match the `view="…"` values in specs/builderforce docs 05 §5.2 and 07 §7.
 */
type EmbedPillar = 'product' | 'agile' | 'governance';
/** The three capability areas a host SuperAdmin enables (governance ⇒ security). */
type EmbedCapability = 'product' | 'agile' | 'security';
declare const EMBED_CAPABILITIES: readonly EmbedCapability[];
/** Map a surface's pillar to the capability that gates it. Single source of truth. */
declare function pillarToCapability(pillar: EmbedPillar): EmbedCapability;
interface EmbedViewMeta {
    /** URL-safe view key (the iframe loads `/embed/<key>`). */
    key: string;
    /** Human label for host nav / titles. */
    label: string;
    /** Which product pillar the surface belongs to. */
    pillar: EmbedPillar;
    /** True when the surface renders a real, working component today. */
    available: boolean;
}
declare const EMBED_VIEWS: {
    readonly ideas: {
        readonly key: "ideas";
        readonly label: "Product Discovery";
        readonly pillar: "product";
        readonly available: false;
    };
    readonly prd: {
        readonly key: "prd";
        readonly label: "PRDs & Specs";
        readonly pillar: "product";
        readonly available: false;
    };
    readonly backlog: {
        readonly key: "backlog";
        readonly label: "Strategic Backlog";
        readonly pillar: "product";
        readonly available: true;
    };
    readonly mvp: {
        readonly key: "mvp";
        readonly label: "MVP Scaffolding";
        readonly pillar: "product";
        readonly available: false;
    };
    readonly validation: {
        readonly key: "validation";
        readonly label: "Validation Lab";
        readonly pillar: "product";
        readonly available: false;
    };
    readonly roadmap: {
        readonly key: "roadmap";
        readonly label: "AI Roadmap";
        readonly pillar: "product";
        readonly available: false;
    };
    readonly 'feature-roi': {
        readonly key: "feature-roi";
        readonly label: "Feature ROI";
        readonly pillar: "product";
        readonly available: false;
    };
    readonly kanban: {
        readonly key: "kanban";
        readonly label: "Kanban";
        readonly pillar: "agile";
        readonly available: true;
    };
    readonly poker: {
        readonly key: "poker";
        readonly label: "Planning Poker";
        readonly pillar: "agile";
        readonly available: false;
    };
    readonly retros: {
        readonly key: "retros";
        readonly label: "Retrospectives";
        readonly pillar: "agile";
        readonly available: false;
    };
    readonly sprints: {
        readonly key: "sprints";
        readonly label: "Sprint Planning";
        readonly pillar: "agile";
        readonly available: false;
    };
    readonly velocity: {
        readonly key: "velocity";
        readonly label: "Velocity";
        readonly pillar: "agile";
        readonly available: false;
    };
    readonly 'feature-scoring': {
        readonly key: "feature-scoring";
        readonly label: "Feature Scoring";
        readonly pillar: "agile";
        readonly available: false;
    };
    readonly security: {
        readonly key: "security";
        readonly label: "Sessions & Access";
        readonly pillar: "governance";
        readonly available: false;
    };
    readonly approvals: {
        readonly key: "approvals";
        readonly label: "Approvals";
        readonly pillar: "governance";
        readonly available: false;
    };
    readonly soc2: {
        readonly key: "soc2";
        readonly label: "SOC 2 Tracker";
        readonly pillar: "governance";
        readonly available: false;
    };
    readonly vendors: {
        readonly key: "vendors";
        readonly label: "Vendor Register";
        readonly pillar: "governance";
        readonly available: false;
    };
    readonly incidents: {
        readonly key: "incidents";
        readonly label: "Security Incidents";
        readonly pillar: "governance";
        readonly available: false;
    };
    readonly 'data-inventory': {
        readonly key: "data-inventory";
        readonly label: "PII & Data Inventory";
        readonly pillar: "governance";
        readonly available: false;
    };
    readonly dpa: {
        readonly key: "dpa";
        readonly label: "DPA Management";
        readonly pillar: "governance";
        readonly available: false;
    };
    readonly training: {
        readonly key: "training";
        readonly label: "Security Training";
        readonly pillar: "governance";
        readonly available: false;
    };
    readonly 'compliance-calendar': {
        readonly key: "compliance-calendar";
        readonly label: "Compliance Calendar";
        readonly pillar: "governance";
        readonly available: false;
    };
    readonly 'access-reviews': {
        readonly key: "access-reviews";
        readonly label: "Access Reviews";
        readonly pillar: "governance";
        readonly available: false;
    };
    readonly 'vuln-scans': {
        readonly key: "vuln-scans";
        readonly label: "Vulnerability Scans";
        readonly pillar: "governance";
        readonly available: false;
    };
    readonly dsr: {
        readonly key: "dsr";
        readonly label: "Data Subject Requests";
        readonly pillar: "governance";
        readonly available: false;
    };
    readonly suppression: {
        readonly key: "suppression";
        readonly label: "Suppression List";
        readonly pillar: "governance";
        readonly available: false;
    };
};
type EmbedView = keyof typeof EMBED_VIEWS;
declare const EMBED_VIEW_KEYS: EmbedView[];
declare function isEmbedView(value: string): value is EmbedView;
declare function embedViewsByPillar(pillar: EmbedPillar): EmbedViewMeta[];
/** The capability that gates a given view (for host nav + frame self-gating). */
declare function capabilityForView(view: EmbedView): EmbedCapability;

interface BuilderForceEmbedProps {
    /** Which BuilderForce surface to mount (see EMBED_VIEWS). */
    view: EmbedView;
    /**
     * The SSO / tenant JWT. A string, or a (possibly async) getter so the host can
     * mint/refresh a token lazily — it is resolved when the frame announces ready
     * and handed over via postMessage (never placed in the iframe URL).
     */
    token: string | (() => string | Promise<string>);
    /** BuilderForce embed origin. Defaults to https://app.builderforce.ai. */
    baseUrl?: string;
    /** Federated segment coordinates for a 'segmented' tenant (account, company). */
    accountId?: string;
    companyId?: string;
    /** Initial deep-link path within the view (e.g. a board id). */
    path?: string;
    theme?: EmbedTheme;
    className?: string;
    style?: CSSProperties;
    /** Floor height until the frame reports its own content height. */
    minHeight?: number;
    /** Fired when the embedded surface navigates — mirror into the host URL. */
    onNavigate?: (path: string) => void;
    onError?: (message: string) => void;
    onReady?: () => void;
}
/**
 * The single, DRY embed rail for re-embedding BuilderForce into a host app.
 * One component parameterized by `view` — it owns the iframe mount, the secure
 * JWT handoff, auto-resize, and deep-link sync. Hosts never build bespoke
 * per-view embeds; they render <BuilderForceEmbed view="…" />.
 */
declare function BuilderForceEmbed({ view, token, baseUrl, accountId, companyId, path, theme, className, style, minHeight, onNavigate, onError, onReady, }: BuilderForceEmbedProps): react_jsx_runtime.JSX.Element;

/**
 * Pure dispatch for inbound frame→host messages. Extracted from the component so
 * the origin check + routing is unit-testable without mounting an iframe.
 */
interface FrameMessageHandlers {
    /** Origin the iframe is served from; messages from any other origin are ignored. */
    embedOrigin: string;
    onReady: () => void;
    onResize: (height: number) => void;
    onNavigate: (path: string) => void;
    onError: (message: string) => void;
}
declare function handleFrameMessage(event: MessageEvent, h: FrameMessageHandlers): void;

export { BFEMBED_SOURCE, BuilderForceEmbed, type BuilderForceEmbedProps, EMBED_CAPABILITIES, EMBED_VIEWS, EMBED_VIEW_KEYS, type EmbedCapability, type EmbedPillar, type EmbedTheme, type EmbedView, type EmbedViewMeta, type FrameMessageHandlers, type FrameToHostMessage, type HostToFrameMessage, capabilityForView, embedViewsByPillar, handleFrameMessage, isEmbedView, isFrameToHostMessage, isHostToFrameMessage, pillarToCapability };
