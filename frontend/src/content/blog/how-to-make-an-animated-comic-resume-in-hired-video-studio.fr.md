# Comment réaliser un CV en bande dessinée animée dans le Creation Canvas de Builderforce

## Quand une bande dessinée l’emporte sur une vidéo face caméra

Pour la plupart des postes, un CV vidéo de 60 secondes face caméra est l’atout le plus efficace que vous puissiez produire. Mais pour les métiers du design, de l’illustration, de l’animation graphique, du marketing et de la marque, un responsable du recrutement veut *voir* votre esthétique, pas seulement vous entendre la décrire. Un CV en bande dessinée animée est le format qui met votre savoir-faire sur la page.

Le type de média animation de Studio vous offre un canevas en couches avec une chronologie d’images clés. Vous construisez des cases, placez des couches (arrière-plan, personnage, bulles de texte) et animez des propriétés — position, échelle, opacité — dans le temps. Le résultat est une courte vidéo rendue que vous pouvez publier sur votre profil ou joindre à une candidature.

## Étape 1 : démarrer un document d’animation

Ouvrez [Studio](/creation-canvas), créez un nouveau document et choisissez le type **Animation**. L’éditeur charge un canevas ainsi qu’une chronologie d’images clés. Réglez d’abord votre format d’image : le carré (1:1) se lit bien dans un fil d’actualité, le 16:9 se lit proprement en vidéo intégrée.

Pensez en cases comme une bande dessinée : 4 à 8 cases, chacune étant un temps fort de votre histoire. Esquissez les temps forts avant de construire — « introduction », « le projet », « le résultat », « la demande » — afin d’animer d’après un script plutôt que d’improviser.

## Étape 2 : construire les couches et les bulles

Chaque case est une pile de couches. Ajoutez un arrière-plan, un personnage ou une illustration, et des couches de texte pour les légendes et les bulles. Le modèle de couches de Studio est celui du canevas vidéo : tout ce que vous pouvez placer dans une scène vidéo — formes, images, texte, polices — fonctionne donc ici aussi.

Gardez le texte court. Une bulle de bande dessinée qui demande plus de deux secondes à lire casse le rythme. Laissez les visuels porter l’histoire et utilisez les légendes pour ancrer les faits clés (votre nom, l’indicateur, le poste que vous voulez).

## Étape 3 : animer avec des images clés

Sélectionnez une couche, déplacez la tête de lecture et définissez des images clés sur les propriétés que vous voulez animer. Faites glisser un personnage depuis l’extérieur du canevas, faites apparaître une légende en fondu, faites surgir une bulle par un rapide agrandissement. Studio interpole entre les images clés : deux images clés par propriété suffisent généralement pour un mouvement net.

Privilégiez une poignée de mouvements assurés plutôt qu’un mouvement constant. Les CV en bande dessinée les plus efficaces laissent chaque case assez longtemps pour être lue, puis passent à la suivante par une seule animation délibérée plutôt que de tout animer en même temps.

## Étape 4 : effectuer le rendu dans le navigateur et publier

L’export effectue le rendu de l’animation en vidéo côté client avec le même pipeline ffmpeg.wasm que tous les autres types de médias de Studio : pas de téléversement, pas de file d’attente serveur. Ajoutez d’abord une piste audio si vous voulez une narration ou un fond musical ; la voix off IA fonctionne ici exactement comme pour la vidéo.

Publiez le clip rendu sur votre profil, joignez-le à une candidature créative ou publiez-le en tant que Creator. Pour les métiers du design et de l’animation graphique, un CV en bande dessinée est souvent l’unique élément qui vous fait retenir dans une pile de PDF.

## Foire aux questions

### Dois-je être illustrateur pour réaliser un CV en bande dessinée ?

Non. Vous pouvez construire des cases à partir de formes, de texte et d’images importées. Une illustration de qualité aide pour les postes d’illustration en particulier, mais le format fonctionne avec de simples graphiques en couches : la structure narrative compte plus que le dessin.

### Quelle est la différence entre le type animation et une vidéo ?

Les deux s’exportent en vidéo, mais le type animation est construit autour d’une chronologie d’images clés et d’un canevas en couches pour du mouvement synthétique, alors que le type vidéo est construit autour de scènes enregistrées et d’un téléprompteur. Utilisez l’animation quand vous créez du mouvement à partir de couches ; utilisez la vidéo quand vous vous enregistrez.

### Où le rendu s’effectue-t-il ?

Dans votre navigateur. Studio utilise ffmpeg.wasm pour effectuer le rendu de la vidéo finale côté client : vos ressources n’ont donc pas à être téléversées vers une ferme de rendu, et il n’y a aucun coût d’infrastructure par rendu.

---

**Essayez-le :** [Studio](/creation-canvas) sur Builderforce.
