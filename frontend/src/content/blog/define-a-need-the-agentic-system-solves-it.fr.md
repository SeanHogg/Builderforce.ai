Une seule phrase sous-tend tout ce que construit Builderforce.ai :

> **N'importe qui définit un besoin, et le système agentique le résout.**

Cette phrase paraît simple, jusqu'à ce que l'on remarque sous combien de formes un « besoin » peut se présenter. Un responsable d'équipe veut faire relire ses procédures et obtenir la proposition d'un processus plus léger. Un développeur veut entraîner un agent sur les données propriétaires de l'entreprise et mettre en place un agent sur mesure qui prend en charge les appels du support. Un ingénieur veut que ce même agent tourne dans l'IDE, sur le poste de travail ou dans le cloud — à son choix, pas à celui de la plateforme. Un manager veut dessiner un workflow et une série de diagrammes de processus, puis intégrer ces étapes dans un agent qui les exécute.

Quatre personnes différentes, quatre besoins différents, quatre *modalités* différentes — du texte, un jeu de données, un diagramme de processus, un persona. Et pourtant, le verbe est chaque fois identique : **transformer ce besoin en un agent qui s'exécute sur la bonne surface.**

Ce verbe partagé, c'est le produit tout entier. Nous l'appelons la **primitive de compilation** — et depuis cette version, ce n'est plus un schéma accroché au mur. C'est un pipeline opérationnel que vous pouvez appeler.

