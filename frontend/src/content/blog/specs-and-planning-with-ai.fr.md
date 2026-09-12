La plupart des outils de code IA commencent par le code. Ils partent du principe que vous savez déjà quoi construire. Builderforce n'est pas d'accord.

Le meilleur travail d'ingénierie commence par une réflexion claire : quel est le problème, à quoi ressemble la solution sur le plan architectural, et quelles sont les unités de travail distinctes nécessaires pour y parvenir. Builderforce vous donne des outils assistés par IA pour chacune de ces étapes, ainsi qu'une **spécification** structurée qui porte votre réflexion jusqu'aux agents qui l'exécutent.

![La pile de planification qui se resserre de l'idée au PRD, puis à la spécification d'architecture, à une liste de tâches JSON et enfin aux tâches exécutables par les agents](/blog/specs-planning.svg)

---

## La pile de planification

Builderforce organise la planification en quatre couches, chacune alimentant la suivante :

```
Idea / goal (free text)
    │
    ▼
PRD (Product Requirements Document)  ◄── AI-assisted in Brainstorm
    │
    ▼
Architecture Spec                    ◄── AI-assisted in Brainstorm
    │
    ▼
Task list (JSON)                     ◄── AI-generated from spec
    │
    ▼
Executable tasks                     ──► Agent execution on BuilderForce Agents
```

La spécification est le conteneur qui réunit ces quatre couches en un seul endroit.

---

## Commencer par le Remue-méninges

[/brainstorm](/brainstorm) est l'environnement d'idéation — une interface de discussion assistée par IA, conçue pour la réflexion produit, pas pour le code.

Ouvrez le Remue-méninges et commencez par un objectif :

> « Je veux créer une fonctionnalité qui permette aux utilisateurs d'exporter l'activité de leur projet sous forme de rapport PDF. »

L'assistant IA vous aide à :

- **Affiner l'objectif** — le cadrer, remettre en question les hypothèses, repérer les cas limites
- **Rédiger le PRD** — user stories, critères d'acceptation, exigences non fonctionnelles, éléments hors périmètre
- **Générer la spécification d'architecture** — découpage en composants, évolutions du modèle de données, conception de l'API, points d'attention pour la migration

Quand le résultat vous convient, cliquez sur **Enregistrer comme spécification** pour créer une fiche de spécification liée à votre projet.

---

## La fiche de spécification

Une spécification se trouve dans [/tasks](/tasks) → onglet **Spécifications**. Chaque spécification suit un cycle de vie par statut :

```
draft → reviewed → approved → in_progress → done
```

La spécification contient :

| Champ | Contenu |
|---|---|
| **Objectif** | Une phrase qui énonce ce que cette spécification permet d'accomplir |
| **PRD** | Le document complet des exigences produit (Markdown) |
| **Spécification d'architecture** | Le document de conception technique (Markdown) |
| **Liste de tâches** | Un tableau JSON de tâches prêtes pour le tableau |
| **Statut** | L'étape en cours dans le workflow d'approbation |
| **agentHost lié** | L'instance BuilderForce Agents qui l'exécutera |
| **Projet lié** | Le projet auquel appartient cette spécification |

---

## Générer la liste de tâches

Une fois le PRD et la spécification d'architecture rédigés, Builderforce (ou un assistant IA dans l'éditeur de spécifications) peut générer la **liste de tâches** — un découpage structuré de chaque élément de travail nécessaire pour mettre en œuvre la spécification.

Une entrée de la liste de tâches ressemble à ceci :

```json
{
  "title": "Add PDF export endpoint to the API",
  "description": "Implement POST /api/projects/:id/export/pdf that streams a generated PDF using Puppeteer",
  "priority": "medium",
  "persona": "coder",
  "dependsOn": ["Add PDF template component"]
}
```

La liste de tâches se relit dans l'éditeur de spécifications. Vous pouvez ajouter, supprimer et réordonner des tâches, ajuster les priorités et attribuer des personas (le rôle d'agent BuilderForce Agents qui doit prendre en charge chaque tâche).

---

## Passer au tableau des tâches

Quand la spécification est `approved`, cliquez sur **Créer les tâches** pour envoyer la liste vers le tableau [Tâches](/tasks). Chaque entrée de la liste devient une tâche dans le backlog.

À partir de là, les tâches suivent leur cycle de vie habituel : elles peuvent être triées, priorisées, assignées à des agentHosts précis et soumises pour exécution. La spécification reste liée à chaque tâche, ce qui vous permet de toujours remonter d'une tâche au PRD d'origine.

---

## Les workflows de spécification

