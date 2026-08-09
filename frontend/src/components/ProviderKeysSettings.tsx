'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { useToast } from '@/components/ToastProvider';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { ClickableCard } from '@/components/ClickableCard';
import { ConnectToggleButton } from '@/components/integrations/ConnectToggleButton';
import { millicentsToUsd } from '@/lib/spendLimits';
import { ConsumptionMeterCard } from '@/components/UsageMeter';
import { CopyButton } from '@/components/CopyButton';
import { useDragReorder } from '@/lib/useDragReorder';
import {
  openRouterConnectionsApi,
  providerKeysApi,
  type ByoPrecedenceEntry,
  type ConnectionAuthAlert,
  type OpenRouterCatalogModel,
  type OpenRouterConnection,
  type ProbeDiagnostic,
  type ProviderAuthAlert,
  type ProviderAuthType,
  type ProviderDiagnostic,
  type LlmProvider,
} from '@/lib/builderforceApi';

/**
 * BYO (bring-your-own-provider) credentials. A workspace owner connects their OWN
 * frontier-model accounts — Anthropic, OpenAI, and/or Google — and the platform
 * routes calls through the tenant's account instead of Builderforce's metered pool.
 * Connecting a provider unlocks that provider's models in every picker and (for a
 * free plan) unlocks model choice; own-machine (on-prem/VSIX) usage is then free,
 * cloud-agent usage is still charged.
 *
 * ONE shared {@link ProviderConnectionCard} renders each provider — the provider
 * config drives the differences (Anthropic also offers a Pro/Max SUBSCRIPTION via
 * OAuth; OpenAI/Google are API-key only). Secrets are write-only: we only show
 * whether/how a credential is configured, never the value. Fully localized under
 * the `providerKeys` namespace; brand names + key formats stay literal.
 */

interface ProviderConfig {
  id: LlmProvider;
  /** Display name of the provider — a brand, kept literal (not translated). */
  label: string;
  /** Placeholder / format hint for the API-key input — literal. */
  keyPlaceholder: string;
  /** Provider supports connecting a consumer subscription via OAuth. */
  supportsOauth: boolean;
}

const PROVIDERS: ProviderConfig[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', keyPlaceholder: 'sk-ant-…', supportsOauth: true },
  { id: 'openai',    label: 'OpenAI',             keyPlaceholder: 'sk-…',     supportsOauth: true },
  { id: 'google',    label: 'Google (Gemini)',    keyPlaceholder: 'AIza…',   supportsOauth: false },
  { id: 'meta',      label: 'Meta AI (MUSE)',     keyPlaceholder: 'meta-…',  supportsOauth: false },
  { id: 'kimi',      label: 'Kimi',                keyPlaceholder: 'sk-…',    supportsOauth: false },
  { id: 'moonshot',  label: 'Moonshot AI',         keyPlaceholder: 'sk-…',    supportsOauth: false },
  { id: 'qwen',      label: 'Qwen',                keyPlaceholder: 'sk-…',    supportsOauth: false },
  { id: 'minimax',   label: 'MiniMax',             keyPlaceholder: 'sk-…',    supportsOauth: false },
  { id: 'xai',       label: 'xAI (Grok)',           keyPlaceholder: 'xai-…',   supportsOauth: true },
];

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 20,
};
const wrapStyle: React.CSSProperties = {
  display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
};
const sectionTitle: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', fontSize: 13, background: 'var(--bg-elevated)',
  color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
  boxSizing: 'border-box', fontFamily: 'var(--font-mono)', minWidth: 0,
};
const buttonPrimary: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--surface-interactive)',
  color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
const buttonDanger: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'none',
  color: 'var(--coral-bright)', border: '1px solid var(--coral-bright)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
const dividerRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0', color: 'var(--text-muted)', fontSize: 11, fontWeight: 600,
};
const dividerLine: React.CSSProperties = { flex: 1, height: 1, background: 'var(--border-subtle)' };

type TFn = ReturnType<typeof useTranslations>;

/** Ledger millicents → a displayable USD amount. Sub-cent spend is real (the routing
 *  surcharge is 1¢/request, token costs are fractions), so it keeps 4 decimals rather than
 *  rounding a month of genuine usage to "$0.00". */
function formatUsd(millicents: number): string {
  const usd = millicentsToUsd(millicents);
  return `$${usd >= 0.01 || usd === 0 ? usd.toFixed(2) : usd.toFixed(4)}`;
}

/** Provider display label by id — literal brand names (not translated). */
const PROVIDER_LABEL: Record<LlmProvider, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  google: 'Google (Gemini)',
  meta: 'Meta AI (MUSE)',
  kimi: 'Kimi',
  moonshot: 'Moonshot AI',
  qwen: 'Qwen',
  minimax: 'MiniMax',
  xai: 'xAI (Grok)',
};

/**
 * Display label for ONE precedence entry — the single formatter the drawer list, the
 * toolbar chip and any future consumer share.
 *
 * It exists because the precedence list interleaves TWO kinds of rankable account
 * (a connected provider, and a named OpenRouter connection). Anything that formats only
 * the provider half reports a different leader than the list shows — the bug where a
 * tenant whose #1 was an OpenRouter connection saw the chip claim "Priority · Anthropic",
 * i.e. the account ranked SECOND.
 */
function precedenceEntryLabel(entry: ByoPrecedenceEntry): string {
  return entry.kind === 'provider'
    ? PROVIDER_LABEL[entry.provider]
    : `OpenRouter · ${entry.connection.label} (${entry.connection.models.length})`;
}

/** Label of the account that currently LEADS `refs`, or null when nothing is ranked.
 *  Falls back to a bare provider's brand name for a ref that isn't in `entries` yet
 *  (a just-connected provider, before the next list read). */
function precedenceLeaderLabel(
  entries: readonly ByoPrecedenceEntry[],
  refs: readonly string[],
): string | null {
  const leader = refs[0];
  if (!leader) return null;
  const entry = entries.find((e) => e.ref === leader);
  if (entry) return precedenceEntryLabel(entry);
  return PROVIDER_LABEL[leader as LlmProvider] ?? leader;
}

/**
 * BYO PRECEDENCE — the ordered list (most-preferred first) the auto-select cloud pin
 * leads its connected flagships by. Shown only when 2+ providers are connected (order
 * is moot with one). Reordering persists the whole list via `setPriority`, so an owner
 * at their Anthropic quota can put **Meta first** and have cloud agents route there.
 */
