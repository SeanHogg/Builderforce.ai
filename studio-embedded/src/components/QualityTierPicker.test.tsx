import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  resolveEffectiveChain,
  resolveQualityTier,
  describeChain,
  CustomRefinementPicker,
} from './QualityTierPicker';

/**
 * Locks the custom two-pass override (the generalisation of the fixed "Refined"
 * tier): in Advanced mode a power user can pick ANY draft → refine pair, and
 * resolveEffectiveChain — the single source of truth the engine, badge, and
 * saved params all read — must reflect it. We test the pure resolver directly
 * plus the picker's "no self-refinement" filter.
 */

describe('resolveEffectiveChain — custom refinement override', () => {
  it('simple mode ignores customRefinement (the tier drives the chain)', () => {
    const chain = resolveEffectiveChain({
      showAdvanced: false,
      advancedModel: 'sd-turbo',
      quality: 'refined',
      customRefinement: 'lcm-tiny-sd',
    });
    // Refined tier = lcm-tiny-sd → lcm-dreamshaper-v7, untouched by the override.
    expect(chain).toEqual({
      primary: resolveQualityTier('refined').primary,
      refinement: resolveQualityTier('refined').refinement,
      overridesQuality: false,
    });
  });

  it('Advanced mode with a custom refinement builds the arbitrary pair', () => {
    const chain = resolveEffectiveChain({
      showAdvanced: true,
      advancedModel: 'sd-turbo',
      quality: 'fast',
      customRefinement: 'lcm-dreamshaper-v7',
    });
    expect(chain).toEqual({
      primary: 'sd-turbo',
      refinement: 'lcm-dreamshaper-v7',
      overridesQuality: true,
    });
    expect(describeChain(chain)).toBe('sd-turbo → lcm-dreamshaper-v7 (two-pass)');
  });

  it('Advanced mode without a refinement is a single pass', () => {
    const chain = resolveEffectiveChain({
      showAdvanced: true,
      advancedModel: 'lcm-tiny-sd',
      quality: 'fast',
      customRefinement: null,
    });
    expect(chain.refinement).toBeNull();
    expect(chain.overridesQuality).toBe(true);
  });

  it('a model refining ITSELF is coerced to a single pass (no wasted second pass)', () => {
    const chain = resolveEffectiveChain({
      showAdvanced: true,
      advancedModel: 'lcm-tiny-sd',
      quality: 'fast',
      customRefinement: 'lcm-tiny-sd',
    });
    expect(chain.refinement).toBeNull();
  });
});

describe('CustomRefinementPicker', () => {
  it('offers "None" + every model except the primary (no self-refinement)', () => {
    render(
      <CustomRefinementPicker primary="lcm-tiny-sd" value={null} onChange={() => {}} />,
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain(''); // "None (single pass)"
    expect(optionValues).not.toContain('lcm-tiny-sd'); // the primary is filtered out
    expect(optionValues).toContain('lcm-dreamshaper-v7');
  });

  it('emits null when "None" is chosen, the model id otherwise', () => {
    const calls: (string | null)[] = [];
    render(
      <CustomRefinementPicker
        primary="lcm-tiny-sd"
        value="lcm-dreamshaper-v7"
        onChange={(v) => calls.push(v)}
      />,
    );
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '' } });
    fireEvent.change(select, { target: { value: 'sd-turbo' } });
    expect(calls).toEqual([null, 'sd-turbo']);
  });
});
