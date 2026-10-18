import { describe, expect, it } from 'vitest';
import { isVisualDesignRequest, isWebsiteRedesignRequest } from '@/lib/canvasTurnOutcome';
import { canvasSystemMessages } from '@/lib/canvasAiSystemPrompt';

/**
 * The base canvas prompt names `canvas_create_build` unconditionally, so probing for
 * that tool name alone would pass on every turn and prove nothing. What is unique to
 * THIS directive is its prohibition on the prose fallback.
 */
const DESIGN_DIRECTIVE = 'NEVER reply with a prose description';

function hasDesignDirective(prompt: string, persistence: 'local' | 'server' = 'server'): boolean {
  return canvasSystemMessages({
    prompt,
    canvasSnapshot: '{"objects":[]}',
    persistence,
    memoryBlock: '',
  })
    .filter((message) => message.role === 'system')
    .some((message) => String(message.content).includes(DESIGN_DIRECTIVE));
}

/**
 * THE FAILURE THIS GUARDS: a person asks for something to LOOK AT, and the model
 * answers with prose about a design. Every phrase below is a real way a user asks for
 * that. Each one must both classify as a visual-design request AND reach the model
 * carrying the instruction to build it in Studio.
 */
describe('isVisualDesignRequest — the phrasings a user actually types', () => {
  it.each([
    ['mock up', 'Show me a mock up for the pricing page'],
    ['mock-up', 'I need a mock-up of the onboarding flow'],
    ['mockup', 'Give me a quick mockup of the dashboard'],
    ['design visual', 'I need a design visual for the launch'],
    ['high fidelity design', 'Can you do a high fidelity design of the settings screen'],
    ['hi-fi design', 'Give me a hi-fi design of the checkout page'],
    ['hifi mock', 'A hifi mock of the home screen please'],
    ['sample UI/UX', 'Do you have a sample UI/UX for this app?'],
    ['ux/ui sample', 'Show a ux/ui sample for the mobile nav'],
    ['wireframe', 'Wireframe the signup flow'],
    ['look and feel', 'I want the look and feel of a fintech app'],
    ['prototype to click through', 'Build me a prototype I can click through'],
    ['show me what it looks like', 'Show me what it looks like with a bigger hero'],
    ['visualise the onboarding', 'Visualise the onboarding as a visual'],
    ['what would this look like', 'What would this look like as a real page?'],
    ['I want to see the landing page', 'I want to see the landing page for our new offer'],
  ])('recognises %s', (_label, prompt) => {
    expect(isVisualDesignRequest(prompt)).toBe(true);
  });

  it('reaches the model with the Studio-build instruction attached', () => {
    const directive = canvasSystemMessages({
      prompt: 'Show me a mock up for the pricing page',
      canvasSnapshot: '{"objects":[]}',
      persistence: 'server',
      memoryBlock: '',
    })
      .filter((message) => message.role === 'system')
      .map((message) => String(message.content))
      .find((block) => block.includes(DESIGN_DIRECTIVE));
    expect(directive).toBeDefined();
    // The instruction must name the tool AND forbid the fallback that caused the
    // failure — naming the tool alone was already true of the base prompt.
    expect(directive).toContain('canvas_create_build');
  });

  it.each([
    'Show me a mock up for the pricing page',
    'I need a design visual for the launch',
    'Can you do a high fidelity design of the settings screen',
    'Do you have a sample UI/UX for this app?',
  ])('attaches the directive for %s', (prompt) => {
    expect(hasDesignDirective(prompt)).toBe(true);
  });

  /**
   * `persistence` gates several other blocks. This one is deliberately ungated: the
   * build tools are guest-safe, so a local-only board must not be the one place the
   * capability is missing.
   */
  it('is available on a local-only canvas too', () => {
    expect(hasDesignDirective('Show me a mock up for the pricing page', 'local')).toBe(true);
  });
});

describe('isVisualDesignRequest — what it must NOT catch', () => {
  it.each([
    'What is a mock up?',
    'Explain how the design visual differs from a wireframe',
    'How do I mock up a user journey in Figma?',
    'Summarise the layout of the dashboard I built',
  ])('does not treat a question ABOUT design as an order to make one: %s', (prompt) => {
    expect(isVisualDesignRequest(prompt)).toBe(false);
  });

  it.each([
    'Summarise the last standup',
    'Who is on call this week?',
    'Add a task for the API rewrite',
    'What did we decide about pricing?',
  ])('leaves ordinary conversation alone: %s', (prompt) => {
    expect(isVisualDesignRequest(prompt)).toBe(false);
  });

  it('is false for an empty turn', () => {
    expect(isVisualDesignRequest('   ')).toBe(false);
  });

  it('adds no directive to a turn that is not about a design', () => {
    expect(hasDesignDirective('Summarise the last standup')).toBe(false);
  });
});

describe('the two classifiers stay independent', () => {
  /**
   * A redesign needs BEFORE/AFTER evidence from a site that already exists, so it
   * requires a named site to capture. A mock up needs no such thing. Collapsing them
   * would either capture nothing on a mock up, or demand a URL the user never gave.
   */
  it('a bare mock up is a visual design request but not a website redesign', () => {
    const prompt = 'Show me a mock up of our pricing page';
    expect(isVisualDesignRequest(prompt)).toBe(true);
    expect(isWebsiteRedesignRequest(prompt)).toBe(false);
  });

  it('a named-site redesign is still both', () => {
    const prompt = 'Redesign our website, I want a mock up of the new homepage';
    expect(isVisualDesignRequest(prompt)).toBe(true);
    expect(isWebsiteRedesignRequest(prompt)).toBe(true);
  });
});