> **Mise à jour produit :** Remue-méninges, le Générateur de workflows et le lanceur d'IDE ne sont plus des destinations de création principales distinctes. Leurs capacités apparaissent désormais sous forme d'objets vivants dans un [Canvas de création](/creation-canvas). Les liens existants restent compatibles, mais tout nouveau travail devrait commencer dans une session de création.

Tout produit commence par une idée et se termine — avec un peu de chance — par quelque chose de livré. C'est dans l'écart entre ces deux moments que meurent la plupart des idées : exigences floues, dérive du périmètre, les mauvaises personnes sur les mauvais sujets.

Builderforce est conçu pour réduire cet écart. Cet article retrace le workflow multi-surfaces d'origine et explique les concepts qui ont mené à son successeur : une seule session de création visuelle où la conversation avec Brain, les prototypes, le code, les projets, les tâches et les agents recrutés restent connectés.

![Pipeline d'idéation allant du Remue-méninges à la structuration dans l'IDE, puis à la Chronologie et au recrutement d'agents de l'Effectif, jusqu'à la revue et la livraison](/blog/product-ideation.svg)

---

## Le scénario

Imaginez que vous voulez créer un **outil SaaS qui aide les freelances à suivre leur temps et à générer automatiquement leurs factures**. Vous avez le germe d'une idée, mais rien d'autre : ni spécification, ni design, ni équipe.

Utilisons Builderforce pour transformer ce germe en plan d'action.

---

## Étape 1 : capturer et développer l'idée avec Remue-méninges

Partez de votre [tableau de bord](/dashboard), créez un nouveau projet — appelez-le *« Outil de suivi du temps et de facturation pour freelances »* — puis ouvrez l'onglet **Remue-méninges**.

Remue-méninges est un espace d'idéation animé par l'IA. Contrairement à un document vierge, il participe activement : il pose des questions de clarification, fait émerger les hypothèses et développe votre idée en livrables structurés.

### Mener une session de remue-méninges

Saisissez votre idée de départ dans l'invite :

> « Un outil SaaS permettant aux freelances de suivre leur temps facturable et de générer automatiquement leurs factures. Je veux qu'il soit simple, adapté au mobile et intégré à Stripe pour les paiements. »

Builderforce répond par un développement structuré :

- **Problème utilisateur central** — les freelances perdent du chiffre d'affaires parce que le suivi est manuel et que la création des factures prend du temps
- **Utilisateurs cibles** — freelances indépendants, petites agences (2 à 10 personnes)
- **Principaux jobs-to-be-done** — démarrer/arrêter des minuteurs, rattacher le temps à des clients/projets, générer des factures PDF, encaisser les paiements
- **Pistes de différenciation** — taux de facturation suggérés par l'IA, relances automatiques, synchronisation avec le calendrier
- **Risques et hypothèses** — adoption de Stripe, usages sur mobile, disposition à payer face aux alternatives gratuites

### Affiner avec des questions de suivi

Les sessions de remue-méninges sont conversationnelles. Vous pouvez aller plus loin :

> « Quels sont les trois principaux concurrents, et comment me différencier ? »

> « Quelle est la v1 la plus simple possible qui apporte une vraie valeur ? »

> « Découpe le MVP en user stories. »

Chaque réponse s'appuie sur le contexte précédent : votre idéation est cumulative plutôt que fragmentée. Au bout d'une session de 20 minutes, vous disposez généralement de :

- un **énoncé du problème** clair
- une **liste de fonctionnalités** priorisée
- un ensemble de **user stories** prêtes pour le backlog
- un premier **registre des risques**

Exportez la session en markdown directement dans l'espace de travail IDE de votre projet.

---

## Étape 2 : structurer le plan dans l'IDE

Ouvrez l'onglet **IDE**. Vous trouverez l'export du remue-méninges dans l'explorateur de fichiers. Utilisez maintenant le chat IA de l'IDE pour transformer ce markdown brut en livrables de projet structurés.

### Générer un document d'exigences produit

Demandez au chat IA :

> « Transforme le résultat du remue-méninges en PRD structuré, avec les sections : Vue d'ensemble, Objectifs, Non-objectifs, User stories, Contraintes techniques et Indicateurs de succès. »

L'IA rédige le PRD directement dans l'éditeur. Vous le relisez, le modifiez et l'enregistrez sous `docs/PRD.md`.

### Esquisser une architecture technique

Continuez dans le même fil de discussion :

> « À partir du PRD, propose une architecture technique légère : les services nécessaires, la manière dont ils communiquent et la forme du modèle de données. »

La réponse vous fournit un premier diagramme d'architecture (en syntaxe Mermaid) et une stack proposée. Enregistrez-le sous `docs/ARCHITECTURE.md`.

### Créer un backlog

Demandez un backlog dans un format structuré :

> « Convertis les user stories du PRD en backlog sous forme de tableau markdown avec les colonnes : ID de story, Description, Priorité (P0/P1/P2), Effort estimé (S/M/L), Dépendances. »

Relisez le tableau, ajustez les priorités et enregistrez-le sous `docs/BACKLOG.md`.

Vous disposez désormais d'une documentation de projet vivante, générée et gérée entièrement depuis l'IDE — sans aucun outil supplémentaire.

---

## Étape 3 : établir la chronologie

Passez à l'onglet **Chronologie**. C'est le planificateur visuel de jalons de Builderforce.

Backlog en main, créez vos jalons :

| Jalon | Objectif | Échéance |
|---|---|---|
| **M1 – Minuteur de base** | Démarrer/arrêter le minuteur, rattacher à un client/projet | Semaine 2 |
| **M2 – Génération des factures** | Générer et télécharger des factures PDF | Semaine 4 |
| **M3 – Intégration Stripe** | Encaissement des paiements et suivi de leur statut | Semaine 6 |
| **M4 – Finitions mobiles** | UI responsive, prise en charge PWA | Semaine 8 |
| **M5 – Lancement** | Liste d'invitations bêta, onboarding, page de tarifs | Semaine 10 |

La vue Chronologie vous présente le plan sous forme de diagramme de Gantt. Vous pouvez faire glisser les jalons pour ajuster les dates et signaler les éléments bloqués. Elle devient votre source unique de vérité pour le rythme de livraison.

---

## Étape 4 : recruter des agents spécialisés dans l'Effectif

Une fois le plan clair, la question suivante se pose : *qui fait le travail ?*

Plutôt que d'embaucher immédiatement des développeurs (ou d'essayer de tout faire vous-même), c'est là que le [registre de l'Effectif](/workforce) change l'équation économique.

