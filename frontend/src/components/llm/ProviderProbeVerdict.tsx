'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ToastProvider';
import { CopyButton } from '@/components/CopyButton';
import { buttonPrimary } from '@/components/llm/providerKeysStyles';
import type { ProbeDiagnostic, ProviderDiagnostic } from '@/lib/builderforceApi';

/**
 * "Is this connected account actually working?" — the probe verdict, its copyable trace,
 * and the health header, for every BYO surface (provider cards, the self-hosted Ollama
 * card, OpenRouter registrations).
 *
 * Lives on its own because all three surfaces run the same server probe and must read a
 * verdict identically: the moment one formats its own message, identical failures get
 * explained differently. `useProbeRunner` owns the run → verdict → toast sequence those
 * surfaces used to repeat verbatim.
 */

/** The `providerKeys` namespace translator every consumer already holds. */
export type ProbeT = ReturnType<typeof useTranslations>;

/** How loudly a verdict should read. `warn` is the case that matters: the credential is
 *  fine and something else stopped the call, which must not be painted as a failed
 *  connection — red there sends an owner to re-enter a key that is fine. */
type ProbeTone = 'ok' | 'warn' | 'error';

export interface ProbeVerdict {
  message: string;
  tone: ProbeTone;
  /** Redacted upstream evidence, when the probe reached a response. Rides the verdict so
   *  EVERY surface gets the copy affordance from the one seam — see {@link ProbeResultLine}. */
  diagnostic?: ProbeDiagnostic;
}

/** The fields of a probe response the verdict reads — shared by provider and connection tests. */
interface ProbeResult {
  ok: boolean;
  status: string;
  model?: string;
  limitedModels?: string[];
  error?: string;
  diagnostic?: ProbeDiagnostic;
}

/**
 * Statuses that are NOT a verdict against the credential, so they read amber:
 *   • `upstream_error` — the key WORKED and the model provider broke;
 *   • `local_egress_required` — the key was never presented (no runtime of the owner's own);
 *   • `capacity` — the account's usage window or budget is spent; the key is valid and
 *     replacing it cannot help (a Qwen Token Plan 429, xAI's weekly SuperGrok limit).
 */
const WARN_STATUSES: ReadonlySet<string> = new Set(['upstream_error', 'local_egress_required', 'capacity']);

/** Localized label for a probe/diagnostic status id; an id with no copy degrades to the
 *  humanized raw value rather than rendering a bare key. */
export function stateLabel(t: ProbeT, status: string): string {
  const label = t(`diagnostic.state.${status}`);
  return label === `diagnostic.state.${status}` ? status.replaceAll('_', ' ') : label;
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
export function formatDiagnosticTrace(d: ProbeDiagnostic): string {
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
    // The provider's own words — what separates "your plan's window is spent" from a
    // gateway throttle when both are a 429 with the same headers.
    ...(d.providerMessage ? [`provider-msg:  ${d.providerMessage}`] : []),
    'response-headers:',
    ...(headers.length > 0
      ? headers.map(([name, value]) => `  ${name}: ${value}`)
      : ['  (none of the correlation headers were present)']),
    'No credential, prompt, or request body is included.',
  ].join('\n');
}

/** Probe verdict → the one line an operator reads. */
export function probeVerdict(t: ProbeT, result: ProbeResult): ProbeVerdict {
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
    tone: WARN_STATUSES.has(result.status) ? 'warn' : 'error',
    // Server responses carry machine status codes; compose all operator-facing prose
    // here so every supported locale sees the same diagnostic contract.
    message: t('diagnostic.failedFallback', { status: stateLabel(t, result.status) }),
    ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
  };
}

/**
 * Run ONE probe and announce its verdict — the sequence every Test button shares.
 *
 * Returns the verdict for the inline line and the raw result (null when the request itself
 * failed) so the caller can repaint its own health from THIS answer. The toast title names
 * the status, so a spent usage window reads "Qwen — usage depleted", never "model provider
 * error".
 */
export function useProbeRunner(t: ProbeT) {
  const toast = useToast();
  return useCallback(async <R extends ProbeResult>(
    label: string,
    probe: () => Promise<R>,
  ): Promise<{ verdict: ProbeVerdict; result: R | null }> => {
    try {
      const result = await probe();
      const verdict = probeVerdict(t, result);
      if (verdict.tone === 'error') toast.error(verdict.message, { title: t('diagnostic.failedTitle', { label }) });
      else if (verdict.tone === 'warn') {
        toast.warning(verdict.message, { title: t('diagnostic.statusTitle', { label, status: stateLabel(t, result.status) }) });
      }
      return { verdict, result };
    } catch (e) {
      const message = e instanceof Error ? e.message : t('diagnostic.failedGeneric');
      toast.error(message, { title: t('diagnostic.failedTitle', { label }) });
      return { verdict: { message, tone: 'error' }, result: null };
    }
  }, [t, toast]);
}