/**
 * THE ordered "what gets tried first" list — one implementation for both places a tenant
 * ranks something.
 *
 * Two different things are ranked on this page and they mean the same thing to the router:
 * the ACCOUNT precedence (which connected account leads) and, inside one OpenRouter
 * registration, the MODEL order (which id the cascade seeds with, and which the Test button
 * probes). Both are a list where position 1 wins, so both get the same numbered rows, the
 * same ↑/↓ affordance, and the same "leads" badge — a second hand-rolled reorder list is how
 * the two drift into looking like unrelated features.
 *
 * `onRemove` is optional: precedence rows are removed by disconnecting the account, while a
 * model row can be dropped from the registration in place.
 *
 * Reordering is drag-first (shared {@link useDragReorder}) with the ↑/↓ buttons kept as the
 * keyboard- and touch-accessible path — native HTML5 drag fires on neither.
 */
function ReorderableList({
  keys,
  labels,
  onReorder,
  onRemove,
  t,
}: {
  keys: string[];
  labels: Record<string, string>;
  onReorder: (next: string[]) => void;
  onRemove?: (key: string) => void;
  t: TFn;
}) {
  const labelFor = (key: string) => labels[key] ?? key;
  const drag = useDragReorder(keys, onReorder);

  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {keys.map((key, i) => (
        <li
          key={key}
          {...drag.dragHandleProps(key)}
          {...drag.dropTargetProps(key)}
          aria-label={t('precedence.rowLabel', { provider: labelFor(key), position: i + 1 })}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', flexWrap: 'wrap',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
            cursor: 'grab', opacity: drag.draggingKey === key ? 0.4 : 1,
            outline: drag.dropKey === key ? '2px dashed var(--coral-bright)' : 'none',
            outlineOffset: 2, transition: 'opacity 120ms ease',
          }}
        >
          {/* Affordance only — the whole row is the drag source, so the grip needs no
              handlers of its own (and must not steal the row's aria-label). */}
          <span aria-hidden="true" title={t('precedence.drag')} style={{ fontSize: 13, lineHeight: 1, color: 'var(--text-muted)' }}>⠿</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', minWidth: 18, textAlign: 'center' }}>{i + 1}</span>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', minWidth: 0, wordBreak: 'break-word' }}>
            {labelFor(key)}
          </span>
          {i === 0 && (
            <span style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(34,197,94,0.9)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {t('precedence.leads')}
            </span>
          )}
          <button
            type="button"
            onClick={() => drag.nudge(key, -1)}
            disabled={i === 0}
            aria-label={t('precedence.moveUp', { provider: labelFor(key) })}
            style={{ ...buttonPrimary, padding: '2px 9px', opacity: i === 0 ? 0.4 : 1 }}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => drag.nudge(key, 1)}
            disabled={i === keys.length - 1}
            aria-label={t('precedence.moveDown', { provider: labelFor(key) })}
            style={{ ...buttonPrimary, padding: '2px 9px', opacity: i === keys.length - 1 ? 0.4 : 1 }}
          >
            ↓
          </button>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(key)}
              aria-label={t('openRouter.removeModel', { model: labelFor(key) })}
              style={{ ...buttonDanger, padding: '2px 9px' }}
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

function PrecedencePanel({
  order,
  labels,
  onReorder,
  t,
}: {
  order: string[];
  labels: Record<string, string>;
  onReorder: (next: string[]) => void;
  t: TFn;
}) {
  return (
    <div style={{ ...cardStyle, marginBottom: 20 }}>
      <div style={sectionTitle}>{t('precedence.title')}</div>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>{t('precedence.subtitle')}</p>
      {order.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t('status.notConnected')}</div>}
      <ReorderableList keys={order} labels={labels} onReorder={onReorder} t={t} />
    </div>
  );
}

/**
 * "Reconnect this account" notice — the operator-facing end of the gateway's
 * auth-class failover signal.
 *
 * Rendered whenever a connected account was REJECTED on a recent call (401/403).
 * Nothing else on this page can show that: `● connected` only means a credential is
 * stored, and the diagnostic status only means it decrypts — a ChatGPT plan that
 * lapsed still satisfies both while 403ing every request. Until now the gateway
 * cooled the vendor, failed over, and the operator was never told, so the account
 * sat "connected" and unused indefinitely.
 *
 * Warning-coloured, not error: the request itself succeeded elsewhere, so this is
 * "your account isn't being used", not "something is broken". Uses the theme's
 * `--warning-*` triple with literal fallbacks so it reads in light AND dark, and
 * wraps freely so it doesn't overflow a 360px viewport.
 */
/** Failure reason → its remediation copy key. Typed as an exhaustive record so adding a
 *  reason to {@link ProviderAuthAlert} is a compile error until copy exists for it — the
 *  alternative (interpolating the reason into the key) silently renders a raw key the day
 *  the API grows a new one, and the reasons are snake_case while the catalog is camel. */
const ALERT_COPY_KEY: Record<ProviderAuthAlert['reason'], string> = {
  not_entitled: 'authAlert.notEntitled',
  rejected: 'authAlert.rejected',
  capacity: 'authAlert.capacity',
  unresolved: 'authAlert.unresolved',
};

/** Localized label for a probe/diagnostic status id; an id with no copy degrades to the
 *  humanized raw value rather than rendering a bare key. */
function stateLabel(t: TFn, status: string): string {
  const label = t(`diagnostic.state.${status}`);
  return label === `diagnostic.state.${status}` ? status.replaceAll('_', ' ') : label;
}

/** How loudly a verdict should read. `warn` is the case that matters: the credential WORKED
 *  and something downstream of it broke, which must not be painted as a failed connection —
 *  red there sends an owner to re-enter a key that is fine. */
type ProbeTone = 'ok' | 'warn' | 'error';

export interface ProbeVerdict {
  message: string;
  tone: ProbeTone;
  /** Redacted upstream evidence, when the probe reached a response. Rides the verdict so
   *  BOTH surfaces get the copy affordance from the one seam — see {@link ProbeResultLine}. */
  diagnostic?: ProbeDiagnostic;
}

/**
 * The redacted diagnostic as a block an operator pastes into a provider support ticket.
 *
 * Deliberately NOT localized: this is a technical artifact addressed to the upstream
 * provider's own support desk, in the same class as a log line or a request id. Its field
 * names have to match what a provider engineer greps for, and translating them would make
 * a French operator's ticket unreadable to the vendor they are filing it with. The copy
 * BUTTON and every word of UI around it are localized.
 */
