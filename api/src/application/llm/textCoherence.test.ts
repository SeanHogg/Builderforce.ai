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
