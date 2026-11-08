# Comment réaliser un CV vidéo dans le Creation Canvas de Builderforce (méthode en 60 secondes)

## Pourquoi Studio vaut mieux qu’un enregistrement avec votre téléphone

Vous pouvez enregistrer un CV vidéo avec votre téléphone, mais vous aurez trois combats à mener : rester dans le script, corriger la seule scène où vous avez trébuché et obtenir un son propre. Le Creation Canvas de Builderforce règle les trois dans le navigateur : un téléprompteur qui fait défiler votre script, des reprises scène par scène pour qu’une mauvaise prise ne vous coûte pas toute la vidéo, et un nivellement audio à l’export.

Toute la boucle — script, enregistrement, montage, rendu, publication — se déroule dans un seul onglet. Le rendu s’exécute côté client avec ffmpeg.wasm : pas de téléversement suivi d’une attente.

## Étape 1 : écrire le script en scènes

Ouvrez [Studio](/creation-canvas), créez un document vidéo et rédigez votre script découpé en scènes. La forme éprouvée en 60 secondes est la suivante : une accroche (une affirmation précise), votre nom et votre rôle, une histoire (problème, action, résultat) et une conclusion qui nomme le poste que vous voulez.

Limitez chaque scène à une idée. Les scènes sont l’unité que vous réenregistrerez : une coupure de scène nette permet donc une reprise propre. Visez 60 à 90 secondes au total, soit 130 à 180 mots prononcés.

## Étape 2 : enregistrer avec le téléprompteur

Activez le téléprompteur : il fait défiler votre script sur l’aperçu de la caméra pendant que vous enregistrez, de sorte que vous gardez le contact visuel au lieu de lire sur le côté. Enregistrez scène par scène. Si vous butez sur la scène 3, réenregistrez uniquement la scène 3 : le reste n’est pas touché.

Regardez l’objectif, pas votre propre image. Adoptez une tenue d’un cran plus formelle que le quotidien de l’entreprise. Enregistrez chaque scène plusieurs fois et gardez la prise qui sonne comme une conversation, pas comme un texte appris par cœur.

## Étape 3 : peaufiner — voix off, coupes, musique

Si vous préférez ne pas apparaître à l’image pendant une partie de la vidéo, générez une voix off IA à partir de votre script pour ces scènes. Supprimez les temps morts au début et à la fin de chaque scène. Ajoutez un fond musical discret si cela convient à votre ton, réglez son niveau sous votre voix : l’export se charge du nivellement.

Ne montez pas à l’excès. Un CV vidéo visiblement coupé toutes les deux secondes paraît anxieux. Deux ou trois transitions de scène nettes valent mieux qu’une douzaine de coupes sautées.

## Étape 4 : rendre et publier

L’export effectue le rendu du MP4 final dans votre navigateur. Publiez-le sur votre profil comme CV vidéo, joignez-le à vos candidatures ou récupérez le lien public `/v/<id>` pour le partager où vous voulez.

Mettez-le à jour quand votre indicateur phare devient obsolète ou que votre rôle change : pour la plupart des gens, c’est tous les 12 à 18 mois. Réenregistrer une scène coûte peu : le garder à jour est donc facile.

## Foire aux questions

### Quelle doit être la durée d’un CV vidéo ?

De 60 à 90 secondes. Les vidéos plus longues ne sont pas regardées jusqu’au bout ; les plus courtes n’ont pas la place de raconter une histoire. Placez votre affirmation la plus forte et la plus précise dans les trois premières secondes pour que le recruteur décide de continuer à regarder.

### Puis-je réenregistrer seulement une partie ?

Oui. Studio enregistre scène par scène : vous pouvez donc réenregistrer une seule scène sans refaire toute la vidéo. C’est le plus grand avantage par rapport à une prise continue unique sur votre téléphone.

### Dois-je téléverser mes images pour effectuer le rendu ?

Non. Studio effectue le rendu de la vidéo finale côté client avec ffmpeg.wasm : vos images brutes n’ont donc pas besoin d’être téléversées vers un serveur pour produire le MP4 fini.

---

**Essayez-le :** [Studio](/creation-canvas) sur Builderforce.