### Recruter un agent de recherche UX

Votre première inconnue, c'est le comportement des utilisateurs. Avant d'écrire la moindre ligne de code, vous voulez valider vos hypothèses sur la façon dont les freelances suivent réellement leur temps aujourd'hui.

Cherchez un agent **Recherche UX** dans l'Effectif. Recrutez `ux-researcher-v2` dans votre projet. Confiez-lui une tâche :

> « Analyse le PRD et identifie les cinq hypothèses sur le comportement des utilisateurs qui présentent le plus grand risque produit. Pour chacune, propose une méthode de validation rapide (sondage, test de prototype, analyse concurrentielle, etc.). »

En quelques minutes, vous obtenez un plan de recherche structuré — sans avoir à salarier un chercheur UX.

### Recruter un agent d'architecture frontend

Pour le développement technique, recrutez un spécialiste **Architecture frontend**. Confiez-lui :

> « À partir du document d'architecture, crée la structure d'un projet Next.js 15 avec TypeScript, Tailwind CSS, une intégration Stripe et un backend Supabase. Crée l'arborescence initiale des fichiers et le plan de routage. »

L'agent produit une base de projet et un guide d'installation détaillé. Votre propre temps de développement chute considérablement, car les décisions structurelles sont déjà prises.

### Recruter un agent rédacteur

Un produit sans mots est invisible. Recrutez un agent **Rédacteur** et confiez-lui :

> « Rédige le titre, le sous-titre, les descriptions de fonctionnalités (trois fonctionnalités) et une section tarifs pour la page d'accueil d'un SaaS de suivi du temps destiné aux freelances indépendants. Ton : chaleureux, professionnel, sans jargon. »

Itérez sur le texte dans l'IDE jusqu'à ce qu'il vous convienne. Exportez-le, prêt à être transmis à l'équipe design.

### Coordonner via le panneau des tâches

À mesure que davantage d'agents travaillent dans votre projet, le **panneau des tâches** devient votre centre de coordination. Chaque tâche indique :

- l'agent assigné
- le statut actuel (en file d'attente, en cours, terminée, bloquée)
- les livrables en entrée et en sortie
- le temps passé et le coût en tokens

Vous voyez d'un coup d'œil si la recherche UX, la base technique et les textes avancent en parallèle — exactement comme vous suivriez le tableau de sprint d'une vraie équipe.

---

## Étape 5 : relire, itérer et livrer

L'idéation n'est pas un événement ponctuel. À mesure que le projet avance :

- **Revenez à Remue-méninges** lorsque vous arrivez à un point de décision qui demande un regard neuf
- **Mettez à jour le PRD et le backlog** dans l'IDE au fil de l'évolution des exigences
- **Recrutez de nouveaux agents spécialisés** à mesure que de nouveaux besoins de compétences apparaissent
- **Réajustez la Chronologie** à mesure que vous découvrez ce qui prend plus de temps que prévu

Tout le cycle — idéer, planifier, assigner, construire, relire — se déroule au sein d'un seul projet Builderforce. Pas de changement d'outil, pas de perte de contexte.

---

## L'avantage cumulatif

Voici l'idée clé : **chaque agent que vous entraînez et chaque session que vous menez rendent la plateforme plus intelligente pour vous**.

- Les sessions de remue-méninges deviennent une base de connaissances consultable de votre réflexion
- Les agents entraînés intègrent durablement les conventions et les préférences de votre équipe
- Les agents publiés par la communauté dans l'Effectif deviennent meilleurs et plus spécialisés au fil du temps

Commencer votre idéation ici, ce n'est pas seulement boucler ce projet plus vite : c'est bâtir une mémoire organisationnelle qui accélère chacun des projets suivants.

---

## Lancez votre prochaine idée

1. **[Créez un nouveau projet](/dashboard)** et ouvrez l'onglet Remue-méninges
2. Déposez votre idée de départ et laissez l'IA la développer
3. Exportez vers l'IDE et structurez votre PRD et votre backlog
4. Planifiez les jalons dans la Chronologie
5. Recrutez des agents spécialisés dans le [registre de l'Effectif](/workforce) pour exécuter le travail en parallèle

Le meilleur moment pour commencer, c'était hier. Le deuxième meilleur moment, c'est maintenant. 🚀
