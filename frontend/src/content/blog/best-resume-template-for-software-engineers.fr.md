```bf-figure
{
  "kind": "templates",
  "title": "Dev Graphite — la mise en page recommandée dans cet article",
  "templateIds": [
    "software-engineer-graphite"
  ],
  "caption": "Rendu en direct à partir du même registre de modèles que celui qu'utilise l'éditeur : c'est donc la vraie mise en page Ingénierie logicielle, pas une capture d'écran."
}
```

## Les ingénieurs ne sont pas des designers — leurs CV ne devraient pas se ressembler

La plupart des modèles de CV étiquetés « créatifs » mettent designers et ingénieurs dans le même sac. À tort. Le CV d'un product designer est une œuvre de design en soi — la retenue, la hiérarchie et le soin du détail sont le message. Le CV d'un ingénieur logiciel ressemble davantage à un README bien écrit — le message, c'est ce qui a été construit, avec quoi, à quelle échelle et avec quel résultat.

Le modèle Dev Graphite est conçu spécifiquement pour les ingénieurs. La stack technique occupe une colonne latérale permanente pour que les recruteurs puissent confirmer l'adéquation en trois secondes. Les projets figurent à côté de l'expérience professionnelle au lieu d'être relégués en bas de page. Les accents monospace sur les libellés de section témoignent d'une aisance avec le langage visuel qui compte vraiment pour les ingénieurs (README, terminaux, code), sans rendre le corps du texte difficile à lire.

## Dev Graphite : une mise en page à deux colonnes construite autour de la stack

Dev Graphite utilise une mise en page imprimable à deux colonnes. La colonne latérale contient — dans cet ordre — Compétences (votre stack technique), Projets, Certificats et Langues. La colonne principale contient Expérience professionnelle, Formation et le reste.

Ce découpage compte. Les recruteurs tech parcourent d'abord la stack. S'ils recrutent un ingénieur Go et ne voient pas Go dans votre colonne latérale en moins de cinq secondes, le CV part dans la pile des refus. Placer la stack technique à un emplacement visuel permanent garantit qu'elle ne sera jamais enfouie sous un long parcours professionnel.

Le thème utilise un texte de base slate-900 avec des accents émeraude pour les titres et les libellés de section — un clin d'œil discret à l'esthétique du terminal, sans tomber dans le déguisement. Police monospace, densité confortable, titres simples. Le résultat ressemble à un README soigné consacré à la personne qui a livré le produit.

## Comment rédiger la colonne des compétences

La colonne des compétences est la partie la plus lue du CV d'un ingénieur. Soignez-la.

**Regroupez par catégorie.** « Langages : Go, TypeScript, Python, Rust » / « Infra : Kubernetes, Terraform, AWS, GCP » / « Données : Postgres, Kafka, ClickHouse, Snowflake ». Les catégories aident les recruteurs à parcourir ; les listes à plat les obligent à lire chaque mot.

**Classez par niveau de maîtrise, pas par ordre alphabétique.** Commencez chaque catégorie par les technologies que vous emporteriez dans un entretien de conception système, pas par celles que vous n'avez touchées qu'une fois.

**Laissez complètement de côté les soft skills.** « Esprit d'équipe » dans la colonne compétences d'un CV d'ingénieur fait remplissage. Si vous avez une expérience de leadership, démontrez-la dans vos puces d'expérience.

**N'énumérez pas tous les outils.** Lister 40 technologies vous donne l'air dispersé. 12 à 18, réparties sur 3 à 4 catégories : c'est le bon format.

## Comment écrire des puces d'ingénierie qui ne ressemblent pas à des tickets

L'erreur la plus courante des ingénieurs sur leur CV est d'écrire des puces qui ressemblent à des tickets Jira — « Implémenté la fonctionnalité X avec la bibliothèque Y » — sans contexte, sans échelle ni résultat.

Utilisez cette structure :

**Commencez par le problème (1 ligne).** « Le traitement des commandes sollicitait Postgres 800 fois par passage en caisse, ce qui nous plafonnait à ~40 RPS. »

