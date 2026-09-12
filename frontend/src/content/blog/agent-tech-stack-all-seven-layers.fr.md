Tous les articles qui expliquent la « pile technologique des agents IA » dessinent le même schéma : sept couches, chacune avec sa mission, chacune un endroit où l'agent peut casser. Le modèle de fondation fait les gros titres ; ce sont les six couches en dessous qui décident si l'ensemble fonctionne réellement en production.

Le problème de la version canonique de ce schéma, c'est qu'il s'agit d'une *liste de courses*. Choisissez un fournisseur de modèle. Greffez LangGraph. Ajoutez une bibliothèque de mémoire. Montez une base de données vectorielle. Branchez les outils. Abonnez-vous à un SaaS d'observabilité. Conteneurisez et déployez. Sept couches, sept fournisseurs, sept modes de défaillance — et une montagne de code de liaison pour faire tenir les jointures.

Builderforce.ai, ce sont les mêmes sept couches — construites comme **une seule plateforme**. Cet article passe chaque couche en revue, la met en regard de ce que Builderforce.ai exécute réellement, et dit franchement quelles sont les deux couches que nous venons de renforcer pour passer de « on l'a » à « on fait mieux ».

![La pile d'agents à sept couches, implémentée de bout en bout par Builderforce.ai](/blog/agent-stack-seven-layers.svg)

## Le bilan

| # | Couche | La conception de référence | Builderforce.ai |
|---|-------|----------------------|-----------------|
| 1 | Modèle de fondation | Choisir un seul fournisseur | Passerelle multi-fournisseurs prise en charge, routage + repli |
| 2 | Orchestration | Boucle ReAct LangGraph | Boucle ReAct native + orchestrateur multi-agents (rôles, DAG, relances) |
| 3 | Mémoire | Une bibliothèque pour la mémoire de travail + épisodique | Les quatre types de mémoire, natifs SSM, Write-Through Cognition |
| 4 | Base vectorielle & RAG | Pinecone/Chroma + embeddings | **Découpage + hybride (dense+BM25) + reclassement** sur LanceDB ou le store SSM |
| 5 | Outils & intégrations | `@tool` + MCP | Registre contrôlé par capacités, serveur MCP, navigateur, plus de 10 canaux |
| 6 | Observabilité & évaluation | LangSmith/Langfuse | Traçage + mesure des coûts **+ fidélité/hallucination + dérive** |
| 7 | Déploiement | Docker + une file d'attente | Cloudflare Workers + Durable Objects + Containers + Docker |

Cinq de ces couches dépassaient déjà la conception de référence. Deux — le RAG et l'évaluation — étaient *correctes mais minces, dans la moyenne*. Nous avons comblé l'écart sur les deux. Voici la visite.

## Couche 1 — Modèle de fondation

Builderforce.ai traite le modèle comme une **ressource interchangeable et routée**, pas comme un engagement définitif. Sa passerelle compatible OpenAI expose les fournisseurs disponibles dans le catalogue actuel et prend en charge le routage configuré, le repli, vos propres identifiants (BYO) et le contrôle du raisonnement. La disponibilité varie selon l'offre, la région, les identifiants et l'environnement d'exécution.

**Verdict : au-delà.** Vous ne misez pas votre produit sur la feuille de route d'un seul fournisseur.

## Couche 2 — Orchestration

Une simple boucle ReAct (réfléchir → agir → observer), c'est le minimum. Builderforce.ai exécute cette boucle nativement, puis y ajoute un **orchestrateur multi-agents** : des rôles spécialisés (créateur, relecteur, générateur de tests, analyste de bugs…), un graphe de dépendances entre tâches, des relances bornées avec auto-réparation, et un état durable qui survit au redémarrage d'un processus. La même boucle tourne sur site et dans le cloud, avec une passe de relecture contradictoire intégrée.

**Verdict : au-delà.** Une équipe coordonnée et gouvernée vaut mieux qu'un agent seul dans une boucle.

## Couche 3 — Mémoire

La pile de référence fournit généralement une mémoire de travail + épisodique issue d'un framework. Builderforce.ai livre **les quatre** — de travail, épisodique, sémantique, procédurale — et elles sont *natives SSM* : la connaissance est écrite directement dans un modèle (Evermind) par distillation en ligne, au lieu d'être simplement ajoutée à un store, avec en dessous un store de faits persistant d'une session à l'autre.

**Verdict : au-delà.** Une mémoire qui *apprend*, pas seulement une mémoire qui *consigne*.

## Couche 4 — Base vectorielle & RAG  ✦ renforcée dans cette version

C'est ici que nous avons été honnêtes avec nous-mêmes. Builderforce.ai disposait d'une recherche vectorielle (LanceDB + embeddings, plus un store d'embeddings SSM sans aucune API) — mais *uniquement par similarité cosinus*. La pile RAG de manuel fait trois choses que la seule similarité cosinus ne fait pas : elle **découpe** les documents en passages précis, elle mène une recherche **hybride** (vecteurs denses *et* BM25 creux, pour ne pas perdre les jetons exacts — identifiants, codes d'erreur, noms rares) et elle **reclasse** les résultats selon leur pertinence et leur diversité.

Nous avons donc intégré ces trois capacités à la couche mémoire canonique :

![Recherche hybride : signaux denses et creux, fusionnés par RRF et reclassés par MMR](/blog/hybrid-retrieval.svg)

- **Découpage** — un découpeur récursif par caractères avec chevauchement, pour que les grands documents deviennent des passages cohérents.
- **BM25** — un score lexical Okapi en parallèle de la passe vectorielle dense.
- **Reciprocal Rank Fusion** — fusionne les deux classements sur le *rang*, et non sur des scores bruts incomparables.
- **Reclassement MMR** — arbitre entre pertinence et nouveauté pour que le top-k ne soit pas composé de cinq quasi-doublons.

Le système se dégrade proprement : aucun modèle d'embedding disponible → BM25 seul ; aucun recouvrement lexical → dense seul. Il est branché à la fois sur le store de mémoire SSM et sur le chemin de mémoire à long terme LanceDB, avec découpage à l'écriture.

**Verdict : désormais au-delà.** L'hybride + reclassement, c'est précisément l'étape que la plupart des piles RAG artisanales n'atteignent jamais.

## Couche 5 — Outils & intégrations

Un outil est une fonction typée que le modèle peut choisir d'appeler. Builderforce.ai dispose d'un **registre d'outils contrôlé par capacités** (chaque outil déclare les capacités dont il a besoin ; l'environnement d'exécution les filtre par surface — cloud, conteneur, sur site — pour que le même jeu d'outils tourne partout), d'un **serveur MCP** qui expose les outils aux IDE externes, de l'automatisation de navigateur Playwright, d'outils web/recherche/git/shell, de plus de 10 canaux de messagerie et d'un SDK de plugins pour les outils sur mesure.

