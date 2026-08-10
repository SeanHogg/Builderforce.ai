'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  HANDLER_METHODS,
  HANDLER_VERIFY_KINDS,
  projectBackendApi,
  type HandlerMethod,
  type HandlerSpecDocument,
  type HandlerVerifyKind,
} from '@/lib/builderforceApi';

/**
 * Author one handler without leaving the browser.
 *
 * ── WHY A HYBRID FORM RATHER THAN A FULL BUILDER ────────────────────────────
 * The fields with real consequences — the route, the method, and above all the
 * VERIFICATION KIND — get proper controls, because those are the ones a person
 * gets wrong in a way that is expensive: an unverified public endpoint lets
 * anyone forge a customer and spend the account's balance. The step list stays
 * JSON because a step graph is genuinely structured data and a half-built visual
 * editor for it would be a worse tool than a textarea with a real validator
 * behind it.
 *
 * ── THE VALIDATOR IS THE SERVER'S ───────────────────────────────────────────
 * Nothing is validated twice. The document is posted and the api parses it with
 * the SAME parser the ingress uses, so "it saved" and "it will serve" are the
 * same condition — and the error shown here is the error the runtime would have
 * produced. A client-side copy of those rules would drift and start disagreeing
 * with the thing that actually runs.
 */

const SKELETON: HandlerSpecDocument = {
  route: '/hello',
  method: 'POST',
  verify: 'none',
  description: '',
  steps: [],
  respond: { kind: 'json', body: { ok: true } },
};

const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 20,
};

const label: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 6,
};

const field: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  padding: '8px 10px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated, transparent)',
  color: 'var(--text-primary)',
  fontSize: 14,
};

/** Native <option> needs its own opaque colours or it is unreadable on some
 *  platforms where the popup does not inherit the control's theme. */
const option: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
};

const button: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-subtle)',
  background: 'transparent',
  color: 'var(--text-primary)',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};

const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12.5,
  lineHeight: 1.5,
};

/** Origins are typed one per line or comma-separated — whichever a person
 *  reaches for. Validation stays on the server, like every other field here. */
function parseOrigins(text: string): string[] {
  const seen: string[] = [];
  for (const part of text.split(/[\n,]/)) {
    const value = part.trim();
    if (value && !seen.includes(value)) seen.push(value);
  }
  return seen;
}

export interface HandlerEditorProps {
  projectId: number;
  /** Existing handler name, or null to create a new one. */
  name: string | null;
  spec: HandlerSpecDocument | null;
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
}

