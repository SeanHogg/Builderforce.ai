# @seanhogg/builderforce-embedded

Re-embed BuilderForce surfaces — Product Management, Agile, and Governance — into any React host (e.g. BurnRateOS) with **one** component.

```tsx
import { BuilderForceEmbed } from '@seanhogg/builderforce-embedded';

// A BurnRateOS thin-shell page:
export default function KanbanPage() {
  return <BuilderForceEmbed view="kanban" token={ssoToken} />;
}
```

One DRY rail — hosts never build per-view embeds. The component:

- mounts a **sandboxed iframe** at `${baseUrl}/embed/<view>`;
- hands the **SSO/tenant JWT to the frame over `postMessage`** after a `ready` handshake — the token is **never** put in the iframe URL;
- **auto-resizes** the iframe to the embedded content height;
- **syncs deep links** both ways (`onNavigate` out, `path` in);
- shows a loading state and surfaces frame errors via `onError`.

## Props

| Prop | Type | Notes |
|---|---|---|
| `view` | `EmbedView` | One of `EMBED_VIEWS` (e.g. `kanban`, `ideas`, `soc2`). |
| `token` | `string \| () => string \| Promise<string>` | The SSO/tenant JWT, or a (refreshable) getter. Resolved on the frame's `ready`, sent over `postMessage`. |
| `baseUrl` | `string` | BuilderForce embed origin. Default `https://app.builderforce.ai`. |
| `accountId` / `companyId` | `string` | Federated segment coordinates for a `segmented` tenant. |
| `path` | `string` | Initial deep-link within the view; later changes are pushed to the frame. |
| `theme` | `'light' \| 'dark'` | Passed to the frame. |
| `onNavigate(path)` | fn | Frame navigated — mirror into the host URL. |
| `onError(message)` / `onReady()` | fn | Lifecycle callbacks. |
| `className` / `style` / `minHeight` | — | Styling. |

## Available views

`EMBED_VIEWS` is the single source of truth. Product: `ideas`, `mvp`, `backlog`, `validation`, `roadmap`, `feature-roi`. Agile: `kanban`, `poker`, `retros`, `sprints`, `velocity`, `feature-scoring`. Governance (Phase 2): `soc2`, `vendors`, `incidents`, `data-inventory`, `dpa`, `training`, `compliance-calendar`, `access-reviews`, `vuln-scans`, `dsr`, `suppression`.

## The frame side

The embedded BuilderForce app implements the other half of the protocol exported here (`isFrameToHostMessage`, `BFEMBED_SOURCE`, `handleFrameMessage`) at `/embed/<view>` — it announces `ready`, receives `auth`, reports `resize`, and emits `navigate`. Importing the protocol from this package keeps both ends from drifting.

## Security

- Token is delivered by `postMessage` to the iframe's origin only — never in the URL, query, or referrer.
- Inbound frame→host messages are accepted only from the configured embed origin and only when they match the protocol shape.
- The iframe is `sandbox`ed (`allow-scripts allow-forms allow-popups allow-same-origin allow-downloads`) with `strict-origin-when-cross-origin` referrer policy.
