# Réduisez votre facture de jetons LLM grâce à un cache sémantique inter-surfaces

Toute équipe qui exploite de l’IA en production se heurte au même mur : **la facture de jetons.** Les modèles de pointe sont facturés au jeton, et la plupart des équipes paient encore et encore pour le même travail, parce que deux prompts qui *signifient* la même chose ont l’air différents sous forme de chaînes. « Résume cette PR » et « Donne-moi un résumé de cette pull request » sont un échec de cache pour un cache à correspondance exacte, et un appel de modèle complet et facturé à chaque fois.

La réponse de Builderforce.ai est un **cache sémantique indexé par plongements** : il réutilise une réponse précédente lorsqu’un nouveau prompt est une *reformulation* d’un prompt déjà traité, de sorte que le modèle de pointe n’est jamais appelé pour du travail sémantiquement répété.

> Le plus grand levier de coût de la pile est un cache sémantique qui réutilise une réponse précédente lorsqu’un nouveau prompt signifie la même chose qu’un prompt déjà traité : le modèle de pointe n’est ainsi jamais facturé deux fois pour le même travail.

![Flux montrant deux prompts reformulés qui se réduisent à un seul vecteur de plongement SSM sur l’appareil, puis traversent en cascade un cache L1 sur l’appareil et un cache L2 partagé de la passerelle — chacun renvoyant un succès réutilisé — avant qu’un échec complet n’atteigne le modèle de pointe facturé, dont la réponse est stockée dans L1 et L2](/blog/semantic-cache.svg)

## Le cache à correspondance exacte ne suffit pas

Un cache de réponses traditionnel utilise comme clé la chaîne littérale du prompt. Il n’aide que lorsque le *même* texte exact passe deux fois, ce qui, dans les charges de travail en langage naturel, est rare. Reformulez une question, ajoutez un nom de fichier, changez l’ordre de deux phrases, et le cache est perdu.

Un cache sémantique utilise comme clé le **sens**. Chaque prompt est converti en vecteur de plongement ; un nouveau prompt est un succès lorsque son vecteur est suffisamment proche (par similarité cosinus) d’un vecteur déjà stocké. Les reformulations se réduisent à la même réponse en cache. C’est la différence entre un cache qui ne se déclenche presque jamais et un cache qui absorbe une large part du travail répété.

## Deux niveaux : gratuit sur l’appareil, plus une couche partagée de passerelle

Le cache de Builderforce.ai est à deux niveaux et partagé entre les surfaces :

- **L1 — local et gratuit.** Une correspondance cosinus en processus avec des plongements SSM sur l’appareil. Il s’exécute dans l’IDE du navigateur et à l’intérieur de chaque agent. Comme les plongements sont calculés sur l’appareil (aucun appel d’API de plongement), L1 est réellement gratuit : consulter le cache ne coûte rien par recherche.
- **L2 — passerelle partagée.** Une couche adossée à KV, limitée au tenant, derrière les points d’accès `lookup`/`store` de la passerelle. Une reformulation traitée dans l’**application web** devient réutilisable par un **agent**, et inversement.

Ce partage inter-surfaces est l’idée clé. Un succès de cache n’est pas piégé dans une session ou sur un appareil. Quand un développeur pose une question dans l’IDE, la réponse est disponible plus tard pour un agent autonome : les succès de cache d’un tenant deviennent des économies pour toute la plateforme.

```
New prompt
   │
   ├─▶ L1 (on-device SSM embedding, cosine match) ── hit ──▶ reuse, $0
   │                                                │
   │                                              miss
   │                                                ▼
   ├─▶ L2 (gateway KV, tenant-scoped) ──────────── hit ──▶ reuse, no model call
   │                                                │
   │                                              miss
   ▼
Frontier model (billed) ──▶ store answer in L1 + L2
```

## Un cache portable, sans scission navigateur/Node

Les deux niveaux reposent sur le *même* `SemanticCache` portable du paquet `@builderforce/memory`. Le générateur de plongements (SSM sur l’appareil) et le backend L2 sont **injectés** : il n’y a donc pas de version navigateur et de version Node séparées qui divergeraient. L’IDE du navigateur et un agent sans interface exécutent la même logique de cache ; seules les dépendances diffèrent.

Cela compte autant pour la justesse que pour le coût : une implémentation unique signifie qu’un succès de cache se comporte de la même façon partout, et qu’il n’y a qu’un seul endroit où régler le seuil de similarité.

## Ce que cela change pour votre facture

Le cache et la performance sont de premier ordre sur Builderforce.ai, au même titre que la sécurité et la justesse. Le cache sémantique transforme trois schémas coûteux en schémas bon marché :

- **Les questions répétées au sein d’une équipe** — la deuxième personne à demander obtient gratuitement la réponse de la première.
- **Les nouvelles tentatives et réexécutions d’agents** — un agent auto-réparateur qui retente une étape ne repaie pas un sous-prompt identique.
- **Les flux de travail inter-surfaces** — le travail qui commence dans l’application web et se poursuit dans un agent partage un seul cache.

Associé à un routage de modèles qui épuise les modèles moins chers avant d’atteindre les modèles premium, le cache sémantique est la raison pour laquelle faire tourner une vraie main-d’œuvre d’agents sur Builderforce.ai ne se traduit pas par une facture qui s’envole.

## Vue d’ensemble

Le cache sémantique est une pièce de la pile d’IA sur l’appareil de Builderforce.ai : le même substrat SSM qui alimente l’entraînement LoRA dans le navigateur, la mémoire persistante des agents et le rappel. Le cache est l’endroit où ce substrat se rentabilise immédiatement : chaque succès de cache est un appel à un modèle de pointe que vous n’avez pas passé.

Si vous évaluez des plateformes d’IA sur le coût total de possession, posez la question qui fait réellement bouger la facture : *paie-t-elle deux fois pour la même réponse ?* Sur Builderforce.ai, non.

[Commencez gratuitement →](/register) · [Voir les tarifs →](/pricing) · [Visitez la plateforme →](/product)
