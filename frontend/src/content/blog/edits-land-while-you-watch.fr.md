# Vos modifications arrivent sous vos yeux : mises à jour à chaud, vraies feuilles de style et les frameworks que vous utilisez déjà

Chaque fois que l'aperçu se recharge, vous perdez votre place.

Vous étiez au troisième écran d'un parcours de paiement, un formulaire à moitié rempli et une fenêtre modale ouverte, et vous avez changé une couleur. La page s'est rechargée, le formulaire s'est vidé, et vous avez recliqué tout le chemin pour voir si la couleur était bonne. Multipliez cela par chaque petite modification d'un après-midi, et l'essentiel de votre temps passe à revenir là où vous étiez.

Derrière ce premier manque, il y en avait un second. Beaucoup de vrais projets n'atteignaient jamais l'aperçu. Un `styles.scss`, un `Button.module.css`, un `import 'some-library/dist/styles.css'` ou une app Next.js, et l'aperçu échouait ou affichait discrètement la page sans ses styles.

Cette version comble les deux.

## Les modifications s'appliquent sur place

```bf-figure
{
  "kind": "compare",
  "title": "Changer une couleur",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": ["Toute la page se recharge", "Le formulaire que vous remplissiez est de nouveau vide", "La modale se ferme et le défilement remonte en haut", "Vous recliquez tout le chemin pour vérifier"] },
    { "title": "Maintenant", "hue": "run", "items": ["Seule la feuille de style est remplacée", "Ce que vous avez saisi reste saisi", "La modale reste ouverte, le défilement ne bouge pas", "La nouvelle couleur est simplement là"] }
  ],
  "caption": "Les modifications de feuilles de style s'appliquent sur place. Les modifications d'un composant React le redessinent en conservant son état. Ce qui ne peut pas être mis à jour sans risque se recharge, comme avant."
}
```

- **Les feuilles de style sont remplacées.** Modifiez un fichier `.css`, `.scss` ou `.less` et seule cette feuille de style est remplacée dans la page en cours. Rien ne se recharge.
- **Les composants React gardent leur état.** Modifiez un composant et il se redessine avec le nouveau code en gardant son état, grâce au Fast Refresh de React lui-même. Les compteurs gardent leur valeur et les formulaires leur contenu.
- **Un repli sûr.** Si une modification ne peut pas s'appliquer sur place (une modification du fichier d'entrée de l'app, par exemple), la page se recharge comme toujours, pour que rien ne reste à moitié à jour.

## Des feuilles de style écrites comme dans les vrais projets

```bf-figure
{
  "kind": "flow",
  "title": "De votre source à la page",
  "steps": [
    { "label": "styles.scss", "note": "Variables, imbrication, @use et partiels, ou Less avec ses mixins", "hue": "make" },
    { "label": "Compilé dans le navigateur", "note": "Les imports se résolvent depuis votre projet, puis node_modules, puis le CDN de paquets", "hue": "run", "tag": "nouveau" },
    { "label": "Button.module.css", "note": "Noms de classes isolés par fichier, avec composes et :global", "hue": "run", "tag": "nouveau" },
    { "label": "Aperçu et site publié", "note": "Le même CSS dans les deux", "hue": "measure" }
  ],
  "caption": "L'aperçu et la build publiée utilisent les mêmes compilateurs : ce que vous voyez pendant que vous construisez est ce qui sera publié."
}
```

- **Sass, SCSS et Less se compilent.** Cela inclut les fichiers `.scss`, `.sass` et `.less`, et `<style lang="scss">` dans les composants Vue et Svelte. Les partiels, `@use`, `@import` et les imports depuis des paquets npm sont tous résolus.
- **Les CSS Modules sont réels.** `import styles from './Button.module.css'` donne à chaque classe un nom isolé, si bien que `.title` dans un composant n'entre jamais en conflit avec `.title` dans un autre. `composes`, `:global` et les keyframes fonctionnent comme prévu.
- **Les feuilles de style des paquets se chargent.** `import 'react-toastify/dist/ReactToastify.css'`, le thème d'une bibliothèque de composants ou le CSS d'un paquet de polices se chargent désormais dans l'aperçu et sur le site publié, au lieu d'être ignorés.

## Next.js dans le navigateur

Un projet Next.js exécute désormais son propre serveur de développement, `next dev`, dans l'onglet du navigateur, comme le faisait déjà une app Express ou Vite. La page que vous ouvrez est rendue par Next lui-même, à partir de votre dossier `app/`, sans rien de chez nous entre les deux. Les projets SvelteKit fonctionnent de la même façon : `vite dev` lance le vrai Vite, et SvelteKit rend la page sur son propre serveur.

Pour y parvenir, le runtime sous-jacent s'est doté des parties de Node sur lesquelles un framework comme Next s'appuie sans le dire. Les processus peuvent désormais s'envoyer des messages (`child_process.fork` et `worker_threads`), les imports dynamiques chargent les fichiers du projet lui-même, et le compilateur WebAssembly de Next se charge là où le natif ne peut pas. La plupart de ces changements profitent aussi à d'autres outils.

## Sa place dans la méthode

Construire est le troisième acte de [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Ce que l'on vit dans cet acte tient à une seule chose : la longueur du trajet entre *changer quelque chose* et *voir ce que cela a fait*.

Les mises à jour à chaud retirent le rechargement de ce trajet, et garder votre place retire les clics pour revenir. Les vraies feuilles de style et les vrais frameworks règlent l'autre côté : le projet que vous éprouvez dans l'aperçu est celui que vous publierez, pas une copie simplifiée qui lui ressemble seulement.

## Ce que vous pouvez faire dès aujourd'hui

- **Modifier les styles sans perdre votre place :** ouvrez une modale, modifiez son CSS et regardez-la changer.
- **Apporter vos feuilles de style telles quelles :** partiels SCSS, Less, CSS Modules et le CSS de vos propres paquets.
- **Modifier un composant React en plein parcours** et garder l'état avec lequel vous testiez.
- **Ouvrir un projet Next.js ou SvelteKit** sur un canvas et l'exécuter.

---

**À lire aussi :** [Votre app vous répond désormais](/blog/your-app-talks-back) · [Exécutez l'app que votre tableau vient de construire](/blog/run-your-app-on-the-canvas) · [BuilderForce WebContainers est open source](/blog/builderforce-webcontainers-open-source)

[Ouvrez un canvas](/create) et changez quelque chose pendant qu'il tourne.
