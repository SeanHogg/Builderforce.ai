import { describe, it, expect } from 'vitest';
import { assessTextCoherence, looksLikeCoherentText, isServableText } from './textCoherence';

/**
 * The gate's contract has two halves that pull against each other: it must REJECT the
 * fluent-shaped gibberish an under-trained byte-BPE head emits, and it must never
 * reject a legitimate answer — including a jargon-dense technical one, a code dump, or
 * a reply in Spanish/French/German/Chinese. Both halves are asserted here on realistic
 * samples, because a false positive silently drops a real answer.
 */

/**
 * The class of output that reached a user: invented words, balanced punctuation, no
 * repetition and no dominant token — i.e. crafted to clear structural signals 1–4, so
 * these samples exercise the lexical half of the gate specifically.
 */
const GIBBERISH_SAMPLES = [
  'Oredionisiing chats code related tot, bound reposea this inatic exie. A cainstiel was ore, '
  + 'thereb ancerin our propsal fromt bunted resole. Ther inatel sonce wortent flimber, and one '
  + 'grantile morest bindow will hance that trumal serite.',
  'Sprint plandow mirtal enque with fandiel resport, since brantic offow mands wolfer '
  + 'trance and pellent inrest cannoy dortem. Grelling those vantors, our shanted brimel took '
  + 'that crandy uponter of lorbid stension.',
];

/**
 * VERBATIM readiness-probe output from a real quarantined head (project Evermind
 * v10165). The probe generates 80 tokens, so these are ~15-18 words — an order of
 * magnitude shorter than the samples above, and TWO of the three were graded "usable"
 * by the gate while the operator was reading obvious gibberish.
 *
 * Two distinct defects produced that, both fixed:
 *  - the language guard let short accidental fragments decide the vote. `se`/`te`/`mis`
 *    tied Spanish with English on the second sample (so NO language won and the lexicon
 *    was skipped) and `se`/`al` won it outright on the third (so an English-prompted
 *    reply was judged "Spanish" and skipped);
 *  - the scorer ignored 3-letter tokens, which on text this short dropped it below its
 *    own evidence floor and made it decline to score at all.
 */
const PROBE_GIBBERISH_SAMPLES: Array<[string, string]> = [
  ['ties spanish on se/te/mis', '. rame shatd inf the brand te mis . I se me shelse se see branch branch sareated the branch'],
  ['reads as spanish on se/al', 'w. The - shade sade se ush what - dard se gote shaterelrede ushot shatush ushing al'],
  ['already refused', '. isshat sodhouse what shat sharet me dainferid the shatl the ersadhoomadh. somed seare'],
];

/**
 * SHORT real answers — the same length as the probe samples above. These are the
 * false positives the length-sensitive thresholds exist to prevent, so they are
 * asserted alongside them: the fix must separate the two classes, not just reject
 * everything short.
 */
const SHORT_COHERENT_SAMPLES: Array<[string, string]> = [
  ['short status answer', 'The build is green and the last two tickets are merged. Nothing is blocked right now.'],
  ['short recent-work answer', 'We shipped the canvas placer and fixed the guest wall. Next up is the invite link flow.'],
  ['short todo answer', 'Left to do: finish the audit panel, wire the export, and rerun the readiness check.'],
  ['short spanish answer', 'El modelo ya está actualizado y funciona bien.'],
  ['short french answer', 'Le modèle est mis à jour et fonctionne bien.'],
];

/** Real answers that MUST pass — jargon-dense, technical, multilingual, and code. */
const COHERENT_SAMPLES: Array<[string, string]> = [
  [
    'jargon-dense english',
    'The coordinator merges queued contributions into the neocortex artifact and then re-benchmarks '
    + 'the merged head against a held-out set of prior taught examples. If the regression check shows '
    + 'the merge raised held-out loss, the version is quarantined instead of promoted to serve.',
  ],
  [
    'product prose with proper nouns',
    'Builderforce publishes each Evermind snapshot to R2 under an immutable versioned ref, so the '
    + 'per-isolate model cache never serves stale weights. A republish mints a new ref, which is why '
    + 'the memo is safe across the whole worker fleet.',
  ],
  [
    'code-heavy answer',
    'Call `resolveEvermindTargets(env, db, tenantId, projectId)` from api/src/application/llm/projectEvermind.ts. '
    + 'It returns ProjectEvermindHead[] ordered [self, ...builds]; filter with isLiveLearnTarget(head) '
    + 'before dispatching, e.g. targets.filter(h => h.version >= 1 && h.mode === "connected").',
  ],
  [
    'spanish',
    'El modelo del proyecto aprende de cada ejecución de los agentes y guarda una nueva versión en el '
    + 'almacenamiento. Puedes desactivar la inferencia cuando quieras, y el historial de contribuciones '
    + 'sigue disponible para revisarlo más tarde.',
  ],
  [
    'french',
    'Le modèle du projet apprend à partir de chaque exécution des agents et enregistre une nouvelle '
    + 'version dans le stockage. Vous pouvez désactiver l’inférence à tout moment, et l’historique des '
    + 'contributions reste consultable ensuite.',
  ],
  [
    'german',
    'Das Modell dieses Projekts lernt aus jedem Agentenlauf und speichert anschließend eine neue '
    + 'Version im Speicher. Die Inferenz lässt sich jederzeit abschalten, und der Verlauf der Beiträge '
    + 'bleibt weiterhin einsehbar.',
  ],
  [
    'chinese',
    '这个项目的模型会从每一次智能体运行中学习，并把新的版本保存到存储中。你可以随时关闭推理功能，贡献历史仍然可以查看。',
  ],
];

