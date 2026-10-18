import { describe, expect, it } from 'vitest';
import { bundleLookup, type LabelLookup } from '../labelCatalog';
import { DEFAULT_PROMPT_OPTIONS_LABELS } from '../promptOptions/types';
import { DEFAULT_SPEND_LABELS } from '../spend/labels';
import { DEFAULT_WORK_STATUS_LABELS } from '../workStatus/labels';
import { brainComposerLabelsFrom, DEFAULT_MENTION_LABELS, DEFAULT_TICKET_TAG_LABELS } from './brainComposerLabels';
import { composerLabelsFrom, DEFAULT_COMPOSER_LABELS } from './labels';

describe('composerLabelsFrom', () => {
  it('reads string fields and per-choice copy by canonical key, passing figures to the host', () => {
    const seen: Array<[string, unknown]> = [];
    const lookup: LabelLookup = (key, values) => {
      seen.push([key, values]);
      if (key === 'send') return 'Senden';
      if (key === 'modeLabel.work') return 'Arbeit';
      if (key === 'effortDesc.quick') return `Schnell: ${values?.answer}`;
      return undefined;
    };
    const labels = composerLabelsFrom(lookup);
    expect(labels.send).toBe('Senden');
    expect(labels.modeLabel('work')).toBe('Arbeit');
    expect(labels.effortDesc('quick', 3200)).toBe('Schnell: 3200');
    expect(seen).toContainEqual(['effortDesc.quick', { answer: 3200 }]);
  });

  it('keeps the English default for anything the catalog lacks, and honours overrides', () => {
    const labels = composerLabelsFrom(() => undefined, { modeLabel: () => 'Build' });
    expect(labels.placeholder).toBe(DEFAULT_COMPOSER_LABELS.placeholder);
    expect(labels.modeHint('chat')).toBe(DEFAULT_COMPOSER_LABELS.modeHint('chat'));
    expect(labels.thinkingOnDesc(1024)).toBe(DEFAULT_COMPOSER_LABELS.thinkingOnDesc(1024));
    expect(labels.modeLabel('work')).toBe('Build');
  });
});

describe('brainComposerLabelsFrom', () => {
  it('scopes each part\'s keys and fills nested records', () => {
    const bundle = {
      'composer.add': 'Ajouter',
      'options.chooseModel': 'Choisir',
      'status.meters.ai_tokens': 'Jetons IA',
      'spend.sources.prompt_cache': 'Cache',
      'mention.title': 'Adresser à',
      'composer.thinkingOnDesc': 'Budget {budget}',
    };
    const labels = brainComposerLabelsFrom(bundleLookup(bundle, (k) => k, (n) => `#${n}`));
    expect(labels.composer.add).toBe('Ajouter');
    expect(labels.composer.thinkingOnDesc(2048)).toBe('Budget #2048');
    expect(labels.options.chooseModel).toBe('Choisir');
    expect(labels.status.meters.ai_tokens).toBe('Jetons IA');
    expect(labels.status.meters.cloud_runs).toBe(DEFAULT_WORK_STATUS_LABELS.meters.cloud_runs);
    expect(labels.spend.sources.prompt_cache).toBe('Cache');
    expect(labels.mention.title).toBe('Adresser à');
  });

  it('is the English defaults over an empty catalog', () => {
    const labels = brainComposerLabelsFrom(() => undefined);
    expect(labels.options).toEqual(DEFAULT_PROMPT_OPTIONS_LABELS);
    expect(labels.status).toEqual(DEFAULT_WORK_STATUS_LABELS);
    expect(labels.spend).toEqual(DEFAULT_SPEND_LABELS);
    expect(labels.mention).toEqual(DEFAULT_MENTION_LABELS);
    expect(labels.ticket).toEqual(DEFAULT_TICKET_TAG_LABELS);
  });

  it('keeps string placeholders literal and treats an empty string as missing', () => {
    const labels = brainComposerLabelsFrom(bundleLookup({ 'spend.spent': '{amount} dépensé', 'spend.saved': '' }, (k) => k));
    expect(labels.spend.spent).toBe('{amount} dépensé');
    expect(labels.spend.saved).toBe(DEFAULT_SPEND_LABELS.saved);
  });
});
