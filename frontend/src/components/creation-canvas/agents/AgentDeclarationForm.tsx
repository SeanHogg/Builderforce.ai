import { useTranslations } from 'next-intl';
import {
  AGENT_DRAFT_TRIGGER_KINDS,
  type AgentDraft,
  type AgentDraftRoleKind,
  type AgentDraftTrigger,
  type AgentDraftTriggerKind,
} from '@builderforce/creation-canvas-contract';
import { Select } from '@/components/Select';
import {
  agentDraftGaps,
  agentDraftPreview,
  agentDraftSendable,
  type AgentDeclarationRefusal,
} from '@/lib/canvas/appAgentDeclaration';
import { AGENT_BUDGET_KEYS, manifestAgentDeclarationRows, type AgentBudgetKey } from '@/lib/canvas/manifestAgents';
import { btnPrimary, btnSubtle, inputStyle, labelStyle } from '@/components/workforce/CloudAgentFormFields';

/**
 * DEFINE AN AGENT WITHOUT CODE — the field set behind "a feature in the app" (W12).
 *
 * Controlled and state-free, the way `CloudAgentFormFields` is: the container
 * (`AgentDeclarationPanel`) owns the form value, loads the tool options and submits.
 * This draws the fields and reports edits, nothing more.
 *
 * There is deliberately NO model field. A declaration names a role or a workload and the
 * host's router picks the model; a model id typed into the role is refused by the
 * runtime's validator (`agent-model-id`), which is where that rule lives.
 *
 * The tool list comes in as `toolOptions` — the catalogs the caller may run — and is never
 * spelled out here. Validation is never done here either: the server merges the draft into
 * the manifest, runs the runtime's validator and hands its typed issues back as `refusal`.
 * What the form says before sending (`agentDraftGaps`) is a hint for the reader, decided in
 * `appAgentDeclaration`, and the preview is the draft read the way the room will read it.
 */

/** One trigger as its inputs hold it: every field kept, so switching kind loses nothing typed. */
export interface AgentFormTrigger {
  kind: AgentDraftTriggerKind;
  cron: string;
  timezone: string;
  service: string;
  event: string;
}

export interface AgentFormState {
  id: string;
  roleKind: AgentDraftRoleKind;
  roleKey: string;
  instructionsPath: string;
  tools: string[];
  triggers: AgentFormTrigger[];
  /** As typed; blank is "no limit". */
  budget: Record<AgentBudgetKey, string>;
}

const ROLE_KINDS: readonly AgentDraftRoleKind[] = ['role', 'workload'];

export const EMPTY_AGENT_TRIGGER: AgentFormTrigger = { kind: 'manual', cron: '', timezone: '', service: '', event: '' };

export const EMPTY_AGENT_FORM: AgentFormState = {
  id: '',
  roleKind: 'role',
  roleKey: '',
  instructionsPath: '',
  tools: [],
  triggers: [],
  budget: Object.fromEntries(AGENT_BUDGET_KEYS.map((key) => [key, ''])) as Record<AgentBudgetKey, string>,
};

function toDraftTrigger(trigger: AgentFormTrigger): AgentDraftTrigger {
  switch (trigger.kind) {
    case 'manual':
      return { kind: 'manual' };
    case 'cron':
      return { kind: 'cron', cron: trigger.cron, ...(trigger.timezone.trim() ? { timezone: trigger.timezone } : {}) };
    case 'service':
      return { kind: 'service', service: trigger.service, event: trigger.event };
  }
}

/** The draft a filled form stands for. Numbers are read as typed; the validator judges them. */
export function agentFormToDraft(form: AgentFormState): AgentDraft {
  return {
    id: form.id.trim(),
    role: { kind: form.roleKind, key: form.roleKey },
    instructionsPath: form.instructionsPath,
    tools: form.tools,
    triggers: form.triggers.map(toDraftTrigger),
    budget: Object.fromEntries(AGENT_BUDGET_KEYS.flatMap((key) =>
      form.budget[key].trim() ? [[key, Number(form.budget[key])]] : [])),
  };
}

