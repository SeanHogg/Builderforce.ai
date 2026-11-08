# Bonnes pratiques pour la génération de jeux de données par IA

La qualité de votre agent affiné dépend presque entièrement de la qualité de ses données d’entraînement. Des données médiocres donnent des résultats médiocres — mais avec quelques pratiques délibérées, vous pouvez générer des jeux de données qui font une vraie différence.

![Pipeline de bonnes pratiques pour les jeux de données : d’un prompt de capacité précis à des échantillons variés, à la relecture d’échantillons, à l’évaluation par IA, puis à un export JSONL versionné, avec une boucle de retour d’itération](/blog/dataset-generation.svg)

## Commencez par un prompt de capacité précis

Le prompt de capacité est la graine de tout votre jeu de données. Les prompts vagues produisent des jeux de données génériques ; les prompts précis en produisent de ciblés et d’utiles.

**Prompt faible :**
> « Un assistant de code serviable. »

**Prompt solide :**
> « Un assistant TypeScript spécialisé dans la refactorisation de JavaScript hérité vers du TypeScript moderne. Il repère les types `any` implicites, ajoute des annotations explicites, convertit les `require` CommonJS en `import` ESM, et explique chaque changement en une phrase de justification. »

La différence dans le jeu de données obtenu — et dans l’agent qui en résulte — est spectaculaire.

## Visez la diversité

Un bon jeu de données couvre la *distribution complète* des entrées que votre agent rencontrera en production. Utilisez les **réglages de diversité** de Builderforce pour accroître la variation sur :

- **La complexité des entrées** — mêlez exemples simples, moyens et complexes
- **Les cas limites** — incluez des entrées mal formées, des demandes ambiguës et des cas limites délicats
- **Le ton et le format** — variez le style d’écriture des questions et des réponses

Un jeu de données de 500 exemples variés surpasse généralement un jeu de 2 000 exemples quasi identiques.

## Utilisez le bon modèle pour la génération

Builderforce vous permet de choisir n’importe quel modèle OpenRouter pour la génération de jeux de données. Conseils généraux :

| Cas d’usage | Modèles recommandés |
|----------|-------------------|
| Jeux de données orientés code | Claude 3.5 Sonnet, GPT-4o, Gemini 1.5 Pro |
| Jeux de données de raisonnement | o1, Claude 3 Opus |
| Affinage d’instructions généraliste | Llama 3.1 70B, Mistral Large |
| Génération à budget serré | Gemini Flash, Llama 3.1 8B |

Pour les domaines spécialisés (médecine, droit, finance), associez un modèle de base puissant à des exemples propres au domaine dans votre prompt de capacité.

## Relisez un échantillon avant d’entraîner

N’entraînez pas sur des données générées automatiquement sans les avoir relues. Builderforce vous montre un échantillon aléatoire de 20 exemples avant que vous ne vous engagiez dans l’entraînement. Cherchez :

- ✅ Des instructions claires et sans ambiguïté
- ✅ Des réponses exactes et détaillées
- ✅ Un formatage cohérent
- ❌ Des faits inventés ou du code qui ne compile pas
- ❌ Des réponses trop courtes ou hors sujet
- ❌ Des doublons ou quasi-doublons

Si plus de 10 à 15 % de l’échantillon vous semble incorrect, régénérez avec un prompt affiné.

## Superposez les jeux de données pour les agents complexes

Pour les agents qui ont besoin de plusieurs capacités, générez **des jeux de données distincts par capacité** et fusionnez-les avant l’entraînement. Cela vous donne la maîtrise du mélange :

```
dataset_a: 300 examples for TypeScript refactoring
dataset_b: 200 examples for code explanation
dataset_c: 100 examples for error diagnosis
─────────────────────────────────────────────────
merged:    600 examples, 50% / 33% / 17% split
```

Une répartition 50/33/17 oriente l’agent vers sa tâche principale tout en gardant ses capacités secondaires affûtées.

## Utilisez l’évaluation par IA pour boucler la boucle

Après l’entraînement, lancez une **évaluation par IA** sur une portion de test mise de côté (Builderforce réserve automatiquement 20 % du jeu de données). Le rapport d’évaluation indique :

- **Score de justesse** — la sortie répond-elle à l’instruction ?
- **Score de raisonnement** — la logique est-elle saine ?
- **Taux d’hallucination** — la sortie contient-elle des faits inventés ?

Si les scores sont inférieurs à la cible, regardez quelles *catégories* d’exemples ont obtenu les plus mauvais scores : ce sont les capacités qui ont besoin de davantage de données d’entraînement.

## Itérez rapidement

Les meilleurs jeux de données se construisent par itérations. Un bon flux de travail :

1. Générez 200 exemples → entraînez → évaluez
2. Repérez les points faibles dans le rapport d’évaluation
3. Générez 100 exemples ciblés pour ces points faibles
4. Fusionnez les jeux de données → réentraînez → évaluez à nouveau
5. Répétez jusqu’à ce que les scores atteignent votre seuil

Chaque itération prend environ 15 à 20 minutes de bout en bout avec le pipeline intégré au navigateur de Builderforce.

## Exportez et versionnez vos jeux de données

Exportez toujours votre jeu de données final en fichier JSONL avant d’entraîner. Vous obtenez ainsi :

- Un artefact d’entraînement reproductible
- La possibilité de réentraîner plus tard sur un autre modèle de base
- Un point de départ pour les itérations futures

Nommez vos exports de façon sémantique : `typescript-refactor-v1.jsonl`, `typescript-refactor-v2-more-edge-cases.jsonl`, et ainsi de suite.

Bonne construction de jeux de données ! Si vous avez des questions ou souhaitez partager vos meilleurs prompts, rejoignez la [communauté Discord](https://discord.gg/9gUsc2sNG6). 🎯