function formatDiagnosticTrace(d: ProbeDiagnostic): string {
  const headers = Object.entries(d.headers);
  return [
    'Builderforce.ai upstream diagnostic (redacted)',
    `observed-at:   ${d.observedAt}`,
    `trace-id:      ${d.traceId}`,
    `endpoint:      POST ${d.endpoint}`,
    `model:         ${d.model}`,
    `http-status:   ${d.status}`,
    // The distinction the whole artifact exists to prove: an HTML body means something in
    // front of the API refused the call, so the credential was never the thing rejected.
    `edge-blocked:  ${d.edgeBlocked ? 'yes (response body was an HTML page, not the API error envelope)' : 'no'}`,
    'response-headers:',
    ...(headers.length > 0
      ? headers.map(([name, value]) => `  ${name}: ${value}`)
      : ['  (none of the correlation headers were present)']),
    'No credential, prompt, or request body is included.',
  ].join('\n');
}

/**
 * Probe verdict → the one line an operator reads.
 *
 * Shared by the provider card and the OpenRouter connection rows: both run the same probe
 * primitive server-side, so a verdict must read the same way on both surfaces — the moment
 * one of them formats its own message they start explaining identical failures differently.
 */
function probeVerdict(
  t: TFn,
  result: { ok: boolean; status: string; model?: string; limitedModels?: string[]; error?: string; diagnostic?: ProbeDiagnostic },
): ProbeVerdict {
  if (result.ok) {
    return {
      // Amber communicates that routing is working but some of the selected cascade is
      // temporarily unavailable. Crucially this is not the red, connection-disabled state.
      tone: result.limitedModels?.length ? 'warn' : 'ok',
      message: result.limitedModels?.length
        ? t('diagnostic.verifiedWithLimited', { model: result.model ?? '', limited: result.limitedModels.join(', ') })
        : result.model ? t('diagnostic.verifiedWith', { model: result.model }) : t('diagnostic.verified'),
    };
  }
  return {
    // An upstream outage is not this account's fault and not this operator's job to fix.
    tone: result.status === 'upstream_error' ? 'warn' : 'error',
    // Server responses carry machine status codes; compose all operator-facing prose
    // here so every supported locale sees the same diagnostic contract.
    message: t('diagnostic.failedFallback', { status: stateLabel(t, result.status) }),
    ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
  };
}

/**
 * The verdict line under a Test button — same colour rules and a11y role wherever a probe
 * reports back. Amber for an upstream outage, red only for something the owner can fix.
 *
 * When the probe reached a response it also offers the redacted trace. That exists because
 * "tell me what happened" and "give me something I can send the provider" are different
 * asks, and only the first was answerable: an operator escalating to a vendor had nothing
 * but our own prose about the failure. The affordance decides its OWN visibility — no
 * caller passes a `canShowTrace` flag it would have to derive from the same field.
 */
function ProbeResultLine({ result, t }: { result: ProbeVerdict; t: TFn }) {
  const color = result.tone === 'ok' ? 'rgba(34,197,94,0.9)'
    : result.tone === 'warn' ? 'var(--warning-text)'
    : 'var(--error)';
  const { diagnostic } = result;
  return (
    <div
      role={result.tone === 'error' ? 'alert' : 'status'}
      style={{ fontSize: 11.5, color, marginTop: 7, lineHeight: 1.5 }}
    >
      {result.message}
      {diagnostic && (
        // Wraps and stays tappable at 360px: the button is min-height 32 and the summary
        // is free to drop to its own line rather than forcing a horizontal scroll.
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <CopyButton
            getText={() => formatDiagnosticTrace(diagnostic)}
            label={t('diagnostic.copyTrace')}
            ariaLabel={t('diagnostic.copyTraceAria')}
            compact
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {diagnostic.edgeBlocked
              ? t('diagnostic.traceEdgeBlocked', { status: diagnostic.status })
              : t('diagnostic.traceHint', { status: diagnostic.status })}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * "What has this account actually served?" — the consumption line, shared by the provider
 * drawer and every OpenRouter registration.
 *
 * Health and USAGE are different questions and an operator needs both: a registration can be
 * perfectly healthy and have served nothing for a month (wrong model order, out-ranked by a
 * higher-precedence account), which no green chip will ever tell you. The window is passed in
 * rather than baked into the copy so both surfaces report the period their own API measured.
 */
function UsageStrip({
  t, days, requests, tokens, lastUsedAt, children,
}: {
  t: TFn;
  days: number;
  requests: number;
  tokens: number;
  lastUsedAt: string | null;
  /** Extra billing detail appended by a caller that has one (an OpenRouter registration
   *  knows whose money paid; a provider credential does not). */
  children?: React.ReactNode;
}) {
  return (
    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
      {t('diagnostic.usage', {
        days,
        requests: requests.toLocaleString(),
        tokens: tokens.toLocaleString(),
      })}
      {lastUsedAt ? t('diagnostic.lastUsed', { when: new Date(lastUsedAt).toLocaleString() }) : ''}
      {children}
    </div>
  );
}

/** "This costs real money" — shown wherever a Test button is, because a probe is a genuine
 *  upstream request billed to the account under test, and an operator who clicks it should
 *  not discover that from their provider's spend dashboard afterwards. */
function ProbeCostNote({ t }: { t: TFn }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
      {t('diagnostic.testCost')}
    </div>
  );
}

/** Everything this notice reads off an alert. Deliberately narrower than either alert type
 *  so ONE notice renders a rejected provider account and a rejected OpenRouter registration
 *  — the remediation depends on the REASON, never on which kind of account it was. */
type RenderableAuthAlert = Pick<ProviderAuthAlert, 'reason' | 'status' | 'vendor'>;

function AuthAlertNotice({ alert, t }: { alert: RenderableAuthAlert; t: TFn }) {
  const copyKey = alert.vendor === 'minimax' && alert.reason === 'capacity'
    ? 'authAlert.minimaxCapacity'
    : alert.vendor === 'kimi-code'
    ? alert.reason === 'not_entitled' ? 'authAlert.kimiNotEntitled'
      : alert.reason === 'capacity' ? 'authAlert.kimiCapacity'
      : ALERT_COPY_KEY[alert.reason]
    : alert.vendor === 'xai-oauth'
    ? alert.reason === 'not_entitled' ? 'authAlert.xaiNotEntitled'
      : alert.reason === 'capacity' ? 'authAlert.xaiCapacity'
      : ALERT_COPY_KEY[alert.reason]
    : ALERT_COPY_KEY[alert.reason];
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        gap: 6,
        marginTop: 8,
        padding: '8px 10px',
        borderRadius: 'var(--radius-md)',
        fontSize: 11.5,
        lineHeight: 1.5,
        background: 'var(--warning-bg, rgba(245,158,11,0.16))',
        color: 'var(--warning-text)',
        border: '1px solid var(--warning)',
      }}
    >
      <strong style={{ fontWeight: 700 }}>{t('authAlert.title')}</strong>
      <span style={{ minWidth: 0 }}>{t(copyKey, { status: alert.status })}</span>
    </div>
  );
}