![La primitive de compilation : un besoin, quelle que soit sa modalité, est compilé en un seul AgentSpec et déployé sur n'importe quelle surface](/blog/compile-primitive-spine.svg)

## La forme d'un besoin

Regardez de près les quatre exemples : la seule chose qui change réellement, c'est la *modalité d'entrée* et la *surface de sortie* :

| La personne dit… | Modalité | Devient… | Surface |
|---|---|---|---|
| « Relisez nos procédures et proposez un processus plus léger. » | Constat de diagnostic | Un processus d'amélioration exécutable | Workflow |
| « Entraînez-vous sur nos documents et répondez aux appels du support. » | Jeu de données / données propriétaires | Un agent sur mesure, ancré dans vos données | Cloud / poste de travail |
| « Faites tourner mon agent ici même, dans mon éditeur. » | (agent existant) | Le même agent, déplacé | IDE |
| « Voici le diagramme de processus — exécutez ces étapes. » | Diagramme de processus | Un agent qui exécute les étapes | Cloud / sur site |

Tout ce qui se trouve entre les deux — l'identité de l'agent, le modèle qu'il utilise, le persona qui façonne son comportement, les connaissances qu'il mobilise, la politique qui l'encadre, les étapes qu'il suit — est *toujours le même type d'objet*. C'est la spécification d'un agent. La plateforme n'en possède donc qu'une seule forme : un **AgentSpec**.

## La primitive de compilation

Deux fonctions pures, et un objet canonique entre elles :

```
   NEED  ──▶  compile(need, modality)  ──▶  AgentSpec  ──▶  deploy(AgentSpec, surface)  ──▶  running agent
```

- **`compile`** est un registre de *compilateurs de modalité* — un pour chacune : le texte libre, un jeu de données (plus vos documents propriétaires), un diagramme de processus, un persona, les constats d'un diagnostic et un pack de politiques. Chacun traduit son propre type de besoin dans le même `AgentSpec`. C'est le seul endroit de la plateforme qui a besoin de distinguer le texte des diagrammes et des jeux de données.
- **`deploy`** est un registre de *surfaces* — IDE, poste de travail, cloud durable, conteneur cloud et étape de workflow. Il prend un `AgentSpec` finalisé, résout le bon moteur via un registre d'injection de dépendances partagé et le bon transport pour la surface, puis — via `deployAndDispatch` — lance réellement l'exécution sur la machinerie qui existe déjà.

Entre les deux se trouve l'`AgentSpec` : identité, modèle, persona compilé, mémoire mobilisée, points de contrôle de politique et (quand le besoin est un processus) les étapes ordonnées. On compile de nombreuses formes *en entrée* ; on déploie vers de nombreuses surfaces *en sortie* ; une seule spec au milieu. Les deux fonctions sont du vrai code — `compile()` et `deploy()` vivent dans l'API, l'`AgentSpec` et son unique conversion canonique vivent dans le package partagé `agent-tools`, et une fine porte d'entrée HTTP (`POST /api/compile`, `POST /api/compile/run`) expose l'ensemble du pipeline.

La force de cette primitive, c'est que les quatre besoins cessent d'être quatre produits.

![Quatre portes d'entrée existantes reconverties en adaptateurs compile() qui fusionnent en un seul AgentSpec](/blog/compile-four-doors.svg)

« Entraînez-vous sur nos données » et « dessinez un diagramme de processus » sont deux adaptateurs de **compilation** qui fusionnent dans la même spec — vous pouvez donc avoir un diagramme de processus *avec* un modèle entraîné *avec* un persona *avec* une politique de gouvernance, et il s'agit toujours d'un seul agent. La fusion est littérale : chaque adaptateur produit la portion de la spec qu'il connaît, et la plateforme les réunit en une seule. « Exécutez-le dans mon IDE » et « exécutez-le dans le cloud » sont deux cibles de **déploiement** — l'agent que vous avez entraîné est donc celui qui tourne dans votre éditeur, sans second build.

## La porte d'entrée en langage courant

La modalité qui manquait à la plateforme est la plus humaine de toutes : **le langage courant.** « Un agent qui trie les tickets de facturation et répond aux questions de remboursement à partir de la documentation de notre centre d'aide » n'avait jusqu'ici nulle part où aller. Il dispose désormais d'une porte d'entrée sur [`/compile`](/compile) : vous saisissez le besoin en toutes lettres, un extracteur le traduit en `AgentSpec` (identité, compétences, modèle routé automatiquement), `deploy()` détermine où il s'exécutera, et — si vous cliquez sur *Compiler et exécuter* — la plateforme conduit un véritable premier échange via la passerelle, avec le prompt système compilé. Définissez un besoin ; regardez l'agent répondre.

Lorsque le besoin porte des *étapes* plutôt qu'une conversation — un diagramme de processus, ou le flux d'amélioration proposé par un diagnostic — l'action « compiler et exécuter » ne lance pas de chat. Elle instancie un véritable workflow : les étapes compilées deviennent des `workflow_tasks` que la machinerie existante de prise en charge et de relais exécute. Le même appel `POST /api/compile/run` est accessible à n'importe quel client : cette porte d'entrée est un endpoint, pas seulement une page.

## Pourquoi une seule colonne vertébrale compte

Lorsque le persona, la mémoire et la politique vivent *sur la spec* plutôt qu'à l'intérieur d'une seule porte d'entrée, ils atteignent chaque surface sans effort supplémentaire.

![Le persona, la mémoire et la politique vivent sur l'AgentSpec et atteignent chaque surface de manière identique](/blog/compile-governance-everywhere.svg)

La température d'un persona modifie le comportement de l'agent, qu'il s'exécute comme étape de workflow ou comme agent cloud. Les documents propriétaires sur lesquels vous l'avez entraîné sont mobilisés lors de l'inférence, où que l'agent s'exécute — jusqu'à un simple appel via le SDK OpenAI standard qui adresse l'agent par l'identifiant de son modèle.

Et un point de contrôle de gouvernance est *appliqué*, pas seulement suggéré. Le même point de contrôle compilé est évalué à la jonction des outils de chaque moteur — la boucle cloud durable, le runner sur site et la boucle de l'IDE dans l'éditeur — par une seule et même décision partagée `evaluatePolicyGate`. `block` refuse l'outil et demande à l'agent d'emprunter une autre voie ; `require-approval` met l'exécution en pause, sollicite un humain et reprend dès qu'il a répondu. Définissez `block` sur l'outil `shell` une seule fois, et il bloque le shell dans votre éditeur exactement comme lors d'un cycle dans le cloud — parce que le point de contrôle voyage avec l'agent, et non avec l'endroit où il s'exécute. C'est tout l'intérêt de placer la politique sur la spec plutôt que dans une porte d'entrée : il est impossible qu'une règle s'applique sur une surface et pas sur une autre, puisqu'il n'existe qu'une seule règle et un seul endroit où elle est vérifiée.

C'est toute la différence entre une plateforme et un empilement de fonctionnalités. Un empilement de fonctionnalités comprend un outil d'entraînement, un générateur de workflows, un éditeur de personas et un runtime, chacun avec sa propre idée de ce qu'est un agent. Une plateforme n'a qu'une seule idée de ce qu'est un agent, et vous laisse y arriver par n'importe quelle direction et le déployer sur n'importe quelle surface.

## Ce que vous pouvez faire dès aujourd'hui

Ce n'est pas une vision partant d'une page blanche, et ce n'est plus une vision partielle — la colonne vertébrale est connectée de bout en bout :

- **Définissez un besoin en langage courant** et obtenez un agent opérationnel — `/compile` et `POST /api/compile/run`.
- **Compilez n'importe quelle modalité en un seul `AgentSpec`** — du texte, un jeu de données avec vos documents propriétaires ingérés, un diagramme de processus dessiné à la main, un persona compilé, les constats d'un diagnostic ou un pack de politiques — et **empilez-les** en un seul agent.
- **Déployez *et lancez* cette spec unique.** `deploy()` résout le moteur, le transport et les entrées d'exécution pour n'importe quelle surface ; `deployAndDispatch()` la *démarre* ensuite — une spec comportant des étapes devient un workflow actif, une spec cloud un agent cloud en cours d'exécution, avec ses points de contrôle de gouvernance déjà dans la charge utile.
- **Transformez un diagnostic en action** — un constat de maturité se compile en un processus d'amélioration ordonné et exécutable, au lieu d'un rapport statique.
- **Ancrez un appel OpenAI standard** — adressez un agent entraîné par son identifiant `builderforce/workforce-<id>` sur l'endpoint standard `/v1/chat/completions`, et il mobilise vos documents ingérés pour cette requête, avec le même ancrage que le chemin de chat dédié.
- **Gouvernez depuis la spec** — un point de contrôle `block` ou `require-approval` défini une seule fois est appliqué à la jonction des outils sur les runners cloud, sur site et IDE : refusé ou soumis à validation humaine, pas simplement recommandé.

La primitive de compilation est la colonne vertébrale, et tout ce qui existait déjà repose désormais sur elle. « Définissez un besoin, le système agentique le résout » n'est plus quatre portes distinctes — c'est une seule porte qui s'adapte à la forme qu'a prise votre besoin, et qui ouvre sur la surface où vit votre travail.

Vous décrivez le résultat attendu, dans la langue qui vous est la plus naturelle, et une main-d'œuvre d'agents — gouvernée, ancrée dans vos données et sur la surface de votre choix — va le chercher. Voilà ce que fait désormais la plateforme.
