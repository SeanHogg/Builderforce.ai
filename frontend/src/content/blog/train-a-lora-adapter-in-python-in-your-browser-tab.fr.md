# Entraînez un adaptateur LoRA en Python, dans l'onglet de navigateur où vous l'avez créé

Vous avez l'intuition qu'un petit modèle ferait mieux sur vos données. Le vérifier commençait par un détour : louer une machine GPU, installer PyTorch, copier les données, lancer le script, rapatrier les poids, puis trouver comment les charger quelque part où vous pourriez vraiment les essayer.

Le temps que la réponse arrive, la question avait refroidi.

Ce détour est désormais facultatif. **Un script d'entraînement Python de votre projet s'exécute dans l'onglet de navigateur où vous l'avez créé, et l'adaptateur qu'il enregistre devient un modèle que vous pouvez publier et appeler.**

## Ce qui se passe quand vous appuyez sur Run

Déclarez le script comme un service `training` dans le `builderforce.json` de votre projet — `python train.py`, sans port. Appuyez sur Run et le script démarre dans l'onglet, à côté du reste de votre app.

À l'intérieur, `import torch` et `import peft` fonctionnent. Ils tournent sur votre GPU via WebGPU, avec le même moteur que l'entraîneur intégré au navigateur. Le script journalise sa perte avec `bfwc.training.log(step, loss)`. Quand il a terminé, il enregistre son adaptateur avec `save_pretrained` de peft dans `bfwc.training.artifact_dir()`. Si vous l'arrêtez avant, l'environnement d'exécution lui demande un checkpoint : un script qui vérifie `bfwc.training.checkpoint_requested()` enregistre et s'arrête proprement.

```bf-figure
{
  "kind": "flow",
  "title": "D'un script d'entraînement à un modèle que vous pouvez appeler",
  "steps": [
    { "label": "Entraîner", "note": "Votre train.py tourne dans l'onglet : import torch et peft, sur votre GPU via WebGPU.", "hue": "make", "tag": "dans l'onglet" },
    { "label": "Enregistrer", "note": "Le script enregistre son adaptateur LoRA, à la fin ou quand vous l'arrêtez. La sauvegarde reste dans votre navigateur.", "hue": "run", "tag": "dans l'onglet" },
    { "label": "Publier", "note": "Le panneau d'entraînement charge la sauvegarde comme un paquet de modèle exécutable que vous pouvez publier, appeler et évaluer.", "hue": "measure" }
  ],
  "caption": "Un script, un adaptateur enregistré, un modèle que vous pouvez appeler. Les données d'entraînement et les poids ne quittent pas votre onglet tant que vous ne publiez pas."
}
```

Ouvrez le panneau d'entraînement, choisissez le service sous **Adaptateur d'un service d'entraînement Python** et chargez son adaptateur enregistré. Dès lors, c'est le même artefact que celui produit par un entraînement lancé dans le panneau. Publiez-le, testez un prompt dessus et évaluez-le sur du texte mis de côté, exactement comme un adaptateur entraîné dans le panneau.

## Ce pour quoi il est conçu, et ce pour quoi il ne l'est pas

C'est un outil pour de petites expériences rapides, et les limites sont réelles :

- **WebGPU est nécessaire pour la vitesse GPU.** Sans lui, le même script tourne sur le CPU, ce qui est bien plus lent.
- **Petits modèles uniquement.** Le navigateur garde le modèle de base et l'adaptateur dans la mémoire de votre onglet.
- **Adaptateurs LoRA uniquement.** L'adaptateur cible l'embedding de tokens des modèles Evermind du navigateur, le module sur lequel les modèles du navigateur chargent les adaptateurs. Dans votre script, cela signifie un `nn.Linear` nommé `embed_tokens` qui contient l'embedding de tokens d'une base Evermind ; un modèle Evermind Python prêt à l'emploi n'est pas encore fourni. Les fine-tunes complets et les autres modules cibles sont hors périmètre.
- **La base accompagne l'adaptateur.** Une sauvegarde peut embarquer sa propre base (`base_model.safetensors` et `tokenizer.json`) ; sinon, vous choisissez dans le panneau le checkpoint de base et le tokenizer sur lesquels il a été entraîné.

Les grands modèles relèvent toujours de l'entraînement dans le cloud. Ceci sert à l'étape d'avant : savoir si les données font bouger les choses, tout simplement.

```bf-figure
{
  "kind": "compare",
  "title": "Deux façons de tester une idée de fine-tuning",
  "columns": [
    { "title": "Louer une machine GPU", "hue": "muted", "items": ["Provisionner une machine et installer PyTorch", "Envoyer les données et rapatrier les poids", "Trouver comment charger le résultat", "Payer chaque heure où elle reste là", "Adapté aux grands modèles"] },
    { "title": "Entraîner dans l'onglet", "hue": "run", "items": ["Appuyer sur Run sur votre script d'entraînement", "Les données restent dans votre navigateur", "La sauvegarde se charge directement dans le panneau", "Aucun calcul cloud pour entraîner", "Adapté aux petits modèles et à LoRA"] }
  ],
  "caption": "La machine GPU reste le bon outil pour les gros entraînements. Elle a simplement cessé d'être le prix d'une première réponse."
}
```

## Où cela se place dans la méthode

Idea to Real est un arc — **Idea → Make → Run → Measure** — avec une boucle à l'intérieur : [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Une idée de fine-tuning est une preuve comme une autre. La façon la moins chère de la prouver est un petit adaptateur sur un petit modèle, exécuté là où vous êtes déjà, évalué sur du texte que le modèle n'a jamais vu.

Entraîner dans l'onglet place cette preuve dans l'étape Run. L'évaluation du panneau est l'étape Measure : perplexité et précision sur du texte mis de côté, pour décider avec un chiffre plutôt qu'avec une impression.

## Ce que vous pouvez faire dès aujourd'hui

- **Exécuter un script d'entraînement Python dans l'onglet** avec `import torch` et `import peft`, sur votre GPU via WebGPU.
- **L'arrêter sans perdre le travail.** Un script qui vérifie les demandes de checkpoint enregistre avant de s'arrêter.
- **Transformer la sauvegarde en modèle** que vous pouvez publier, appeler et évaluer, depuis le panneau d'entraînement.
- **Garder les données en local.** Les données d'entraînement et l'adaptateur enregistré restent dans votre navigateur jusqu'à ce que vous choisissiez de publier.
- **Passer à l'entraînement dans le cloud** quand l'idée a mérité un modèle plus grand.

---

**À lire aussi :** [Votre app full-stack s'exécute maintenant dans l'onglet de navigateur où vous l'avez créée](/blog/your-full-stack-app-now-runs-in-your-browser-tab) · [L'IA local-first avec WebGPU dans le navigateur](/blog/local-first-ai-webgpu-in-the-browser) · [Read, Prove, Build : la boucle interne](/blog/read-prove-build-the-inner-loop)

[Ouvrez un projet](/create), ajoutez un service d'entraînement à son `builderforce.json` et appuyez sur Run.