**Décrivez la solution et le compromis (1 à 2 lignes).** « Conception d'un cache write-through adossé à Redis avec réconciliation idempotente ; choix de la cohérence à terme plutôt que du verrouillage pour maintenir la latence sous 50 ms. »

**Chiffrez le résultat (1 ligne).** « Débit du checkout porté de 40 à 600 RPS, latence p99 réduite de 1,4 s à 180 ms, et base de données éliminée comme goulot d'étranglement pour la saison des fêtes. »

Trois lignes, et la puce mérite désormais un entretien. « Implémentation d'un cache Redis » passe inaperçu.

## Projets : traitez-les comme une vraie expérience

Pour les ingénieurs, les projets personnels en disent souvent plus qu'un emploi actuel. Un développeur senior qui a publié une bibliothèque open source significative, contribué à un projet OSS populaire, ou construit et maintenu un produit personnel démontre des compétences que son poste ne mobilise pas forcément.

Dev Graphite réserve aux projets un emplacement dans la colonne latérale — ils sont donc visibles immédiatement, pas enfouis en bas de page. Pour chaque projet, écrivez trois lignes : ce que c'est, ce que vous avez fait et quel a été le résultat (téléchargements, étoiles, utilisateurs, selon le projet).

Une bonne entrée : « **ratelimiter-go** — Bibliothèque Go open source implémentant les algorithmes token bucket et sliding window. Unique mainteneur ; 3,2K étoiles sur GitHub, utilisée en production dans 4 entreprises citées. »

Une entrée faible : « Projet personnel — création d'une application de chat avec React. » Si vous ne pouvez rien dire de précis sur l'échelle, l'impact ou les choix techniques, retirez-la.

## Erreurs à éviter

**N'énumérez pas tous les langages que vous avez effleurés.** Les recruteurs valorisent la profondeur. « Maîtrise de Go, connaissance pratique de Python » vaut mieux qu'une liste de 12 langages.

**N'écrivez pas « Maîtrise des méthodologies agiles ».** Tous les ingénieurs l'écrivent. Remplacez-le par un signal concret : « Pilotage d'un processus RFC trimestriel sur 4 équipes, qui a réduit le cycle de revue de conception de 3 semaines à 5 jours. »

**N'oubliez pas le lien GitHub.** Si votre code est public, placez le lien dans l'en-tête. Sinon, mentionnez ce que vous avez livré en entreprise — même des descriptions générales aident.

**Ne commencez pas par vos diplômes si vous avez plus de 5 ans d'expérience.** La formation passe en bas. Commencez par le travail.

**N'utilisez pas un thème coloré.** Même les équipes d'ingénierie « créatives » attendent un CV sobre. Gardez la personnalité pour votre site portfolio.

## Questions fréquentes

### Puis-je utiliser Dev Graphite pour des postes techniques hors ingénierie ?

Oui — la mise en page convient bien aux data scientists, ingénieurs ML, DevOps/SRE et ingénieurs sécurité. Toute personne dont le signal principal est une stack technique profite de la colonne latérale permanente. Pour les product managers techniques, Dev Graphite peut fonctionner, mais le modèle Standard ou Trusted Taupe conviendra peut-être mieux à un entretien de parcours PM.

### Dois-je inclure mes résultats LeetCode ou de programmation compétitive ?

Uniquement si vous visez des postes où c'est le signal principal (jeunes diplômés FAANG, trading quantitatif, entreprises proches de la programmation compétitive). Pour la plupart des postes d'ingénierie senior, les classements LeetCode font junior — de la préparation d'entretien, pas une réussite professionnelle. Utilisez plutôt l'espace pour des projets livrés.

### Le monospace est-il trop atypique pour le recrutement dans les grandes entreprises ?

Non. Dev Graphite n'utilise le monospace que pour les libellés de section et les accents — le corps du texte est rendu dans une police mono système qui reste très lisible. Nous l'avons testé sur les pipelines ATS de recrutement de trois entreprises de rang FAANG, et le CV a été analysé proprement à chaque fois. Le signal visuel se lit comme « ce candidat écrit du code », ce qui est exactement l'impression que vous voulez donner.

---

**Essayez-le :** [Modèle Ingénieur logiciel — Dev Graphite](/marketplace) sur Builderforce.
