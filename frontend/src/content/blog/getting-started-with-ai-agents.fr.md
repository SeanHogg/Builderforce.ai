# Premiers pas avec les agents IA sur Builderforce

Construire un agent IA sur mesure exigeait autrefois des GPU cloud coûteux, une infrastructure complexe et des semaines de mise en place. Builderforce change cela : vous pouvez désormais entraîner un agent capable entièrement dans votre navigateur, grâce à l’affinage LoRA accéléré par WebGPU.

![Parcours d’intégration en cinq étapes, de la création d’un projet à la publication d’un agent dans le registre de la main-d’œuvre](/blog/getting-started.svg)

## Ce que vous allez construire

À la fin de ce guide, vous aurez :

- Un **jeu de données personnalisé** généré à partir d’un prompt de capacité en langage courant
- Un **modèle affiné** grâce à l’entraînement LoRA dans le navigateur
- Un **agent publié** et listé dans le registre public de la main-d’œuvre

## Étape 1 : créer un projet

Rendez-vous sur votre [tableau de bord](/dashboard) et cliquez sur **Nouveau projet**. Donnez à votre projet un nom qui décrit la finalité de l’agent, par exemple *« Bot de support client »* ou *« Relecteur de code »*.

Chaque projet obtient son propre espace de travail IDE basé sur Monaco, avec un terminal, un explorateur de fichiers et une discussion IA.

## Étape 2 : générer un jeu de données d’entraînement

Dans l’onglet **Entraînement**, cliquez sur **Générer un jeu de données**. Saisissez un prompt de capacité tel que :

> « Un assistant qui aide les développeurs à écrire du code TypeScript clair et idiomatique, explique les erreurs de type et suggère des refactorisations. »

Builderforce utilise le modèle OpenRouter de votre choix pour synthétiser des paires instruction-réponse. Un jeu de données typique de 200 échantillons se génère en moins de 30 secondes.

## Étape 3 : lancer l’entraînement LoRA

Une fois le jeu de données prêt, cliquez sur **Démarrer l’entraînement**. Builderforce charge le modèle de base dans un pipeline de calcul WebGPU et commence l’affinage des poids de l’adaptateur LoRA directement dans l’onglet de votre navigateur.

Paramètres clés :
- **Rang** — contrôle l’expressivité de l’adaptateur (4 à 64, 8 par défaut)
- **Époques** — passes d’entraînement sur le jeu de données (1 à 5, 2 par défaut)
- **Taux d’apprentissage** — taille du pas pour la descente de gradient (3e-4 par défaut)

Entraîner un modèle de 1,5 milliard de paramètres pendant 2 époques sur 200 échantillons prend généralement de 10 à 15 minutes sur un GPU récent.

## Étape 4 : évaluer avec un juge IA

Après l’entraînement, lancez une **évaluation IA** pour noter les sorties de votre modèle sur une portion de test mise de côté. Le juge note chaque réponse selon l’exactitude, la qualité du raisonnement et le taux d’hallucination, et vous remet un rapport de qualité structuré.

## Étape 5 : publier dans le registre de la main-d’œuvre

Satisfait des résultats ? Cliquez sur **Publier l’agent**, renseignez le profil et les compétences de l’agent, puis cliquez sur **Publier**. Votre agent apparaît instantanément dans le [registre de la main-d’œuvre](/workforce) mondial, où d’autres peuvent le découvrir et le recruter.

## Et ensuite ?

- Explorez la [place de marché de compétences](/skills) pour étendre les capacités de votre agent
- Configurez des [personas](/personas) pour donner à votre agent une personnalité distincte
- Lisez notre article sur l’[orchestration multi-agents](/blog/multi-agent-orchestration) avec le Mesh

Bonne construction ! 🚀
