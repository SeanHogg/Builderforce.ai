import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import en from '@/i18n/messages/en.json';
import MethodologySection, { type MethodologyVariant } from './MethodologySection';
import { METHOD_STEPS, METHOD_STAGES, PROOF_FORMS } from '@/lib/methodology';

// The suite's global next-intl mock returns the KEY for every message, which is
// the right default everywhere else and useless here: what this file asserts is
// that the real copy for every step, stage and proof actually resolves. The
// shared real-catalog override swaps only `useTranslations`.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

/**
 * The point of this component is that four marketing pages cannot describe the
 * method four different ways. What is worth asserting is therefore not its
 * markup but its COMPLETENESS and its VARIANTS: every step and every proof the
 * registry declares must appear, and each host must get exactly the halves it
 * does not already render itself.
 *
 * The variant assertions in particular guard a real regression: `/features`
 * renders the arc as a registry-generated table a few bands below this
 * component, so a `catalog` variant that started emitting the arc strip would
 * put the arc on that page twice — visible only to someone scrolling the whole
 * page, which is nobody, on a marketing site.
 */

function renderAt(variant: MethodologyVariant) {
  return render(<MethodologySection variant={variant} />);
}

const stepTitle = (step: string) =>
  (en as { methodology: { step: Record<string, { title: string }> } }).methodology.step[step].title;

const proofName = (key: string) =>
  (en as { methodology: { proof: Record<string, { name: string }> } }).methodology.proof[key].name;

const stageName = (stage: string) =>
  (en as { nav: { stage: Record<string, string> } }).nav.stage[stage];

describe('MethodologySection', () => {
  it('renders every act of the loop, in every variant', () => {
    for (const variant of ['full', 'catalog', 'loop'] as const) {
      const { unmount } = renderAt(variant);
      for (const step of METHOD_STEPS) {
        expect(screen.getByText(stepTitle(step)), `${step} missing from ${variant}`).toBeTruthy();
      }
      unmount();
    }
  });

  it('renders every proof form the registry declares', () => {
    renderAt('full');
    for (const proof of PROOF_FORMS) {
      expect(screen.getByText(proofName(proof.key)), `${proof.key} missing`).toBeTruthy();
    }
  });

  it('shows the arc only where the host does not render its own', () => {
    // `loop` and `full` carry the arc; `catalog` is the /features treatment and
    // must not, because that page generates the arc from the registry itself.
    for (const [variant, expected] of [['full', true], ['loop', true], ['catalog', false]] as const) {
      const { unmount } = renderAt(variant);
      const present = METHOD_STAGES.every((stage) => screen.queryByText(stageName(stage)) !== null);
      expect(present, `arc presence wrong for ${variant}`).toBe(expected);
      unmount();
    }
  });

  it('shows the proof catalogue only where the page is about it', () => {
    for (const [variant, expected] of [['full', true], ['catalog', true], ['loop', false]] as const) {
      const { unmount } = renderAt(variant);
      const present = screen.queryByText(proofName('smoke-test')) !== null;
      expect(present, `proof catalogue presence wrong for ${variant}`).toBe(expected);
      unmount();
    }
  });

  it('marks Read and Prove free and Build as the act that spends', () => {
    // The pricing claim the whole method rests on. If this inverted, /pricing
    // would tell a visitor the opposite of what their bill will say.
    const { container } = renderAt('loop');
    const steps = Array.from(container.querySelectorAll('li'))
      .filter((node) => node.querySelector('h3'));
    const free = (en as { methodology: { spends: { no: string; yes: string } } }).methodology.spends;
    expect(within(steps[0] as HTMLElement).getByText(free.no)).toBeTruthy();
    expect(within(steps[1] as HTMLElement).getByText(free.no)).toBeTruthy();
    expect(within(steps[2] as HTMLElement).getByText(free.yes)).toBeTruthy();
  });
});
