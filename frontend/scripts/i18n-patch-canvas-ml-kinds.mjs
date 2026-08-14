// Canvas object labels for the six ML/training kinds that were registered in
// CREATION_OBJECT_REGISTRY with no catalog entry in ANY locale.
//
// `messages.test.ts` ("<locale> labels every creation canvas object kind") was red on
// all five locales because of them, and a red test file hides every later failure in
// it. On the board itself the miss is visible: an object of one of these kinds
// rendered the raw key `creationCanvas.object.notebook` as its type label.
//
// Usage: node scripts/i18n-merge.mjs scripts/i18n-patch-canvas-ml-kinds.mjs
export const PATCHES = {
  en: {
    creationCanvas: {
      object: {
        labelSet: 'Label set',
        model: 'Model',
        notebook: 'Notebook',
        prompt: 'Prompt',
        runComparison: 'Run comparison',
        trainingRun: 'Training run',
      },
    },
  },
  zh: {
    creationCanvas: {
      object: {
        labelSet: '标注集',
        model: '模型',
        notebook: '笔记本',
        prompt: '提示词',
        runComparison: '运行对比',
        trainingRun: '训练运行',
      },
    },
  },
  es: {
    creationCanvas: {
      object: {
        labelSet: 'Conjunto de etiquetas',
        model: 'Modelo',
        notebook: 'Cuaderno',
        prompt: 'Prompt',
        runComparison: 'Comparación de ejecuciones',
        trainingRun: 'Ejecución de entrenamiento',
      },
    },
  },
  fr: {
    creationCanvas: {
      object: {
        labelSet: 'Jeu d’annotations',
        model: 'Modèle',
        notebook: 'Notebook',
        prompt: 'Prompt',
        runComparison: 'Comparaison d’exécutions',
        trainingRun: 'Exécution d’entraînement',
      },
    },
  },
  de: {
    creationCanvas: {
      object: {
        labelSet: 'Label-Set',
        model: 'Modell',
        notebook: 'Notebook',
        prompt: 'Prompt',
        runComparison: 'Laufvergleich',
        trainingRun: 'Trainingslauf',
      },
    },
  },
};