export default function HandlerEditor({ projectId, name, spec, onSaved, onCancel }: HandlerEditorProps) {
  const t = useTranslations('challenges.backend');
  const isNew = name === null;
  const source = spec ?? SKELETON;

  const [handlerName, setHandlerName] = useState(name ?? '');
  const [route, setRoute] = useState(source.route);
  const [method, setMethod] = useState<HandlerMethod>(source.method);
  const [verify, setVerify] = useState<HandlerVerifyKind>(source.verify);
  const [verifySecret, setVerifySecret] = useState(source.verifySecret ?? '');
  const [corsText, setCorsText] = useState((source.cors ?? []).join('\n'));
  const [description, setDescription] = useState(source.description ?? '');
  const [stepsText, setStepsText] = useState(JSON.stringify(source.steps ?? [], null, 2));
  const [respondText, setRespondText] = useState(JSON.stringify(source.respond ?? {}, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (busy) return;
    setError(null);

    // JSON syntax is the ONE thing checked here, because the server cannot report
    // it usefully — an unparseable body never reaches the handler parser at all.
    let steps: unknown;
    let respond: unknown;
    try {
      steps = JSON.parse(stepsText);
      respond = JSON.parse(respondText);
    } catch (e) {
      setError(`${t('invalidJson')} ${e instanceof Error ? e.message : ''}`.trim());
      return;
    }
    if (!Array.isArray(steps)) {
      setError(t('stepsMustBeArray'));
      return;
    }

    const cors = parseOrigins(corsText);

    setBusy(true);
    try {
      await projectBackendApi.saveHandler(projectId, (handlerName || route.replace(/^\//, '')).trim(), {
        name: handlerName.trim() || undefined,
        route,
        method,
        verify,
        // Carried explicitly. The editor rebuilds the whole document from these
        // fields, so a value it does not render is a value it silently deletes —
        // and deleting this one repoints a Stripe endpoint at the wrong secret.
        ...(verify !== 'none' && verifySecret.trim() ? { verifySecret: verifySecret.trim().toUpperCase() } : {}),
        // Omitted when empty rather than sent as `[]`: the api rejects an empty
        // list, because "CORS is configured" and "no origin may call this" must
        // not be the same document.
        ...(cors.length ? { cors } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        steps,
        respond,
      });
      await onSaved();
    } catch (e) {
      // This is the api's parser talking — the same one the ingress uses.
      setError(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ ...card, display: 'grid', gap: 14 }}>
      <div style={label}>{isNew ? t('newHandler') : t('editHandler', { name: name ?? '' })}</div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ flex: '1 1 160px', minWidth: 0 }}>
          <div style={label}>{t('handlerName')}</div>
          <input
            value={handlerName}
            onChange={(e) => setHandlerName(e.target.value)}
            disabled={!isNew}
            placeholder="inbound-sms"
            aria-label={t('handlerName')}
            style={{ ...field, opacity: isNew ? 1 : 0.6 }}
          />
        </div>

        <div style={{ flex: '2 1 200px', minWidth: 0 }}>
          <div style={label}>{t('handlerRoute')}</div>
          <input
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            placeholder="/sms"
            aria-label={t('handlerRoute')}
            style={field}
          />
        </div>

        <div style={{ flex: '0 1 130px', minWidth: 0 }}>
          <div style={label}>{t('handlerMethod')}</div>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as HandlerMethod)}
            aria-label={t('handlerMethod')}
            style={field}
          >
            {HANDLER_METHODS.map((m) => (
              <option key={m} value={m} style={option}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: '1 1 170px', minWidth: 0 }}>
          <div style={label}>{t('handlerVerify')}</div>
          <select
            value={verify}
            onChange={(e) => setVerify(e.target.value as HandlerVerifyKind)}
            aria-label={t('handlerVerify')}
            style={field}
          >
            {HANDLER_VERIFY_KINDS.map((v) => (
              <option key={v} value={v} style={option}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Providers that issue a signing secret PER ENDPOINT (Stripe) need each
          handler to name its own; leaving it blank uses the kind's default, which
          is right for the per-account providers. */}
      {verify !== 'none' && (
        <div>
          <div style={label}>{t('handlerVerifySecret')}</div>
          <input
            value={verifySecret}
            onChange={(e) => setVerifySecret(e.target.value)}
            placeholder={t('handlerVerifySecretPlaceholder')}
            aria-label={t('handlerVerifySecret')}
            style={field}
          />
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 }}>
            {t('verifySecretHelp')}
          </div>
        </div>
      )}

      {/* The one warning worth interrupting for: this endpoint is about to be
          callable by anyone who learns the URL. */}
      {verify === 'none' && (
        <div style={{ fontSize: 13, color: 'var(--warning)', lineHeight: 1.5 }}>
          {t('verifyNoneWarning')}
        </div>
      )}

      {/* Cross-origin access sits with the other consequential fields, not in the
          JSON: a handler spends connector credentials and model tokens, so who
          may call it from a browser is a decision, not a detail. */}
      <div>
        <div style={label}>{t('handlerCors')}</div>
        <textarea
          value={corsText}
          onChange={(e) => setCorsText(e.target.value)}
          rows={2}
          spellCheck={false}
          placeholder={t('handlerCorsPlaceholder')}
          aria-label={t('handlerCors')}
          style={{ ...field, ...mono, resize: 'vertical' }}
        />
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 }}>
          {t('corsHelp')}
        </div>
        {parseOrigins(corsText).includes('*') && (
          <div style={{ fontSize: 13, color: 'var(--warning)', marginTop: 6, lineHeight: 1.5 }}>
            {t('corsWildcardWarning')}
          </div>
        )}
      </div>

      <div>
        <div style={label}>{t('handlerDescription')}</div>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label={t('handlerDescription')}
          style={field}
        />
      </div>

      <div>
        <div style={label}>{t('handlerSteps')}</div>
        <textarea
          value={stepsText}
          onChange={(e) => setStepsText(e.target.value)}
          rows={10}
          spellCheck={false}
          aria-label={t('handlerSteps')}
          style={{ ...field, ...mono, resize: 'vertical' }}
        />
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 }}>
          {t('stepsHelp')}
        </div>
      </div>

      <div>
        <div style={label}>{t('handlerRespond')}</div>
        <textarea
          value={respondText}
          onChange={(e) => setRespondText(e.target.value)}
          rows={6}
          spellCheck={false}
          aria-label={t('handlerRespond')}
          style={{ ...field, ...mono, resize: 'vertical' }}
        />
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 }}>
          {t('respondHelp')}
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 13, color: 'var(--danger)', lineHeight: 1.5 }}>{error}</div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !route.trim()}
          style={{ ...button, opacity: busy || !route.trim() ? 0.6 : 1 }}
        >
          {busy ? t('saving') : t('saveHandler')}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} style={button}>
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}