/**
 * THE connection-status chip — grid card and details drawer both render this one
 * component, so they cannot disagree about whether an account is working.
 *
 * It deliberately reports HEALTH, not configuration. Both surfaces previously coloured
 * themselves green off "a credential is stored", which is why the Integrations page could
 * show five healthy-looking cards while Test connection failed on one of them: a lapsed
 * subscription, a rotated key and an out-of-credit account all keep a stored credential
 * that decrypts perfectly. When the daily sweep (or a dispatch, or the Test button) has
 * recorded an alert, this reads "needs attention" in warning colour instead — the chip
 * decides that itself from the alert, rather than taking a `healthy` prop a caller could
 * forget to pass.
 */
function ProviderStatusChip({
  label, subscription, authType, alert, t, style,
}: {
  label: string;
  /** Subscription display name, for the OAuth wording. */
  subscription: string;
  authType: ProviderAuthType | null;
  alert?: ProviderAuthAlert;
  t: TFn;
  style?: React.CSSProperties;
}) {
  // The "needs attention" wording names the ACCOUNT, not the connected sentence: an
  // account that is stored but refused is not meaningfully "connected", and splicing the
  // two ("… connected — needs attention") reads as a contradiction.
  const text = authType === null ? t('status.notConnected')
    : alert?.reason === 'capacity' ? t('status.usageDepleted', { label: authType === 'oauth' ? subscription : label })
    : alert ? t('status.needsAttention', { label: authType === 'oauth' ? subscription : label })
    : authType === 'oauth' ? t('status.connected', { subscription })
    : t('status.keyConfigured', { label });
  const color = authType === null ? 'var(--text-muted)'
    : alert ? 'var(--warning-text)'
    : 'rgba(34,197,94,0.9)';
  return <span style={{ fontSize: 12, fontWeight: 650, color, ...style }}>{text}</span>;
}

/**
 * THE disconnect action for one BYO provider account — the confirm wording and the removal
 * call in a single place, shared by the grid card's Disconnect button and the drawer's.
 *
 * What an operator loses differs by how the account was connected (a Pro/Max subscription
 * vs a pasted key), so the wording branches; the moment two surfaces branch on that
 * separately they start warning about different consequences for the same click.
 *
 * Resolves `false` when the operator cancels, `true` once the credential is gone, and
 * throws when removal fails so each surface reports it the way it reports its other errors.
 */
function useProviderDisconnect(t: TFn) {
  const confirm = useConfirm();
  return async (config: ProviderConfig, authType: ProviderAuthType | null): Promise<boolean> => {
    const message = authType === 'oauth'
      ? t('confirmRemoveSubscription', { subscription: config.supportsOauth ? t(`provider.${config.id}.subscription`) : config.label })
      : t('confirmRemoveKey', { label: config.label });
    if (!(await confirm({ message, destructive: true }))) return false;
    await providerKeysApi.remove(config.id);
    return true;
  };
}

/**
 * One provider's connect card. Owns its own draft/busy/connect state and decides
 * its own UI from the provider config (OAuth block only when supported). Reports
 * the resolved auth type up so the parent's status stays in one place.
 */
