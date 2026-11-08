# Comment réaliser un épisode de podcast dans le Creation Canvas de Builderforce (pas à pas)

## À quoi sert le type de média Podcast

Le Creation Canvas de Builderforce n’est plus réservé à la vidéo. Le document Studio porte un `mediaKind` — vidéo, podcast, voix ou animation — et le type podcast fait passer l’éditeur dans une mise en page orientée audio : des pistes de forme d’onde au lieu d’un canevas visuel, des repères de chapitres au lieu de scènes, et un export qui produit un MP3 propre plutôt qu’un MP4.

Un épisode de podcast est le bon format quand votre message s’écoute mieux qu’il ne se regarde : un épisode racontant votre parcours pour votre profil, une explication d’expert qui démontre votre savoir-faire, ou un entretien que vous animez en tant que Creator. Comme le même modèle de document sous-tend tous les types de médias, vous pouvez partir d’un script vidéo et le convertir en podcast sans retaper un mot.

## Étape 1 : ouvrir Studio et choisir le type Podcast

Ouvrez [Studio](/creation-canvas) et créez un nouveau document. Dans le sélecteur de nouveau document, choisissez **Podcast**. L’éditeur charge la mise en page audio : une barre de transport, une ou plusieurs pistes audio et un volet de script à gauche.

Si vous avez déjà un brouillon vidéo que vous préféreriez narrer en audio, ouvrez-le et changez son type de média dans les paramètres du document : le script et la structure en chapitres sont conservés, et les couches visuelles sont simplement masquées de l’export audio.

## Étape 2 : rédiger ou coller votre script

Saisissez votre épisode dans le volet de script, découpé en chapitres. Chaque chapitre devient un repère sur la chronologie, afin que les auditeurs (et vous, pendant le montage) puissent passer d’un segment à l’autre.

Gardez des chapitres courts : de 60 à 120 secondes d’audio parlé chacun. Un épisode de 10 minutes représente à peu près 1 300 à 1 500 mots prononcés. Le téléprompteur lit ce volet pendant que vous enregistrez : écrivez donc comme vous parlez, avec des phrases courtes, une idée par ligne.

## Étape 3 : enregistrer, ou générer une voix off IA

Vous avez deux façons d’amener de l’audio sur la piste :

**Vous enregistrer.** Cliquez sur enregistrer, lisez depuis le téléprompteur, et Studio capture une piste dans le navigateur. Réenregistrez n’importe quel chapitre individuellement sans toucher au reste : les repères de chapitres rendent le remplacement net.

**Générer une voix off IA.** Si vous êtes timide à l’audio ou voulez un narrateur constant, sélectionnez un chapitre et générez la synthèse vocale à partir du script. C’est le même moteur de synthèse vocale que celui de la voix off vidéo ; il travaille sur le texte de votre script, de sorte que les mises à jour restent synchronisées.

La plupart des créateurs combinent les deux : voix off IA pour les introductions, les conclusions et les segments de type publicitaire ; leur propre voix pour les parties qui demandent de l’authenticité.

## Étape 4 : monter, ajouter une deuxième piste et exporter

Supprimez les silences et les hésitations directement sur la forme d’onde. Ajoutez une deuxième piste pour une musique d’introduction ou un fond sous votre narration, et réglez son niveau pour qu’elle reste derrière votre voix. Studio effectue le rendu du mixage dans le navigateur avec le même pipeline ffmpeg.wasm que l’export vidéo : pas d’aller-retour serveur, pas de téléversement de votre audio brut.

Quand vous êtes satisfait, exportez en MP3. Publiez-le sur votre profil comme CV audio, joignez-le à une publication Creator ou téléchargez-le pour un hébergeur de podcasts externe. Toute la boucle, du script à l’épisode publié, se déroule dans un seul onglet.

## Foire aux questions

### Dois-je télécharger un logiciel pour enregistrer un podcast ?

Non. Studio enregistre, monte et exporte entièrement dans le navigateur. L’enregistrement utilise le micro de votre appareil via le navigateur, et le mixage final est rendu côté client avec ffmpeg.wasm : votre audio brut n’a donc jamais besoin d’être téléversé pour produire un épisode.

### Puis-je convertir un brouillon vidéo existant en podcast ?

Oui. Comme chaque document Studio partage un modèle sous-jacent avec un axe mediaKind, vous pouvez faire passer un document vidéo au type podcast. Le script et la structure en chapitres sont conservés ; les couches visuelles sont simplement exclues de l’export audio seul.

### La voix off IA est-elle obligatoire ?

Non, elle est facultative. Vous pouvez enregistrer entièrement avec votre propre voix, générer chaque chapitre avec une voix off IA, ou combiner les deux. Le téléprompteur fonctionne dans les deux cas pour que vous restiez dans le script pendant l’enregistrement.

---

**Essayez-le :** [Studio](/creation-canvas) sur Builderforce.