/**
 * The remedy for `local_egress_required` — decides its OWN visibility off the status.
 *
 * The state label alone ("needs a runtime of your own") told an operator WHAT was missing
 * and nothing about what a runtime is or where to connect one. This is the one line that
 * turns the verdict into an action: the Agents page is where a Builderforce runtime is
 * installed and paired, and the credential itself is fine.
 */
function LocalEgressRemedy({ status, t }: { status: string | undefined; t: ProbeT }) {
  if (status !== 'local_egress_required') return null;
  return (
    <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
      {t('diagnostic.localEgressRemedy')}{' '}
      <Link href="/agents" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'underline' }}>
        {t('diagnostic.localEgressRemedyLink')}
      </Link>
    </div>
  );
}

/**
 * How loudly the status READ should paint — ONE rule for every provider card.
 *
 * `usable` alone painted this green for a credential that decrypts and then 403s on every
 * call, and green again for a Kimi subscription with no runtime online. Both are amber: the
 * credential is not the thing to fix, but the account is not serving anything either.
 */
function healthTone(diagnostic: ProviderDiagnostic | null): ProbeTone | 'muted' {
  if (!diagnostic) return 'muted';
  if (diagnostic.authAlert || diagnostic.status === 'local_egress_required') return 'warn';
  return diagnostic.usable ? 'ok' : 'muted';
}

/**
 * "Current status: …" plus the Test button — the header of every provider drawer's health
 * box. Shared so the provider card and the self-hosted Ollama card cannot drift in colour,
 * copy, or the remedy they offer; the remedy renders itself only for the status that has one.
 */
export function ProviderHealthHeader({
  diagnostic, configured, testing, onTest, t,
}: {
  diagnostic: ProviderDiagnostic | null;
  configured: boolean;
  testing: boolean;
  onTest: () => void;
  t: ProbeT;
}) {
  const tone = healthTone(diagnostic);
  const color = tone === 'warn' ? 'var(--warning-text)' : tone === 'ok' ? 'var(--success-text)' : 'var(--text-muted)';
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--font-size-small)', fontWeight: 700, color }}>
          {t('diagnostic.currentStatus', { status: diagnostic?.status ? stateLabel(t, diagnostic.status) : t('diagnostic.checking') })}
        </span>
        <button type="button" onClick={onTest} disabled={testing || !configured} style={{ ...buttonPrimary, opacity: testing || !configured ? 0.5 : 1 }}>
          {testing ? t('diagnostic.testing') : t('diagnostic.test')}
        </button>
      </div>
      <LocalEgressRemedy status={diagnostic?.status} t={t} />
    </div>
  );
}

/**
 * The verdict line under a Test button — same colour rules and a11y role wherever a probe
 * reports back. Amber when the credential is not the problem, red only for something the
 * owner must fix.
 *
 * When the probe reached a response it also shows the provider's own message and offers the
 * redacted trace, because "tell me what happened" and "give me something I can send the
 * provider" are different asks. Both decide their OWN visibility off the diagnostic.
 */
export function ProbeResultLine({ result, t }: { result: ProbeVerdict; t: ProbeT }) {
  const color = result.tone === 'ok' ? 'var(--success-text)'
    : result.tone === 'warn' ? 'var(--warning-text)'
    : 'var(--error)';
  const { diagnostic } = result;
  return (
    <div
      role={result.tone === 'error' ? 'alert' : 'status'}
      style={{ fontSize: 'var(--font-size-eyebrow)', color, marginTop: 7, lineHeight: 1.5 }}
    >
      {result.message}
      {diagnostic?.providerMessage && (
        // The provider's text is data in the provider's language, shown verbatim; only the
        // label around it is localized. `anywhere` keeps a long unbroken id from forcing a
        // horizontal scroll at 360px.
        <div style={{ color: 'var(--text-muted)', marginTop: 4, overflowWrap: 'anywhere' }}>
          {t('diagnostic.providerSaid', { message: diagnostic.providerMessage })}
        </div>
      )}
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
          <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>
            {diagnostic.edgeBlocked
              ? t('diagnostic.traceEdgeBlocked', { status: diagnostic.status })
              : t('diagnostic.traceHint', { status: diagnostic.status })}
          </span>
        </div>
      )}
    </div>
  );
}