**Verdict : au-delà.** Un seul contrat d'outil, toutes les surfaces, aucune curation manuelle surface par surface.

## Couche 6 — Observabilité & évaluation  ✦ renforcée dans cette version

Les LLM échouent en silence — une réponse hallucinée renvoie quand même un HTTP 200. Builderforce.ai traçait déjà chaque appel LLM, mesurait les jetons et les coûts, et notait les exécutions sur leur *résultat* (la PR a-t-elle été fusionnée, la CI est-elle passée, combien d'étapes, combien de dépenses). Ce qu'il ne faisait pas, c'était vérifier si la réponse était **fondée et pertinente** — les métriques d'évaluation sémantique que tous les outils d'observabilité LLM proposent désormais.

Nous les avons ajoutées :

![Évaluation et dérive : fidélité, pertinence, hallucination — plus des alertes de régression](/blog/evaluation-and-drift.svg)

- **Fidélité** — la réponse est-elle étayée par son contexte ?
- **Pertinence de la réponse / du contexte** — répond-elle à la question ; le contexte récupéré était-il pertinent ?
- **Taux d'hallucination** — la part de la réponse qui n'est *pas* fondée.

Deux moteurs, une seule interface : un **évaluateur lexical sans coût** s'exécute en ligne sur chaque exécution cloud (aucun appel LLM supplémentaire), et une version **LLM-as-judge** est disponible à la demande via `/api/eval`, facturée par la même passerelle mesurée que n'importe quelle autre complétion. Les scores sont conservés dans l'enregistrement de l'exécution, et un **moniteur de dérive** — z-score de décalage de moyenne plus Population Stability Index — compare une fenêtre de référence à une fenêtre récente pour chaque couple (type d'action × modèle) et lève une alerte quand la qualité régresse. Il tourne chaque jour via cron et à la demande via `/api/eval/drift`.

**Verdict : désormais au-delà.** Une régression silencieuse de la qualité devient une alerte, pas un tableau de bord tout vert.

## Couche 7 — Déploiement

La conception de référence, c'est Docker plus une API synchrone ou une file asynchrone. Builderforce.ai tourne sur **Cloudflare Workers + Durable Objects** (une boucle d'agent durable qui franchit les limites de délai du serverless) plus des **Containers** pour les exécutions qui nécessitent un shell, avec Docker pour le développement local. La mise en cache est une priorité — lecture traversante (L1 dans l'isolat + L2 KV), mise en cache des prompts et cache sémantique des réponses — aux côtés de plafonds de coûts par tenant et de budgets d'étapes.

**Verdict : au-delà.** Durable, mis en cache, plafonné en coûts et géré.

## L'essentiel

Comprendre toute la pile ne signifie pas assembler sept fournisseurs en priant pour que les jointures tiennent. Builderforce.ai, ce sont les sept couches réunies en un système unique, gouverné et observable — et depuis cette version, il ne se contente pas d'*avoir* chaque couche : il **égale ou dépasse** la conception de référence à chacune d'elles. Les deux couches qui n'étaient que conventionnelles — la recherche RAG et l'évaluation sémantique — sont désormais respectivement hybrides-et-reclassées, et notées en fidélité avec détection de dérive.

C'est toute la différence entre une pile qu'on dessine et une pile qu'on livre.

> Envie d'aller plus loin ? Découvrez le modèle [Evermind](/evermind) derrière la couche mémoire, ou [commencez à construire gratuitement](/register).
