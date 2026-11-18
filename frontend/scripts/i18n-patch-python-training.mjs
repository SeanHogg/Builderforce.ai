// PRD 31 §W9 phase 7 — a Python `training` service's saved adapter, loaded in the training
// panel (`components/ai-training/PythonTrainingImport.tsx`, `aiTraining.pythonTraining*`), and the
// catalog title/description of its blog post (`blog.posts.<slug>.*`, the convention
// `src/lib/blogLocale.ts` reads; the English entry mirrors the post's front matter exactly).
// Usage: node scripts/i18n-merge.mjs scripts/i18n-patch-python-training.mjs

const SLUG = 'train-a-lora-adapter-in-python-in-your-browser-tab';

export const PATCHES = {
  en: {
    aiTraining: {
      pythonTrainingTitle: 'Adapter from a Python training service',
      pythonTrainingHint: 'A training service in this project\'s builderforce.json (python train.py) keeps the adapter it saves in this browser. Load it here to publish and test it. A save without its own base model uses the warm-start base checkpoint and tokenizer chosen in this panel.',
      pythonTrainingNone: 'This project\'s blueprint has no training services yet.',
      pythonTrainingServiceAria: 'Training service',
      pythonTrainingLoad: 'Load saved adapter',
      pythonTrainingLoading: 'Loading…',
      pythonTrainingLoaded: 'Loaded the adapter saved by {service}.',
      pythonTrainingFailed: 'The saved adapter could not be loaded.',
      pythonTrainingBlueprintFailed: 'Could not read this project\'s blueprint.',
      pythonTrainingIssue: {
        noSave: '{service} has not saved anything in this browser yet. Run it, then stop it or let it finish.',
        noAdapter: '{service} saved no adapter_model.safetensors. Save the adapter with peft\'s save_pretrained into bfwc.training.artifact_dir().',
        notEmbeddingAdapter: 'The adapter {service} saved does not target embed_tokens, the module browser models load adapters on.',
        shapeMismatch: 'The adapter {service} saved does not fit the base model\'s embedding. Train it on the same base.',
        noBase: 'The save has no base model. Choose the base checkpoint and tokenizer it was trained on as the warm-start base, or save base_model.safetensors and tokenizer.json with it.',
      },
    },
    blog: { posts: { [SLUG]: {
      title: 'Train a LoRA adapter in Python, in the browser tab you built it in',
      description: 'A Python training script in your project now runs inside your browser tab, with import torch and import peft on your GPU through WebGPU. It saves its adapter when it finishes or checkpoints when you stop it; load that adapter in the training panel and publish it as a model you can call. Built for small models and LoRA adapters.',
    } } },
  },
  zh: {
    aiTraining: {
      pythonTrainingTitle: '来自 Python 训练服务的适配器',
      pythonTrainingHint: '本项目 builderforce.json 中的训练服务（python train.py）会把保存的适配器保留在此浏览器中。在这里加载它即可发布和测试。如果保存内容不含自己的基础模型，则使用在此面板中选择的热启动检查点和分词器。',
      pythonTrainingNone: '本项目的蓝图中还没有训练服务。',
      pythonTrainingServiceAria: '训练服务',
      pythonTrainingLoad: '加载已保存的适配器',
      pythonTrainingLoading: '正在加载…',
      pythonTrainingLoaded: '已加载 {service} 保存的适配器。',
      pythonTrainingFailed: '无法加载已保存的适配器。',
      pythonTrainingBlueprintFailed: '无法读取本项目的蓝图。',
      pythonTrainingIssue: {
        noSave: '{service} 尚未在此浏览器中保存任何内容。运行它，然后停止它或等待它完成。',
        noAdapter: '{service} 没有保存 adapter_model.safetensors。请用 peft 的 save_pretrained 将适配器保存到 bfwc.training.artifact_dir()。',
        notEmbeddingAdapter: '{service} 保存的适配器不是针对 embed_tokens 的，而浏览器模型只在该模块上加载适配器。',
        shapeMismatch: '{service} 保存的适配器与基础模型的嵌入层不匹配。请在同一个基础模型上训练。',
        noBase: '保存内容中没有基础模型。请在热启动基础中选择训练时使用的基础检查点和分词器，或将 base_model.safetensors 和 tokenizer.json 一并保存。',
      },
    },
    blog: { posts: { [SLUG]: {
      title: '在你构建它的浏览器标签页里，用 Python 训练 LoRA 适配器',
      description: '你项目中的 Python 训练脚本现在可以在浏览器标签页内运行，import torch 和 import peft 通过 WebGPU 在你的 GPU 上工作。它会在完成时保存适配器，或在你停止它时保存检查点；在训练面板中加载该适配器，并将其发布为可调用的模型。专为小模型和 LoRA 适配器打造。',
    } } },
  },
  es: {
    aiTraining: {
      pythonTrainingTitle: 'Adaptador de un servicio de entrenamiento en Python',
      pythonTrainingHint: 'Un servicio de entrenamiento en el builderforce.json de este proyecto (python train.py) guarda en este navegador el adaptador que produce. Cárgalo aquí para publicarlo y probarlo. Si el guardado no incluye su propio modelo base, se usan el checkpoint y el tokenizador de arranque en caliente elegidos en este panel.',
      pythonTrainingNone: 'El blueprint de este proyecto aún no tiene servicios de entrenamiento.',
      pythonTrainingServiceAria: 'Servicio de entrenamiento',
      pythonTrainingLoad: 'Cargar adaptador guardado',
      pythonTrainingLoading: 'Cargando…',
      pythonTrainingLoaded: 'Se cargó el adaptador guardado por {service}.',
      pythonTrainingFailed: 'No se pudo cargar el adaptador guardado.',
      pythonTrainingBlueprintFailed: 'No se pudo leer el blueprint de este proyecto.',
      pythonTrainingIssue: {
        noSave: '{service} todavía no ha guardado nada en este navegador. Ejecútalo y luego detenlo o deja que termine.',
        noAdapter: '{service} no guardó adapter_model.safetensors. Guarda el adaptador con save_pretrained de peft en bfwc.training.artifact_dir().',
        notEmbeddingAdapter: 'El adaptador que guardó {service} no apunta a embed_tokens, el módulo en el que los modelos del navegador cargan adaptadores.',
        shapeMismatch: 'El adaptador que guardó {service} no encaja con el embedding del modelo base. Entrénalo sobre la misma base.',
        noBase: 'El guardado no tiene modelo base. Elige como base de arranque en caliente el checkpoint base y el tokenizador con los que se entrenó, o guarda base_model.safetensors y tokenizer.json junto a él.',
      },
    },
    blog: { posts: { [SLUG]: {
      title: 'Entrena un adaptador LoRA en Python, en la pestaña del navegador donde lo creaste',
      description: 'Un script de entrenamiento en Python de tu proyecto ahora se ejecuta dentro de tu pestaña del navegador, con import torch e import peft en tu GPU a través de WebGPU. Guarda su adaptador al terminar o crea un checkpoint cuando lo detienes; carga ese adaptador en el panel de entrenamiento y publícalo como un modelo al que puedes llamar. Pensado para modelos pequeños y adaptadores LoRA.',
    } } },
  },
  fr: {
    aiTraining: {
      pythonTrainingTitle: 'Adaptateur d\'un service d\'entraînement Python',
      pythonTrainingHint: 'Un service d\'entraînement du builderforce.json de ce projet (python train.py) conserve dans ce navigateur l\'adaptateur qu\'il enregistre. Chargez-le ici pour le publier et le tester. Un enregistrement sans modèle de base propre utilise le checkpoint et le tokenizer de démarrage à chaud choisis dans ce panneau.',
      pythonTrainingNone: 'Le blueprint de ce projet n\'a pas encore de service d\'entraînement.',
      pythonTrainingServiceAria: 'Service d\'entraînement',
      pythonTrainingLoad: 'Charger l\'adaptateur enregistré',
      pythonTrainingLoading: 'Chargement…',
      pythonTrainingLoaded: 'Adaptateur enregistré par {service} chargé.',
      pythonTrainingFailed: 'Impossible de charger l\'adaptateur enregistré.',
      pythonTrainingBlueprintFailed: 'Impossible de lire le blueprint de ce projet.',
      pythonTrainingIssue: {
        noSave: '{service} n\'a encore rien enregistré dans ce navigateur. Lancez-le, puis arrêtez-le ou laissez-le terminer.',
        noAdapter: '{service} n\'a pas enregistré adapter_model.safetensors. Enregistrez l\'adaptateur avec save_pretrained de peft dans bfwc.training.artifact_dir().',
        notEmbeddingAdapter: 'L\'adaptateur enregistré par {service} ne cible pas embed_tokens, le module sur lequel les modèles du navigateur chargent les adaptateurs.',
        shapeMismatch: 'L\'adaptateur enregistré par {service} ne correspond pas à l\'embedding du modèle de base. Entraînez-le sur la même base.',
        noBase: 'L\'enregistrement n\'a pas de modèle de base. Choisissez comme base de démarrage à chaud le checkpoint de base et le tokenizer utilisés pour l\'entraîner, ou enregistrez base_model.safetensors et tokenizer.json avec lui.',
      },
    },
    blog: { posts: { [SLUG]: {
      title: 'Entraînez un adaptateur LoRA en Python, dans l\'onglet de navigateur où vous l\'avez créé',
      description: 'Un script d\'entraînement Python de votre projet s\'exécute désormais dans votre onglet de navigateur, avec import torch et import peft sur votre GPU via WebGPU. Il enregistre son adaptateur à la fin ou crée un checkpoint quand vous l\'arrêtez ; chargez cet adaptateur dans le panneau d\'entraînement et publiez-le comme un modèle que vous pouvez appeler. Conçu pour les petits modèles et les adaptateurs LoRA.',
    } } },
  },
  de: {
    aiTraining: {
      pythonTrainingTitle: 'Adapter aus einem Python-Trainingsdienst',
      pythonTrainingHint: 'Ein Trainingsdienst in der builderforce.json dieses Projekts (python train.py) bewahrt den gespeicherten Adapter in diesem Browser auf. Laden Sie ihn hier, um ihn zu veröffentlichen und zu testen. Eine Speicherung ohne eigenes Basismodell verwendet den in diesem Bereich gewählten Warmstart-Checkpoint und Tokenizer.',
      pythonTrainingNone: 'Der Blueprint dieses Projekts hat noch keine Trainingsdienste.',
      pythonTrainingServiceAria: 'Trainingsdienst',
      pythonTrainingLoad: 'Gespeicherten Adapter laden',
      pythonTrainingLoading: 'Wird geladen…',
      pythonTrainingLoaded: 'Der von {service} gespeicherte Adapter wurde geladen.',
      pythonTrainingFailed: 'Der gespeicherte Adapter konnte nicht geladen werden.',
      pythonTrainingBlueprintFailed: 'Der Blueprint dieses Projekts konnte nicht gelesen werden.',
      pythonTrainingIssue: {
        noSave: '{service} hat in diesem Browser noch nichts gespeichert. Starten Sie ihn und stoppen Sie ihn dann oder lassen Sie ihn fertig laufen.',
        noAdapter: '{service} hat keine adapter_model.safetensors gespeichert. Speichern Sie den Adapter mit save_pretrained von peft in bfwc.training.artifact_dir().',
        notEmbeddingAdapter: 'Der von {service} gespeicherte Adapter zielt nicht auf embed_tokens, das Modul, auf dem Browsermodelle Adapter laden.',
        shapeMismatch: 'Der von {service} gespeicherte Adapter passt nicht zum Embedding des Basismodells. Trainieren Sie ihn auf derselben Basis.',
        noBase: 'Die Speicherung enthält kein Basismodell. Wählen Sie als Warmstart-Basis den Basis-Checkpoint und Tokenizer, mit denen trainiert wurde, oder speichern Sie base_model.safetensors und tokenizer.json mit.',
      },
    },
    blog: { posts: { [SLUG]: {
      title: 'Trainieren Sie einen LoRA-Adapter in Python, in dem Browser-Tab, in dem Sie ihn gebaut haben',
      description: 'Ein Python-Trainingsskript in Ihrem Projekt läuft jetzt in Ihrem Browser-Tab, mit import torch und import peft auf Ihrer GPU über WebGPU. Es speichert seinen Adapter am Ende oder legt einen Checkpoint an, wenn Sie es stoppen; laden Sie diesen Adapter im Trainingsbereich und veröffentlichen Sie ihn als Modell, das Sie aufrufen können. Gebaut für kleine Modelle und LoRA-Adapter.',
    } } },
  },
};