export interface AgentDeclarationFormProps {
  form: AgentFormState;
  onChange: (patch: Partial<AgentFormState>) => void;
  /** The tool keys the caller may grant; null while they load. */
  toolOptions: readonly string[] | null;
  submitting: boolean;
  refusal: AgentDeclarationRefusal | null;
  onSubmit: () => void;
  onCancel: () => void;
}

const stack = { display: 'flex', flexDirection: 'column', gap: 14 } as const;
const help = { fontSize: 'var(--font-size-eyebrow)', color: 'var(--muted)', margin: '6px 0 0' } as const;
const row = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } as const;

export function AgentDeclarationForm({ form, onChange, toolOptions, submitting, refusal, onSubmit, onCancel }: AgentDeclarationFormProps) {
  const t = useTranslations('agentForm');
  const setTrigger = (index: number, patch: Partial<AgentFormTrigger>) =>
    onChange({ triggers: form.triggers.map((trigger, at) => (at === index ? { ...trigger, ...patch } : trigger)) });
  const toggleTool = (tool: string) =>
    onChange({ tools: form.tools.includes(tool) ? form.tools.filter((entry) => entry !== tool) : [...form.tools, tool] });
  const draft = agentFormToDraft(form);
  const gaps = agentDraftGaps(draft, toolOptions);
  const previewRows = manifestAgentDeclarationRows(agentDraftPreview(draft), t('noRole'));

  return (
    <form
      style={stack}
      data-testid="agent-declaration-form"
      onSubmit={(event) => { event.preventDefault(); onSubmit(); }}
    >
      <div>
        <label style={labelStyle} htmlFor="agent-form-id">{t('id')}</label>
        <input id="agent-form-id" style={inputStyle} value={form.id} onChange={(e) => onChange({ id: e.target.value })} placeholder={t('idPlaceholder')} autoFocus />
      </div>

      <div>
        <label style={labelStyle} htmlFor="agent-form-role">{t('role')}</label>
        <div style={row}>
          <Select aria-label={t('roleKind')} style={{ ...inputStyle, width: 'auto' }} value={form.roleKind} onChange={(e) => onChange({ roleKind: e.target.value as AgentDraftRoleKind })}>
            {ROLE_KINDS.map((kind) => <option key={kind} value={kind}>{t(`roleKindOption.${kind}`)}</option>)}
          </Select>
          <input id="agent-form-role" style={{ ...inputStyle, flex: 1, width: 'auto' }} value={form.roleKey} onChange={(e) => onChange({ roleKey: e.target.value })} placeholder={t('rolePlaceholder')} />
        </div>
        <p style={help}>{t('roleHelp')}</p>
        {gaps.missingRole && <p role="status" data-testid="agent-form-clarify-role" style={{ ...help, color: 'var(--text-strong)' }}>{t('clarifyRole')}</p>}
      </div>

      <div>
        <label style={labelStyle} htmlFor="agent-form-instructions">{t('instructions')}</label>
        <input id="agent-form-instructions" style={inputStyle} value={form.instructionsPath} onChange={(e) => onChange({ instructionsPath: e.target.value })} placeholder={t('instructionsPlaceholder')} />
      </div>

      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend style={labelStyle}>{t('tools')}</legend>
        {toolOptions === null
          ? <p style={help}>{t('toolsLoading')}</p>
          : toolOptions.length === 0
            ? <p style={help}>{t('toolsEmpty')}</p>
            : (
              <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {toolOptions.map((tool) => (
                  <label key={tool} style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-strong)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={form.tools.includes(tool)} onChange={() => toggleTool(tool)} />
                    <code>{tool}</code>
                  </label>
                ))}
              </div>
            )}
        {gaps.unknownTools.length > 0 && (
          <ul role="status" data-testid="agent-form-unknown-tools" style={{ ...help, color: 'var(--text-strong)', paddingLeft: 18 }}>
            {gaps.unknownTools.map((tool) => <li key={tool}>{t('unknownTool', { tool })}</li>)}
          </ul>
        )}
        <p style={help}>{t('toolsHelp')}</p>
      </fieldset>

      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend style={labelStyle}>{t('triggers')}</legend>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {form.triggers.map((trigger, index) => (
            <div key={index} style={row} data-testid={`agent-form-trigger-${index}`}>
              <Select aria-label={t('triggerKind')} style={{ ...inputStyle, width: 'auto' }} value={trigger.kind} onChange={(e) => setTrigger(index, { kind: e.target.value as AgentDraftTriggerKind })}>
                {AGENT_DRAFT_TRIGGER_KINDS.map((kind) => <option key={kind} value={kind}>{t(`trigger.${kind}`)}</option>)}
              </Select>
              {trigger.kind === 'cron' && <>
                <input aria-label={t('cron')} style={{ ...inputStyle, width: 140 }} value={trigger.cron} onChange={(e) => setTrigger(index, { cron: e.target.value })} placeholder={t('cronPlaceholder')} />
                <input aria-label={t('timezone')} style={{ ...inputStyle, width: 160 }} value={trigger.timezone} onChange={(e) => setTrigger(index, { timezone: e.target.value })} placeholder={t('timezonePlaceholder')} />
              </>}
              {trigger.kind === 'service' && <>
                <input aria-label={t('service')} style={{ ...inputStyle, width: 140 }} value={trigger.service} onChange={(e) => setTrigger(index, { service: e.target.value })} placeholder={t('servicePlaceholder')} />
                <input aria-label={t('event')} style={{ ...inputStyle, width: 140 }} value={trigger.event} onChange={(e) => setTrigger(index, { event: e.target.value })} placeholder={t('eventPlaceholder')} />
              </>}
              <button type="button" style={btnSubtle} onClick={() => onChange({ triggers: form.triggers.filter((_, at) => at !== index) })}>{t('removeTrigger')}</button>
            </div>
          ))}
          <div>
            <button type="button" style={btnSubtle} onClick={() => onChange({ triggers: [...form.triggers, EMPTY_AGENT_TRIGGER] })}>{t('addTrigger')}</button>
          </div>
        </div>
        <p style={help}>{t('triggersHelp')}</p>
      </fieldset>

      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend style={labelStyle}>{t('budget')}</legend>
        <div style={row}>
          {AGENT_BUDGET_KEYS.map((key) => (
            <label key={key} style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-strong)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {t(`budgetKey.${key}`)}
              <input type="number" min={0} step="any" style={{ ...inputStyle, width: 120 }} value={form.budget[key]} onChange={(e) => onChange({ budget: { ...form.budget, [key]: e.target.value } })} />
            </label>
          ))}
        </div>
        <p style={help}>{t('budgetHelp')}</p>
      </fieldset>

      <section data-testid="agent-form-preview">
        <h3 style={labelStyle}>{t('preview')}</h3>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 'var(--font-size-small)' }}>
          {previewRows.map(([field, value]) => (
            <div key={field} style={{ display: 'contents' }}>
              <dt style={{ color: 'var(--muted)' }}>{t(`field.${field}`)}</dt>
              <dd style={{ margin: 0, color: 'var(--text-strong)' }}>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {refusal && (
        <div role="alert" data-testid="agent-form-refusal" style={{ fontSize: 'var(--font-size-small)', color: 'var(--danger, var(--text-strong))' }}>
          <strong>{t('refused')}</strong> {refusal.error}
          {refusal.issues.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {refusal.issues.map((issue) => <li key={`${issue.path}:${issue.message}`} data-issue-code={issue.code}><code>{issue.path}</code> {issue.message}</li>)}
          </ul>}
        </div>
      )}

      <div style={{ ...row, justifyContent: 'flex-end' }}>
        <button type="button" style={btnSubtle} onClick={onCancel}>{t('cancel')}</button>
        <button type="submit" style={btnPrimary} disabled={submitting || !agentDraftSendable(gaps)}>
          {submitting ? t('submitting') : t('submit')}
        </button>
      </div>
    </form>
  );
}