describe('assessTextCoherence — structural signals', () => {
  it('rejects replacement characters from broken byte-BPE decoding', () => {
    const v = assessTextCoherence('The build failed because the ��� handler could not decode the payload.');
    expect(v.coherent).toBe(false);
    expect(v.failure).toBe('replacement-chars');
  });

  it('rejects a stuck decoder repeating a word', () => {
    const v = assessTextCoherence('commit commit commit commit the commit commit commit changes commit');
    expect(v.coherent).toBe(false);
    expect(['repetition', 'dominant-token']).toContain(v.failure);
  });

  it('rejects orphaned closing delimiters', () => {
    const v = assessTextCoherence('The service returns a value) and then closes the stream] before exit.');
    expect(v.coherent).toBe(false);
    expect(v.failure).toBe('unbalanced-delimiters');
  });

  it('reports empty text', () => {
    expect(assessTextCoherence('   ').failure).toBe('empty');
  });
});

describe('assessTextCoherence — invented-word detection (the P2 gap)', () => {
  it.each(GIBBERISH_SAMPLES.map((s, i) => [i, s] as const))(
    'rejects fluent-shaped gibberish sample %i even with balanced punctuation',
    (_i, sample) => {
      const v = assessTextCoherence(sample);
      expect(v.coherent).toBe(false);
      expect(['non-words', 'no-function-words']).toContain(v.failure);
      expect(v.detail).not.toBe('');
    },
  );

  it.each(PROBE_GIBBERISH_SAMPLES)(
    'rejects readiness-probe gibberish that %s',
    (_label, sample) => {
      // Graded with the probe's own prompt as context, exactly as the readiness suite
      // does — the context escape must not rescue text this bad.
      const v = assessTextCoherence(sample, { context: 'Summarize the current status of the project.' });
      expect(v.coherent).toBe(false);
      expect(v.failure).toBe('non-words');
    },
  );

  it('rejects a long Latin-script passage with no function words in any language', () => {
    const sample = Array.from({ length: 40 }, (_, i) => `zolvek${i}mir plandor vestik`).join(' ');
    const v = assessTextCoherence(sample);
    expect(v.coherent).toBe(false);
  });
});

describe('assessTextCoherence — must not mis-reject real answers', () => {
  it.each(COHERENT_SAMPLES)('accepts %s', (_label, sample) => {
    const v = assessTextCoherence(sample);
    expect(v.failure).toBeNull();
    expect(v.coherent).toBe(true);
  });

  it.each(SHORT_COHERENT_SAMPLES)('accepts %s', (_label, sample) => {
    const v = assessTextCoherence(sample);
    expect(v.failure).toBeNull();
    expect(v.coherent).toBe(true);
  });

  it('forgives unknown jargon that echoes the prompt', () => {
    // Every content word is domain-specific and appears exactly once — the shape that
    // would otherwise look like invented tokens. The context rescues it.
    const answer = 'Zephyrion routes each Kalastra shard through Vorbelis before Trantium indexes the '
      + 'Meridex payload, so Quandrix never observes an unbalanced Sylvax batch in the pipeline stage.';
    const context = 'How do Zephyrion, Kalastra, Vorbelis, Trantium, Meridex, Quandrix and Sylvax fit together?';
    expect(assessTextCoherence(answer, { context }).coherent).toBe(true);
  });
});

describe('isServableText', () => {
  it('rejects text below the substantive-answer floor', () => {
    const v = isServableText('too short');
    expect(v.coherent).toBe(false);
    expect(v.failure).toBe('empty');
  });

  it('accepts a substantive coherent answer', () => {
    expect(isServableText('The deployment finished and every health check passed on the first attempt.').coherent).toBe(true);
  });

  it('treats null/undefined as unservable rather than throwing', () => {
    expect(isServableText(null).coherent).toBe(false);
    expect(isServableText(undefined).coherent).toBe(false);
  });
});

describe('looksLikeCoherentText — boolean wrapper stays the same contract', () => {
  it('mirrors the assessment', () => {
    expect(looksLikeCoherentText('The tests all passed after the retry logic was corrected.')).toBe(true);
    expect(looksLikeCoherentText('bad �� output')).toBe(false);
  });
});
