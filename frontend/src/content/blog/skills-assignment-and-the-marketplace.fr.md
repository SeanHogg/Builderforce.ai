Les capacités intégrées d'un agent ne sont qu'un point de départ. Les compétences sont la façon d'étendre ces capacités — en injectant des connaissances métier, des intégrations d'API, des workflows structurés et des comportements spécialisés, sans réentraîner le modèle sous-jacent.

Builderforce propose deux façons de doter vos agents de compétences : la **Marketplace de compétences** (publiées par la communauté, à parcourir et à affecter) et les **compétences personnalisées** (vous les créez, elles vous appartiennent). Les deux suivent le même modèle d'affectation, et les deux sont chargées automatiquement sur vos instances BuilderForce Agents au démarrage.

![Le système de compétences : parcourez ou publiez des compétences sur la marketplace, affectez-les au niveau du tenant, de l'agentHost, du projet ou de la tâche, la tâche ayant priorité, et l'ensemble fusionné se charge dans le registre de compétences de chaque agentHost au démarrage](/blog/skills-marketplace.svg)

---

## Qu'est-ce qu'une compétence ?

Une compétence est une extension de capacités structurée. Dans sa forme la plus simple, c'est un **fragment de prompt système** qui donne à un agent des connaissances ou des instructions précises. Les compétences plus élaborées comprennent :

- **Des définitions d'outils** — des signatures de fonctions structurées que l'agent peut appeler (par exemple une compétence API GitHub qui définit `create_pr`, `add_comment`, `merge_branch`)
- **Des modèles de workflow** — des procédures pas à pas que l'agent suit (par exemple une compétence de réponse aux incidents qui définit la boucle triage → diagnostic → correction → communication)
- **Des connaissances métier** — des documents de référence intégrés que l'agent exploite au moment de l'inférence (par exemple une compétence `typescript-strict` qui embarque les conventions TypeScript de votre équipe)

Une fois une compétence chargée, l'agent se comporte comme s'il savait déjà tout ce qu'elle contient. Aucun prompt nécessaire.

---

## La Marketplace de compétences

Rendez-vous sur [/skills](/skills) pour parcourir les compétences publiées par la communauté.

Chaque fiche de compétence affiche :

| Champ | Description |
|---|---|
| **Nom et slug** | Identifiant unique utilisé pour l'affectation (`org/skill-name`) |
| **Description** | Ce que la compétence apprend à l'agent |
| **Catégorie** | Domaine général (développement, opérations, marketing, etc.) |
| **Tags** | Tags de capacités détaillés, pour le filtrage |
| **Version** | Version publiée actuelle |
| **Téléchargements** | Nombre de fois où elle a été affectée |
| **J'aime** | Signal de qualité de la communauté |
| **Auteur** | Qui l'a publiée |

### Parcourir et filtrer

La recherche de la marketplace prend en charge :

- **Le texte intégral** — recherche dans le nom, la description et les tags
- **Le filtre par catégorie** — pour affiner par domaine
- **Le filtre par tag** — pour trouver des compétences dotées de tags de capacités précis
- **Le tri** — par téléchargements, par j'aime ou par nouveauté

### Publier une compétence

Si vous avez créé pour vos agents une compétence dont d'autres équipes pourraient profiter :