function ProviderConnectionCard({
  config,
  authType,
  onChange,
  onHealthChange,
  t,
}: {
  config: ProviderConfig;
  authType: ProviderAuthType | null; // null = nothing configured
  onChange: (authType: ProviderAuthType | null) => void;
  /** Report a fresh health verdict (from a probe) up so the grid repaints too. */
  onHealthChange: (alert: ProviderAuthAlert | null) => void;
  t: TFn;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [pastedCode, setPastedCode] = useState('');
  const [oauthState, setOauthState] = useState('');
  const [diagnostic, setDiagnostic] = useState<ProviderDiagnostic | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProbeVerdict | null>(null);
  const disconnect = useProviderDisconnect(t);
  const toast = useToast();

  const loadDiagnostic = () => providerKeysApi.status(config.id).then(setDiagnostic).catch((e: Error) => setError(e.message));
  useEffect(() => { void loadDiagnostic(); }, [config.id, authType]);

  const testConnection = async () => {
    setTesting(true); setTestResult(null); setError(null);
    try {
      const result = await providerKeysApi.test(config.id);
      const verdict = probeVerdict(t, result);
      setTestResult(verdict);
      // An upstream outage is a warning, not an error: the account is fine and there is
      // nothing here for the owner to fix.
      if (verdict.tone === 'error') toast.error(verdict.message, { title: t('diagnostic.failedTitle', { label: config.label }) });
      else if (verdict.tone === 'warn') toast.warning(verdict.message, { title: t('diagnostic.upstreamTitle', { label: config.label }) });
      // Repaint the whole page's health from THIS verdict — the probe just wrote (or
      // cleared) the alert server-side, so the grid behind the drawer would otherwise keep
      // showing the stale colour until its next full refresh.
      onHealthChange(result.authAlert ?? null);
      await loadDiagnostic();
    } catch (e) {
      const message = e instanceof Error ? e.message : t('diagnostic.failedGeneric');
      setTestResult({ message, tone: 'error' });
      toast.error(message, { title: t('diagnostic.failedTitle', { label: config.label }) });
    } finally { setTesting(false); }
  };

  const configured = authType !== null;
  const blurb = t(`provider.${config.id}.blurb`);
  const subscription = config.supportsOauth ? t(`provider.${config.id}.subscription`) : '';

  const saveKey = async () => {
    const apiKey = draft.trim();
    if (!apiKey) return;
    setBusy(true); setError(null);
    try {
      await providerKeysApi.set(config.id, apiKey);
      onChange('api_key');
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errSaveKey'));
    } finally {
      setBusy(false);
    }
  };

  const startConnect = async () => {
    setBusy(true); setError(null);
    try {
      const { authorizeUrl, state } = await providerKeysApi.oauthStart(config.id);
      setOauthState(state);
      window.open(authorizeUrl, '_blank', 'noopener,noreferrer');
      setConnecting(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errStartConnect'));
    } finally {
      setBusy(false);
    }
  };

  const finishConnect = async () => {
    const code = pastedCode.trim();
    if (!code) return;
    setBusy(true); setError(null);
    try {
      await providerKeysApi.oauthComplete(config.id, code, oauthState || undefined);
      onChange('oauth');
      setConnecting(false);
      setPastedCode('');
      setOauthState('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errConnectSubscription'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true); setError(null);
    try {
      if (await disconnect(config, authType)) onChange(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errRemove'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={cardStyle}>
      <div style={sectionTitle}>{config.label}</div>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>{blurb}</p>

      <div style={{ padding: 12, marginBottom: 14, borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          {/* `usable` alone would paint this green for a credential that decrypts and then
              403s on every call, so an outstanding alert downgrades it the same way it
              downgrades the chip below. */}
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: diagnostic?.authAlert ? 'var(--warning-text)' : diagnostic?.usable ? 'rgba(34,197,94,0.9)' : 'var(--text-muted)' }}>
            {t('diagnostic.currentStatus', { status: diagnostic?.status ? stateLabel(t, diagnostic.status) : t('diagnostic.checking') })}
          </span>
          <button type="button" onClick={testConnection} disabled={testing || !configured} style={{ ...buttonPrimary, opacity: testing || !configured ? 0.5 : 1 }}>
            {testing ? t('diagnostic.testing') : t('diagnostic.test')}
          </button>
        </div>
        <UsageStrip
          t={t}
          days={diagnostic?.usage.periodDays ?? 30}
          requests={diagnostic?.usage.requests ?? 0}
          tokens={diagnostic?.usage.tokens ?? 0}
          lastUsedAt={diagnostic?.usage.lastUsedAt ?? null}
        />
        <ProbeCostNote t={t} />
        {testResult && <ProbeResultLine result={testResult} t={t} />}
        {/* Dispatch-observed rejection — the reason this "connected" account is not
            actually serving anything. Sits under the status strip because that is
            where an operator already looks to answer "is this working?". */}
        {diagnostic?.authAlert && <AuthAlertNotice alert={diagnostic.authAlert} t={t} />}
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 10 }}>{t('errorPrefix', { message: error })}</div>}

      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <ProviderStatusChip
          label={config.label}
          subscription={subscription || config.label}
          authType={authType}
          {...(diagnostic?.authAlert ? { alert: diagnostic.authAlert } : {})}
          t={t}
        />
        {configured && (
          <button type="button" onClick={remove} disabled={busy} style={{ ...buttonDanger, padding: '2px 10px' }}>
            {authType === 'oauth' ? t('disconnect') : t('remove')}
          </button>
        )}
      </div>

      {/* ── Subscription connect (OAuth) — Anthropic only ─────────────────── */}
      {config.supportsOauth && (
        <>
          {!connecting ? (
            <button type="button" onClick={startConnect} disabled={busy} style={{ ...buttonPrimary, opacity: busy ? 0.5 : 1 }}>
              {busy ? t('working') : authType === 'oauth' ? t('reconnect', { subscription }) : t('connect', { subscription })}
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                {t.rich(`provider.${config.id}.pastePrompt`, { code: (chunks) => <code>{chunks}</code> })}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={pastedCode}
                  onChange={(e) => setPastedCode(e.target.value)}
                  placeholder={t(`provider.${config.id}.pastePlaceholder`)}
                  disabled={busy}
                  style={{ ...inputStyle, flex: '1 1 180px' }}
                />
                <button type="button" onClick={finishConnect} disabled={busy || !pastedCode.trim()} style={{ ...buttonPrimary, opacity: busy || !pastedCode.trim() ? 0.5 : 1, flexShrink: 0 }}>
                  {busy ? t('connecting') : t('finish')}
                </button>
                <button type="button" onClick={() => { setConnecting(false); setPastedCode(''); setOauthState(''); }} disabled={busy} style={{ ...buttonDanger, flexShrink: 0 }}>
                  {t('cancel')}
                </button>
              </div>
            </div>
          )}
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 0' }}>
            {t.rich('ownAccountNote', { b: (chunks) => <strong style={{ color: 'var(--text-primary)' }}>{chunks}</strong> })}
          </p>
          <div style={dividerRow}><div style={dividerLine} /> {t('orUseApiKey')} <div style={dividerLine} /></div>
        </>
      )}

      {/* ── API key ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={authType === 'api_key' ? t('keyPlaceholderReplace', { placeholder: config.keyPlaceholder }) : config.keyPlaceholder}
          disabled={busy}
          style={{ ...inputStyle, flex: '1 1 180px' }}
        />
        <button type="button" onClick={saveKey} disabled={busy || !draft.trim()} style={{ ...buttonPrimary, opacity: busy || !draft.trim() ? 0.5 : 1, flexShrink: 0 }}>
          {busy ? t('saving') : authType === 'api_key' ? t('replace') : t('save')}
        </button>
      </div>
    </div>
  );
}

function OpenRouterConnectionsPanel({
  connections,
  usageWindowDays,
  onChanged,
  onHealthChange,
  t,
}: {
  connections: OpenRouterConnection[];
  /** Rolling window the server measured the usage over — reported rather than assumed, so
   *  the copy can never claim a period the numbers don't cover. */
  usageWindowDays: number;
  onChanged: () => Promise<unknown>;
  /** Report a fresh health verdict (from a probe) up so the grid card repaints too. */
  onHealthChange: (connectionId: number, alert: ConnectionAuthAlert | null) => void;
  t: TFn;
}) {
  const [catalog, setCatalog] = useState<OpenRouterCatalogModel[]>([]);
  const [editing, setEditing] = useState<OpenRouterConnection | null>(null);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-connection probe state, keyed by id: a tenant may hold up to 20 registrations and
  // testing one must not blank out or block the verdict on another.
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, ProbeVerdict>>({});
  const confirm = useConfirm();
  const toast = useToast();

  useEffect(() => {
    void openRouterConnectionsApi.catalog()
      .then((result) => setCatalog(result.data ?? []))
      .catch((e: Error) => setError(e.message));
  }, []);

  const begin = (connection?: OpenRouterConnection) => {
    setEditing(connection ?? null);
    setCreating(true);
    setLabel(connection?.label ?? '');
    setSelected(connection?.models ?? []);
    setApiKey('');
    setClearKey(false);
    setSearch('');
    setError(null);
  };

  const cancel = () => {
    setCreating(false);
    setEditing(null);
    setError(null);
  };

  const toggleModel = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((model) => model !== id) : [...current, id]);
  };

  const save = async () => {
    if (!label.trim() || selected.length === 0) {
      setError(t('openRouter.validation'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        label: label.trim(),
        models: selected,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(clearKey ? { clearKey: true } : {}),
      };
      if (editing) await openRouterConnectionsApi.update(editing.id, body);
      else await openRouterConnectionsApi.create(body);
      cancel();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('openRouter.saveError'));
    } finally {
      setBusy(false);
    }
  };

  /** Probe ONE registration — the same round trip the provider cards make, so an operator
   *  can tell "registered" from "actually serving" without dispatching a real agent run. */
  const testConnection = async (connection: OpenRouterConnection) => {
    setTestingId(connection.id);
    setError(null);
    try {
      const result = await openRouterConnectionsApi.test(connection.id);
      const verdict = probeVerdict(t, result);
      setTestResults((prev) => ({ ...prev, [connection.id]: verdict }));
      if (verdict.tone === 'error') toast.error(verdict.message, { title: t('diagnostic.failedTitle', { label: connection.label }) });
      else if (verdict.tone === 'warn') toast.warning(verdict.message, { title: t('diagnostic.upstreamTitle', { label: connection.label }) });
      // Repaint from THIS verdict — the probe just wrote (or cleared) the alert server-side,
      // so the row and the grid card behind the drawer would otherwise keep showing the
      // stale colour until the next full refresh.
      onHealthChange(connection.id, result.authAlert ?? null);
    } catch (e) {
      const message = e instanceof Error ? e.message : t('diagnostic.failedGeneric');
      setTestResults((prev) => ({ ...prev, [connection.id]: { message, tone: 'error' } }));
      toast.error(message, { title: t('diagnostic.failedTitle', { label: connection.label }) });
    } finally {
      setTestingId(null);
    }
  };

  const remove = async (connection: OpenRouterConnection) => {
    if (!(await confirm(t('openRouter.confirmRemove', { label: connection.label })))) return;
    setBusy(true);
    try {
      await openRouterConnectionsApi.remove(connection.id);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('openRouter.removeError'));
    } finally {
      setBusy(false);
    }
  };

  const query = search.trim().toLowerCase();
  const visibleModels = catalog
    .filter((model) => !query || `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(query))
    .slice(0, 100);

  // One pass over the (≈400-entry) catalog per catalog change, not one linear scan per
  // selected row per render.
  const catalogNames = useMemo(() => new Map(catalog.map((model) => [model.id, model.name])), [catalog]);
  // The id is what actually routes, so it is always shown; the friendly name is a prefix
  // when we have one. A selected id absent from the catalog (retired upstream, or hand-added
  // via the API) still renders — as its bare id, which is the honest thing to show.
  const modelLabels: Record<string, string> = Object.fromEntries(
    selected.map((id) => {
      const name = catalogNames.get(id);
      return [id, name && name !== id ? `${name} · ${id}` : id];
    }),
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={sectionTitle}>{t('openRouter.title')}</div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          {t('openRouter.subtitle')}
        </p>
        <button type="button" style={buttonPrimary} onClick={() => begin()} disabled={busy}>
          {t('openRouter.add')}
        </button>
        {/* Stated once for the whole panel, above the rows each Test button sits on. */}
        <ProbeCostNote t={t} />
      </div>

      {connections.map((connection) => (
        <div key={connection.id} style={{ ...cardStyle, padding: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={sectionTitle}>{connection.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {t('openRouter.modelCount', { count: connection.models.length })}
                {' · '}
                {connection.hasKey ? t('openRouter.ownKey') : t('openRouter.managedKey')}
              </div>
              <div style={{ marginTop: 7, fontSize: 11.5, color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
                {connection.models.join(' → ')}
              </div>
              {/* Consumption sits beside health because "healthy" and "being used" are
                  different questions, and a registration that has served nothing in the
                  window is its own kind of problem. */}
              <div style={{ marginTop: 7 }}>
                <UsageStrip
                  t={t}
                  days={usageWindowDays}
                  requests={connection.usage?.requests ?? 0}
                  tokens={connection.usage?.tokens ?? 0}
                  lastUsedAt={connection.usage?.lastUsedAt ?? null}
                >
                  {/* WHOSE money, spelled out. On a keyed registration our ledger only ever
                      holds the routing surcharge — the tokens are billed by OpenRouter to
                      the tenant's own account and are visible on their dashboard, not ours.
                      Printing one number without saying which is how "$0.02" gets read as
                      the whole cost of the month. */}
                  <span style={{ display: 'block', marginTop: 3 }}>
                    {connection.hasKey
                      ? t('openRouter.costOwnKey', { cost: formatUsd(connection.usage?.costMillicents ?? 0) })
                      : t('openRouter.costManaged', { cost: formatUsd(connection.usage?.costMillicents ?? 0) })}
                  </span>
                </UsageStrip>
              </div>
              {/* The registration is stored and looks healthy, but the gateway (or the daily
                  sweep) saw it rejected — the reason this "connected" account serves nothing. */}
              {connection.authAlert && <AuthAlertNotice alert={connection.authAlert} t={t} />}
            </div>
            <button
              type="button"
              style={{ ...buttonPrimary, opacity: testingId === connection.id ? 0.5 : 1 }}
              disabled={testingId === connection.id}
              onClick={() => void testConnection(connection)}
            >
              {testingId === connection.id ? t('diagnostic.testing') : t('diagnostic.test')}
            </button>
            <button type="button" style={buttonPrimary} onClick={() => begin(connection)}>{t('openRouter.edit')}</button>
            <button type="button" style={buttonDanger} onClick={() => void remove(connection)}>{t('remove')}</button>
          </div>
          {testResults[connection.id] && <ProbeResultLine result={testResults[connection.id]!} t={t} />}
        </div>
      ))}

      {connections.length === 0 && !creating && (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t('openRouter.empty')}</div>
      )}

      {creating && (
        <div style={{ ...cardStyle, borderColor: 'var(--accent, var(--border-subtle))' }}>
          <div style={sectionTitle}>{editing ? t('openRouter.editTitle') : t('openRouter.createTitle')}</div>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
            {t('openRouter.name')}
            <input value={label} onChange={(e) => setLabel(e.target.value)} style={{ ...inputStyle, marginTop: 5 }} />
          </label>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
            {t('openRouter.apiKey')}
            <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-or-v1-…" style={{ ...inputStyle, marginTop: 5 }} />
          </label>
          {editing?.hasKey && (
            <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              <input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} />
              {t('openRouter.clearKey')}
            </label>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 12 }}>{t('openRouter.billing')}</div>

          {/* ORDER IS ROUTING, not presentation: this list is the cascade seed — position 1
              is what agents run and what Test connection probes, and the rest are the
              failover chain in order. Ticking boxes in a 400-row catalog can express WHICH
              models, never WHICH FIRST, so the selection gets its own ranked editor. */}
          {selected.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                {t('openRouter.orderTitle')}
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 8px' }}>{t('openRouter.orderHint')}</p>
              <ReorderableList
                keys={selected}
                labels={modelLabels}
                onReorder={setSelected}
                onRemove={(id) => setSelected((current) => current.filter((model) => model !== id))}
                t={t}
              />
            </div>
          )}

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('openRouter.search')}
            style={{ ...inputStyle, marginBottom: 8 }}
          />
          <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
            {visibleModels.map((model) => (
              <label key={model.id} style={{ display: 'flex', gap: 9, padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.includes(model.id)} onChange={() => toggleModel(model.id)} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{model.name}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{model.id}</span>
                </span>
              </label>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 7 }}>
            {t('openRouter.selected', { count: selected.length })}
          </div>
          {error && <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginTop: 9 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button type="button" style={buttonPrimary} disabled={busy} onClick={() => void save()}>{busy ? t('saving') : t('save')}</button>
            <button type="button" style={{ ...buttonPrimary, background: 'none' }} disabled={busy} onClick={cancel}>{t('cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProviderKeysSettings({
  search = '', viewMode = 'card', priorityOpen = false, onPriorityClose, onLeaderChange,
}: {
  search?: string;
  viewMode?: 'card' | 'table';
  priorityOpen?: boolean;
  onPriorityClose?: () => void;
  /** Display label of the account currently LEADING the BYO precedence list (null when
   *  nothing is ranked). The label — not a provider id — because the leader may be an
   *  OpenRouter connection, which has no provider id; see {@link precedenceEntryLabel}. */
  onLeaderChange?: (leaderLabel: string | null) => void;
}) {
  const t = useTranslations('providerKeys');
  const confirm = useConfirm();
  const disconnectProvider = useProviderDisconnect(t);
  const [authByProvider, setAuthByProvider] = useState<Partial<Record<LlmProvider, ProviderAuthType>>>({});
  // BYO precedence — connected providers, most-preferred first. Seeded from the backend
  // order (priority asc, unset last), then kept in sync as providers connect/disconnect.
  const [order, setOrder] = useState<string[]>([]);
  const [precedenceEntries, setPrecedenceEntries] = useState<ByoPrecedenceEntry[]>([]);
  const [openRouterConnections, setOpenRouterConnections] = useState<OpenRouterConnection[]>([]);
  // Server-reported so the usage copy states the period the numbers actually cover; the
  // 30-day default only applies before the first read lands.
  const [usageWindowDays, setUsageWindowDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeProvider, setActiveProvider] = useState<LlmProvider | null>(null);
  const [openRouterOpen, setOpenRouterOpen] = useState(false);
  const [usageByProvider, setUsageByProvider] = useState<Partial<Record<LlmProvider, { tokens: number }>>>({});
  const visibleProviders = PROVIDERS.filter((p) => !search.trim() || `${p.label} ${p.id}`.toLowerCase().includes(search.trim().toLowerCase()));

  // Rejected-account notices keyed by provider, from the LIST read — so an operator
  // sees "this account isn't being used" on the grid without having to open each
  // provider's drawer. Cleared implicitly on every refresh (a provider absent from
  // the new map has no live alert).
  const [alertByProvider, setAlertByProvider] = useState<Partial<Record<LlmProvider, ProviderAuthAlert>>>({});

  const refresh = () => {
    return providerKeysApi.list()
      .then(async (r) => {
        // The OpenRouter reads are enrichments. Keep the established provider
        // cards usable during a rolling deploy or a transient failure on either
        // new endpoint.
        const fallbackEntries: ByoPrecedenceEntry[] = r.details.map((detail) => ({
          ref: detail.provider,
          kind: 'provider',
          provider: detail.provider,
          priority: detail.priority,
        }));
        const [connectionResult, precedenceResult] = await Promise.all([
          openRouterConnectionsApi.list().catch(() => ({ connections: [], usageWindowDays: undefined })),
          openRouterConnectionsApi.precedence().catch(() => ({ entries: fallbackEntries })),
        ]);
        const map: Partial<Record<LlmProvider, ProviderAuthType>> = {};
        const alerts: Partial<Record<LlmProvider, ProviderAuthAlert>> = {};
        for (const d of r.details) {
          map[d.provider] = d.authType;
          if (d.authAlert) alerts[d.provider] = d.authAlert;
        }
        setUsageByProvider(Object.fromEntries(
          r.details.map((d) => [d.provider, { tokens: d.usage?.tokens ?? 0 }]),
        ));
        if (r.usageWindowDays) setUsageWindowDays(r.usageWindowDays);
        setAuthByProvider(map);
        setAlertByProvider(alerts);
        setOpenRouterConnections(connectionResult.connections);
        if (connectionResult.usageWindowDays) setUsageWindowDays(connectionResult.usageWindowDays);
        setPrecedenceEntries(precedenceResult.entries);
        const refs = precedenceResult.entries.map((entry) => entry.ref);
        setOrder(refs);
        onLeaderChange?.(precedenceLeaderLabel(precedenceResult.entries, refs));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { void refresh(); }, []);

  // Reflect a connect/disconnect in the precedence list: append a newly-connected
  // provider to the tail (lowest precedence until reordered), drop a removed one.
  const syncOrder = (provider: LlmProvider, authType: ProviderAuthType | null) =>
    setOrder((prev) =>
      authType === null ? prev.filter((p) => p !== provider)
      : prev.includes(provider) ? prev
      : [...prev, provider],
    );

  const persistOrder = async (next: string[]) => {
    setOrder(next); // optimistic
    onLeaderChange?.(precedenceLeaderLabel(precedenceEntries, next));
    try {
      await providerKeysApi.setPriority(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('precedence.errSave'));
    }
  };

  /** Apply a fresh probe verdict to ONE registration. The connections array stays the single
   *  source for both the drawer rows and the grid card, so they cannot disagree about which
   *  registrations need attention. */
  const applyConnectionAlert = (connectionId: number, alert: ConnectionAuthAlert | null) =>
    setOpenRouterConnections((prev) => prev.map((connection) => {
      if (connection.id !== connectionId) return connection;
      if (alert) return { ...connection, authAlert: alert };
      const { authAlert: _cleared, ...healthy } = connection;
      return healthy;
    }));

  /**
   * Reflect a connect/disconnect for ONE provider across everything this page derives from
   * it: the auth map, its (now stale) alert, and its place in the precedence list. Shared by
   * the drawer and the card's Disconnect button — a second copy is how the grid ends up
   * still warning about an account that was just removed.
   */
  const applyAuthChange = (provider: LlmProvider, authType: ProviderAuthType | null) => {
    setAuthByProvider((prev) => { const next = { ...prev }; if (authType === null) delete next[provider]; else next[provider] = authType; return next; });
    // A reconnect/removal clears the server-side alert, so drop the local one too rather
    // than leaving the card warning about work just done.
    setAlertByProvider((prev) => { const next = { ...prev }; delete next[provider]; return next; });
    syncOrder(provider, authType);
    const nextOrder = authType === null ? order.filter((id) => id !== provider)
      : order.includes(provider) ? order
      : [...order, provider];
    onLeaderChange?.(precedenceLeaderLabel(precedenceEntries, nextOrder));
  };

  /** Disconnect OpenRouter as a whole — the card states ONE connected/not-connected fact for
   *  the registration set, so its Disconnect must clear the set. Per-registration removal
   *  stays in the drawer, where each one is named. */
  const disconnectOpenRouter = async () => {
    if (!(await confirm({ message: t('openRouter.confirmDisconnectAll', { count: openRouterConnections.length }), destructive: true }))) return;
    await Promise.all(openRouterConnections.map((connection) => openRouterConnectionsApi.remove(connection.id)));
    await refresh();
  };

  const brokenConnections = openRouterConnections.filter((connection) => connection.authAlert).length;

  const precedenceLabels: Record<string, string> = Object.fromEntries(
    precedenceEntries.map((entry) => [entry.ref, precedenceEntryLabel(entry)]),
  );

  return (
    <div>
      <div style={{ ...sectionTitle, fontSize: 15, marginBottom: 4 }}>{t('title')}</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px' }}>{t('subtitle')}</p>

      {error && <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 10 }}>{t('errorPrefix', { message: error })}</div>}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
      ) : (
        <>
          <div style={viewMode === 'card' ? wrapStyle : { display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(!search.trim() || 'openrouter models routing'.includes(search.trim().toLowerCase())) && (
              <ClickableCard ariaLabel="OpenRouter" onClick={() => setOpenRouterOpen(true)} style={{ ...cardStyle, cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: viewMode === 'table' ? 'row' : 'column', alignItems: viewMode === 'table' ? 'center' : 'stretch', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={sectionTitle}>OpenRouter</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t('openRouter.cardBlurb')}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {/* Registered ≠ working: a registration whose key was revoked or ran out of
                      credit still stores and still lists, so a count alone would paint this
                      green forever. A live alert downgrades it exactly as it does a provider. */}
                  <span style={{
                    flex: 1, minWidth: 0,
                    fontSize: 12, fontWeight: 650, whiteSpace: 'normal',
                    color: brokenConnections ? 'var(--warning-text)'
                      : openRouterConnections.length ? 'rgba(34,197,94,0.9)'
                      : 'var(--text-muted)',
                  }}>
                    {brokenConnections
                      ? t('status.needsAttention', { label: t('openRouter.brokenCount', { count: brokenConnections }) })
                      : openRouterConnections.length
                        ? t('openRouter.connectedCount', { count: openRouterConnections.length })
                        : t('status.notConnected')}
                  </span>
                  <ConnectToggleButton
                    connected={openRouterConnections.length > 0}
                    name="OpenRouter"
                    onConnect={() => setOpenRouterOpen(true)}
                    onDisconnect={disconnectOpenRouter}
                  />
                </div>
              </ClickableCard>
            )}
            {visibleProviders.map((p) => (
              <ClickableCard key={p.id} ariaLabel={p.label} onClick={() => setActiveProvider(p.id)} style={{ ...cardStyle, cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: viewMode === 'table' ? 'row' : 'column', alignItems: viewMode === 'table' ? 'center' : 'stretch', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1, minWidth: 0 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={sectionTitle}>{p.label}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t(`provider.${p.id}.blurb`)}</div>
                    {/* Surfaced on the grid, not only in the drawer: an account that is
                        connected-but-rejected looks identical to a healthy one here, and
                        an operator who never opens the drawer would never find out. */}
                    {alertByProvider[p.id] && <AuthAlertNotice alert={alertByProvider[p.id]!} t={t} />}
                  </div>
                  {usageByProvider[p.id] && (
                    <ConsumptionMeterCard
                      meter={{
                        key: 'ai_tokens', unit: 'tokens',
                        used: usageByProvider[p.id]?.tokens ?? 0,
                        limit: -1, unlimited: true, remaining: -1, percentUsed: 0,
                      }}
                      isFree={false}
                      title={t('diagnostic.builderforceTokens')}
                      usageOnly
                      periodLabel={t('diagnostic.periodLabel', { period: `${usageWindowDays} days` })}
                    />
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <ProviderStatusChip
                    label={p.label}
                    subscription={p.supportsOauth ? t(`provider.${p.id}.subscription`) : p.label}
                    authType={authByProvider[p.id] ?? null}
                    {...(alertByProvider[p.id] ? { alert: alertByProvider[p.id]! } : {})}
                    t={t}
                    style={{ flex: 1, minWidth: 0, whiteSpace: 'normal' }}
                  />
                  <ConnectToggleButton
                    connected={authByProvider[p.id] != null}
                    name={p.label}
                    onConnect={() => setActiveProvider(p.id)}
                    onDisconnect={async () => {
                      if (await disconnectProvider(p, authByProvider[p.id] ?? null)) applyAuthChange(p.id, null);
                    }}
                  />
                </div>
              </ClickableCard>
            ))}
          </div>

          {activeProvider && (() => {
            const p = PROVIDERS.find((item) => item.id === activeProvider)!;
            return (
              <SlideOutPanel open onClose={() => setActiveProvider(null)} title={p.label}>
                <div style={{ padding: 20 }}>
                  <ProviderConnectionCard
                    config={p}
                    authType={authByProvider[p.id] ?? null}
                    t={t}
                    onHealthChange={(alert) => setAlertByProvider((prev) => {
                      const next = { ...prev };
                      if (alert) next[p.id] = alert; else delete next[p.id];
                      return next;
                    })}
                    onChange={(authType) => applyAuthChange(p.id, authType)}
                  />
                </div>
              </SlideOutPanel>
            );
          })()}

          <SlideOutPanel open={openRouterOpen} onClose={() => setOpenRouterOpen(false)} title="OpenRouter">
            <div style={{ padding: 20 }}>
              <OpenRouterConnectionsPanel
                connections={openRouterConnections}
                usageWindowDays={usageWindowDays}
                t={t}
                onChanged={refresh}
                onHealthChange={applyConnectionAlert}
              />
            </div>
          </SlideOutPanel>

          <SlideOutPanel open={priorityOpen} onClose={() => onPriorityClose?.()} title={t('precedence.title')}>
            <div style={{ padding: 20 }}>
              <PrecedencePanel order={order} labels={precedenceLabels} onReorder={persistOrder} t={t} />
            </div>
          </SlideOutPanel>
        </>
      )}
    </div>
  );
}
