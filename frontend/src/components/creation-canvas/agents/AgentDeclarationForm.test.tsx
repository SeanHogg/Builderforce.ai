import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Real English copy: the refusal is asserted as the sentence a person reads.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import type { AgentDeclarationRefusal } from '@/lib/canvas/appAgentDeclaration';
import { AgentDeclarationForm, agentFormToDraft, EMPTY_AGENT_FORM, type AgentFormState } from './AgentDeclarationForm';

const FILLED: AgentFormState = {
  ...EMPTY_AGENT_FORM,
  id: '  triage  ',
  roleKind: 'role',
  roleKey: 'developer',
  instructionsPath: 'agents/triage.md',
  tools: ['env.fs.read'],
  triggers: [
    { kind: 'cron', cron: '0 9 * * 1-5', timezone: '', service: 'github', event: '' },
    { kind: 'service', cron: '', timezone: '', service: 'github', event: 'issue.opened' },
  ],
  budget: { tokens: '1000', usd: '', steps: '20' },
};

function renderForm(overrides: Partial<React.ComponentProps<typeof AgentDeclarationForm>> = {}) {
  const props: React.ComponentProps<typeof AgentDeclarationForm> = {
    form: FILLED,
    onChange: vi.fn(),
    toolOptions: ['env.fs.read', 'env.run'],
    submitting: false,
    refusal: null,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<AgentDeclarationForm {...props} />);
  return props;
}

const submitButton = () => screen.getByRole('button', { name: /Declare agent|Declaring…/ });

describe('agentFormToDraft', () => {
  /** What was typed becomes the draft: the id trimmed, each trigger in its own kind's
   *  shape (fields typed under another kind dropped), and only the budget limits set. */
  it('maps a filled form to the draft it stands for', () => {
    expect(agentFormToDraft(FILLED)).toEqual({
      id: 'triage',
      role: { kind: 'role', key: 'developer' },
      instructionsPath: 'agents/triage.md',
      tools: ['env.fs.read'],
      triggers: [
        { kind: 'cron', cron: '0 9 * * 1-5' },
        { kind: 'service', service: 'github', event: 'issue.opened' },
      ],
      budget: { tokens: 1000, steps: 20 },
    });
  });

  it('maps an empty form to a draft with no tools, triggers or limits', () => {
    expect(agentFormToDraft({ ...EMPTY_AGENT_FORM, id: 'helper', roleKind: 'workload', roleKey: 'summarize' })).toEqual({
      id: 'helper',
      role: { kind: 'workload', key: 'summarize' },
      instructionsPath: '',
      tools: [],
      triggers: [],
      budget: {},
    });
  });
});

describe('AgentDeclarationForm', () => {
  /** A duplicate id is the server's to catch — it reads the manifest — and comes back as
   *  its sentence, with no typed issue (`app_manifest.add_agent`'s own refusal). */
  it("draws the server's duplicate-id refusal", () => {
    const refusal: AgentDeclarationRefusal = {
      error: 'An agent "triage" is already declared; nothing was written.',
      issues: [],
    };
    renderForm({ refusal });
    const alert = screen.getByTestId('agent-form-refusal');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent('The declaration was refused.');
    expect(alert).toHaveTextContent('An agent "triage" is already declared; nothing was written.');
    expect(alert.querySelectorAll('li')).toHaveLength(0);
  });

  /** The validator's typed issues are drawn each at its path, with its own sentence and code. */
  it("draws each of the validator's typed issues", () => {
    const refusal: AgentDeclarationRefusal = {
      error: 'The declaration was refused; nothing was written.',
      issues: [
        { code: 'missing-field', path: 'agents.triage', message: '"agents.triage" is missing "role".' },
        { code: 'invalid-value', path: 'agents.triage.tools', message: '"agents.triage.tools" has an invalid value "env.secret.read". Environment tools: env.fs.read.' },
      ],
    };
    renderForm({ refusal });
    const issues = [...screen.getByTestId('agent-form-refusal').querySelectorAll('li')];
    expect(issues.map((issue) => issue.getAttribute('data-issue-code'))).toEqual(['missing-field', 'invalid-value']);
    expect(issues[0]).toHaveTextContent('agents.triage "agents.triage" is missing "role".');
    expect(issues[1]).toHaveTextContent('agents.triage.tools');
    expect(issues[1]).toHaveTextContent('env.secret.read');
  });

  /** An empty role is asked as a question, not just a greyed button; the validator would
   *  refuse it anyway, so the draft is not sent. */
  it('asks for the role when it is missing and holds the submit', () => {
    const { onSubmit } = renderForm({ form: { ...FILLED, roleKey: '   ' } });
    expect(screen.getByTestId('agent-form-clarify-role')).toHaveTextContent('Which role should this agent play?');
    expect(screen.getByTestId('agent-form-preview')).toHaveTextContent('No role yet');
    expect(submitButton()).toBeDisabled();
    fireEvent.click(submitButton());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('asks nothing once a role is named, and previews the declaration as the room reads it', () => {
    renderForm();
    expect(screen.queryByTestId('agent-form-clarify-role')).toBeNull();
    const preview = screen.getByTestId('agent-form-preview');
    expect(preview).toHaveTextContent('Role');
    expect(preview).toHaveTextContent('developer');
    expect(preview).toHaveTextContent('Instructions');
    expect(preview).toHaveTextContent('agents/triage.md');
  });

  /** A granted tool outside the catalog is pointed at, but the runtime's validator — not
   *  the form — decides whether the declaration stands, so the submit stays open. */
  it('points at a granted tool that is not in the catalog', () => {
    renderForm({ form: { ...FILLED, tools: ['env.fs.read', 'env.secret.read'] } });
    const unknown = screen.getByTestId('agent-form-unknown-tools');
    expect(unknown).toHaveTextContent('"env.secret.read" is not in the tool catalog you can grant.');
    expect(unknown).not.toHaveTextContent('env.fs.read');
    expect(submitButton()).toBeEnabled();
  });

  it('points at nothing while the tool options load', () => {
    renderForm({ toolOptions: null, form: { ...FILLED, tools: ['env.secret.read'] } });
    expect(screen.queryByTestId('agent-form-unknown-tools')).toBeNull();
  });

  /** Declared values are text, never markup: a role typed as HTML renders as its characters. */
  it('renders a typed value as text', () => {
    const markup = '<img src=x onerror=alert(1)>';
    renderForm({ form: { ...FILLED, roleKey: markup } });
    const preview = screen.getByTestId('agent-form-preview');
    expect(preview).toHaveTextContent(markup);
    expect(preview.querySelector('img')).toBeNull();
  });

  it('draws no refusal when there is none', () => {
    renderForm();
    expect(screen.queryByTestId('agent-form-refusal')).toBeNull();
  });

  it('submits a filled form', () => {
    const { onSubmit } = renderForm();
    expect(submitButton()).toBeEnabled();
    fireEvent.click(submitButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  /** One declaration per press: a second submit while the first is in flight would
   *  race it to the manifest and come back as a duplicate-id refusal. */
  it('disables the submit while submitting', () => {
    const { onSubmit } = renderForm({ submitting: true });
    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveTextContent('Declaring…');
    fireEvent.click(submitButton());
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
