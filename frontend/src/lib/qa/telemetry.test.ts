/**
 * @vitest-environment jsdom
 *
 * Pins the browser-facing re-export: deriveSelector / redactInput live in
 * `@builderforce/interaction-contract`, and telemetry.ts is the one call site
 * that hands them a real Element. If the package's SelectorElement ever
 * diverges from the DOM, this is the file that fails.
 */
import { describe, expect, it } from 'vitest';
import { deriveSelector } from './telemetry';
import * as contract from '@builderforce/interaction-contract';

const { redactInput } = contract;

describe('telemetry re-export', () => {
  it('is the shared contract deriveSelector, not a copy', () => {
    expect(deriveSelector).toBe(contract.deriveSelector);
  });
});

describe('deriveSelector (DOM)', () => {
  it('prefers data-testid on a real element', () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'save');
    button.textContent = 'Save';
    expect(deriveSelector(button)).toEqual({ selector: 'getByTestId("save")', label: 'save' });
  });

  it('uses role + accessible name for a labelled button', () => {
    const button = document.createElement('button');
    button.textContent = 'Save changes';
    expect(deriveSelector(button).selector).toBe('getByRole("button", { name: "Save changes" })');
  });
});

describe('redactInput (DOM)', () => {
  it('never records a password field', () => {
    const input = document.createElement('input');
    input.type = 'password';
    input.value = 'secret';
    expect(redactInput(input)).toBeNull();
  });
});