1. Allez sur [/skills](/skills) → **Publier la compétence**
2. Renseignez le nom, le slug, la description, la catégorie et les tags
3. Collez la définition de votre compétence (fragment de prompt système, schémas d'outils ou modèle de workflow)
4. Cliquez sur **Publier**

Les compétences publiées sont immédiatement consultables dans la marketplace. Vous pouvez mettre à jour les métadonnées et le contenu à tout moment, et les versions publiées sont suivies afin que les utilisateurs puissent se fixer sur une version précise.

---

## Affecter des compétences

Une compétence ne fait rien tant qu'elle n'est pas **affectée** — c'est-à-dire reliée aux agents ou aux agentHosts qui doivent l'utiliser. Builderforce repose sur un modèle d'affectation à deux niveaux.

### Affectations au niveau du tenant

Une **affectation au niveau du tenant** rend une compétence disponible pour **tous les agentHosts** de votre organisation. Utilisez-la pour les compétences que chaque agent doit posséder — vos standards de code, vos conventions d'API, vos outils propres à l'entreprise.

Gérez les affectations au tenant depuis [/skills](/skills) → onglet **Affectations au tenant** :

1. Recherchez ou collez le slug de la compétence
2. Cliquez sur **Affecter à tous les agentHosts**
3. La compétence apparaît dans le registre de compétences de chaque agentHost à son prochain démarrage

### Affectations au niveau de l'agentHost

Une **affectation au niveau de l'agentHost** remplace ou ajoute une compétence pour une instance BuilderForce Agents précise. Utilisez-la pour équiper un agentHost spécialisé — votre `frontend-workstation` peut disposer de compétences React et Tailwind dont aucun autre agentHost n'a besoin.

Gérez les affectations d'un agentHost depuis son panneau de détail → onglet **Compétences** :

1. Cliquez sur **Affecter une compétence**
2. Recherchez et sélectionnez la compétence
3. L'affectation prend effet au prochain démarrage de l'agentHost

Les affectations au niveau de l'agentHost **priment** sur celles du tenant lorsque le même slug de compétence apparaît aux deux niveaux : la configuration propre à l'agentHost l'emporte.

---

## Chargement des compétences au démarrage

Lorsque BuilderForce Agents démarre et qu'une connexion Builderforce est configurée, il récupère la liste fusionnée des compétences :

```
GET /api/agent-hosts/:id/skills
```

Celle-ci renvoie l'union de :
1. Toutes les affectations de compétences au niveau du tenant
2. Toutes les surcharges au niveau de l'agentHost pour cet agentHost précis

L'ensemble fusionné est chargé dans le **registre de compétences** local de l'agentHost et reste disponible pour les agents pendant toute la durée de vie du processus. Si vous ajoutez une nouvelle affectation dans le portail, l'agentHost la prend en compte à son prochain redémarrage.

Pour vérifier quelles compétences un agentHost en cours d'exécution a chargées, consultez ses journaux de démarrage :

```
[skill-registry] loaded 4 skill(s): typescript-strict, github-api, test-runner, our-coding-standards
```

Ou interrogez le portail depuis l'onglet **Compétences** de l'agentHost, qui affiche l'état des affectations en temps réel.

---

## Affectations d'artefacts : le modèle de portée complet

Les compétences sont un type d'**artefact** parmi d'autres. Builderforce utilise un système unifié d'**affectation d'artefacts** qui fonctionne pour les compétences, les personas et les contenus, à n'importe quel niveau de portée :

| Portée | S'applique à |
|---|---|
| `tenant` | Tous les agentHosts et agents de l'organisation |
| `agentHost` | Une instance BuilderForce Agents précise |
| `project` | Tout agentHost qui travaille sur un projet donné |
| `task` | L'agent qui exécute une tâche donnée |

La résolution des portées suit un ordre de priorité : `task > project > agentHost > tenant`. Si une compétence précise est affectée à une tâche, cette affectation l'emporte, même si l'affectation au niveau du tenant dit autre chose.

Gérez les affectations d'artefacts depuis [/skills](/skills) → **Affectations d'artefacts**, où vous pouvez affecter n'importe quel type d'artefact à n'importe quelle portée depuis une interface unique.

---

## Créer des compétences personnalisées

Les compétences ne sont pas réservées à la marketplace. Pour vos outils internes, vos workflows propriétaires ou vos conventions maison, créez des compétences privées qui ne quittent jamais votre tenant.

Une définition de compétence comporte trois parties :

**1. Fragment de prompt système**
```markdown
## Code Style
Always use TypeScript strict mode. Prefer `const` over `let`.
Never use `any` — use `unknown` and narrow with type guards.
All async functions must handle errors explicitly.
```

**2. Définitions d'outils (facultatif)**
```json
{
  "name": "create_github_pr",
  "description": "Create a pull request on GitHub",
  "input_schema": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "branch": { "type": "string" },
      "base": { "type": "string", "default": "main" },
      "body": { "type": "string" }
    },
    "required": ["title", "branch"]
  }
}
```

**3. Métadonnées**
```json
{
  "name": "Our TypeScript Standards",
  "slug": "acme/typescript-standards",
  "category": "development",
  "tags": ["typescript", "code-style", "internal"],
  "version": "1.0.0"
}
```

Les compétences privées (publiées sans le drapeau `public`) ne sont visibles que par votre tenant.

---

## Compétences déclenchées par cron

Les compétences peuvent aussi alimenter des **tâches planifiées**. Si vous disposez d'une compétence qui produit un résumé quotidien du stand-up, un audit hebdomadaire des dépendances ou une exécution nocturne des tests, associez-la à une tâche cron depuis le [tableau de bord](/dashboard) → onglet **Cron** :

```
Schedule: 0 9 * * 1-5   (9am Monday–Friday)
Task: "Run the daily standup summary skill for project X"
```

Le planificateur cron de l'agentHost assigné récupère le calendrier des tâches au démarrage et exécute la tâche au bon moment. Aucune infrastructure cron externe n'est nécessaire.

---

## Bonnes pratiques

**Une compétence, une préoccupation.** Une compétence qui couvre TypeScript, les tests, GitHub et le déploiement est difficile à maintenir et à déboguer. Découpez-la en compétences ciblées (`typescript-style`, `jest-patterns`, `github-actions`) et combinez-les par le biais des affectations.

**Versionnez vos compétences avant de les mettre à jour.** Si une mise à jour risque de modifier le comportement des agents, incrémentez la version avant de publier. Les utilisateurs fixés sur `v1.2` ne sont pas concernés ; ceux qui veulent le nouveau comportement mettent explicitement à jour leur affectation.

**Testez les compétences isolément avant de les affecter à tout le tenant.** Affectez d'abord une nouvelle compétence à un seul agentHost, lancez quelques tâches, vérifiez le résultat. Une fois en confiance, étendez-la au niveau du tenant.

**Associez personas et compétences.** Une compétence transmet des connaissances ; un persona façonne la voix et le style de décision. La combinaison des deux — un agentHost doté de votre compétence TypeScript et de votre persona « ingénieur senior » — produit des résultats plus cohérents et plus fidèles à votre marque que l'un ou l'autre seul.

---

## Prochaines étapes

- Parcourez la [Marketplace de compétences](/skills) et affectez votre première compétence communautaire
- Lisez [Orchestration multi-agents](/blog/multi-agent-orchestration) pour voir comment les agentHosts dotés de compétences s'intègrent dans un workflow
- Explorez [Gestion de flotte](/blog/fleet-management-and-agentHost-routing) pour comprendre comment les compétences se combinent aux déclarations de capacités au niveau de l'agentHost
