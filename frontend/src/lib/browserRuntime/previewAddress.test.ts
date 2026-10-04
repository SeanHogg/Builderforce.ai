import { describe, it, expect } from 'vitest';
import { previewDisplayAddress, projectSlug } from './previewAddress';

describe('previewDisplayAddress', () => {
  it('names a relay preview after the project, keeping the in-app path', () => {
    expect(previewDisplayAddress('https://preview.builderforce.ai/__bfwc/58faf7ba00cc4c5c/', 'Retro 80s fan site'))
      .toBe('retro-80s-fan-site-preview.builderforce.ai/');
    expect(previewDisplayAddress('https://preview.builderforce.ai/__bfwc/58faf7ba00cc4c5c/products?id=2', 'Shop'))
      .toBe('shop-preview.builderforce.ai/products?id=2');
    expect(previewDisplayAddress('https://preview.builderforce.ai/__bfwc/58faf7ba00cc4c5c', 'Shop'))
      .toBe('shop-preview.builderforce.ai/');
  });

  it('shows any other address as it is', () => {
    expect(previewDisplayAddress('https://acme.apps.builderforce.ai/', 'Acme')).toBe('https://acme.apps.builderforce.ai/');
    expect(previewDisplayAddress('not a url', 'Acme')).toBe('not a url');
  });
});

describe('projectSlug', () => {
  it('reduces a name to a host label', () => {
    expect(projectSlug('Build a marketing website for he-man')).toBe('build-a-marketing-website-for-he-man');
    expect(projectSlug('  Café  Déjà Vu!! ')).toBe('cafe-deja-vu');
    expect(projectSlug('项目')).toBe('app');
    expect(projectSlug('x'.repeat(60)).length).toBe(40);
  });
});
