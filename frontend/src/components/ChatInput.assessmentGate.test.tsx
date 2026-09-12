import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { assessmentGate, type AssessmentMode } from '@/lib/academic/assessment';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

let mode: AssessmentMode = 'open';
vi.mock('@/lib/academic/useAssistantGate', () => ({ useAssistantGate: () => assessmentGate(mode) }));

const { ChatInput } = await import('./ChatInput');

/**
 * The composer under the exam gate. Every composer in the shell is this component,
 * so this is where "a closed-book assessment refuses the assistant" is kept — once.
 */
describe('ChatInput under an assessment', () => {
  const renderComposer = () => {
    const onSubmit = vi.fn();
    render(<ChatInput value="what is the answer to question 3" onChange={() => {}} onSubmit={onSubmit} />);
    return { onSubmit, form: () => screen.getByRole('textbox').closest('form')! };
  };

  it('refuses every turn while a closed-book assessment is live, and says why', () => {
    mode = 'closed';
    const { onSubmit, form } = renderComposer();
    expect(screen.getByRole('textbox')).toBeDisabled();
    fireEvent.submit(form());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('composer-assessment-gate')).toHaveTextContent('chatInput.assessmentClosedBook');
  });

  it('still sends in an assisted assessment, and says the turn is recorded', () => {
    mode = 'assisted';
    const { onSubmit, form } = renderComposer();
    fireEvent.submit(form());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('composer-assessment-gate')).toHaveTextContent('chatInput.assessmentAssisted');
  });

  it('says nothing when no assessment is live', () => {
    mode = 'open';
    const { onSubmit, form } = renderComposer();
    fireEvent.submit(form());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('composer-assessment-gate')).toBeNull();
  });
});