Lorsque vous soumettez une spécification pour exécution (au lieu de la convertir en tâches individuelles), Builderforce crée un **workflow de spécification** — une orchestration BuilderForce Agents qui traite la spécification entière comme une seule unité de travail.

Le type de workflow de spécification `planning` enchaîne :

1. **Planificateur** — lit l'objectif de la spécification et le PRD, et produit un plan d'exécution détaillé
2. **Architecte** — examine la spécification d'architecture et rédige des notes de mise en œuvre
3. **Développeur** — met en œuvre la première série de modifications à partir du plan
4. **Relecteur** — vérifie le code au regard des critères d'acceptation de la spécification

Chaque étape apparaît dans le portail [Flux de travail](/workflows) au fil de son exécution. Vous pouvez suivre en temps réel les agents qui avancent dans la spécification.

---

## Collaborer sur les spécifications

Les spécifications sont des documents partagés : tout membre de l'équipe ayant accès au projet peut les lire, les commenter et les modifier. L'historique de la discussion du Remue-méninges est conservé avec la spécification, si bien que le raisonnement derrière chaque décision reste toujours visible.

Pour les spécifications qui touchent des systèmes de production, ajoutez un **relecteur** avant de les approuver. Le relecteur est notifié, et son approbation fait passer la spécification de `reviewed` à `approved`. C'est un point de contrôle humain léger avant le début du travail — distinct des points d'approbation au niveau de l'exécution qui se déclenchent pendant le travail des agents.

---

## Intégration avec la gestion des sources

Lorsque les tâches d'une spécification sont terminées et qu'une pull request est créée, vous pouvez rattacher la PR à la spécification :

1. Ouvrez la tâche qui a produit la PR
2. Collez l'URL de la PR GitHub dans le champ **URL de la PR**
3. Le statut de la spécification se met à jour automatiquement lorsque la PR est fusionnée

Si vous avez configuré une intégration de gestion des sources GitHub (Paramètres → Gestion des sources), BuilderForce Agents peut créer et lier les PR automatiquement, sans étape manuelle.

---

## Gouvernance et contraintes

Le document d'architecture de la spécification est aussi l'endroit idéal pour consigner la **gouvernance du projet** — les règles que vos agents doivent respecter lorsqu'ils travaillent sur ce projet. Les documents de gouvernance sont synchronisés dans le fichier `.builderforce/context.yaml` de l'agentHost au sein du contexte d'assignation : les agents les chargent au démarrage et les appliquent tout au long de l'exécution.

Exemples de règles de gouvernance :

- « Toute modification de base de données doit inclure un fichier de migration »
- « Aucune écriture directe dans la table `users` — utiliser le UserService »
- « Chaque PR doit inclure des tests pour les nouvelles fonctionnalités »
- « Ne jamais utiliser `eval()` ni le constructeur `Function()` »

Les agents dotés des compétences adéquates interprètent naturellement ces contraintes et les appliquent sans qu'il soit nécessaire de le leur rappeler.

---

## Bonnes pratiques

**Rédigez le PRD avant la spécification d'architecture.** Il est tentant de passer directement au « comment le construire » — mais un PRD clair vous oblige à répondre d'abord à « quel problème résolvons-nous ? ». Les décisions d'architecture qui découlent d'un énoncé de problème clair ont beaucoup moins de chances d'être erronées.

**Gardez des tâches petites et atomiques.** Une tâche qui prendrait 4 heures à un ingénieur expérimenté est à la bonne taille pour un agent. Les tâches plus grosses produisent souvent des implémentations tentaculaires, difficiles à relire et à annuler.

**Utilisez les personas dans la liste de tâches.** Une tâche `coder` et une tâche `reviewer` pour la même fonctionnalité garantissent que l'implémentation et la relecture ont bien lieu toutes les deux — et pas seulement l'une ou l'autre. La liste de tâches de la spécification est l'endroit idéal pour imposer cette discipline.

**Relisez la spécification d'architecture avant de l'approuver.** Les agents sont remarquablement doués pour mettre en œuvre ce que vous décrivez. Si la spécification d'architecture est fausse, l'implémentation reproduira fidèlement l'erreur.

---

## Prochaines étapes

- Ouvrez le [Remue-méninges](/brainstorm) et rédigez la spécification de votre prochaine fonctionnalité avec l'aide de l'IA
- Rendez-vous dans [Tâches](/tasks) → Spécifications pour consulter vos documents de planification actuels
- Lisez [Exécution des tâches et observabilité](/blog/task-execution-and-observability) pour comprendre ce qui se passe une fois les tâches créées et confiées aux agents
- Consultez [Points d'approbation](/blog/approval-gates-and-human-oversight) pour ajouter des points de contrôle humains aux étapes d'approbation des spécifications et d'exécution des tâches
