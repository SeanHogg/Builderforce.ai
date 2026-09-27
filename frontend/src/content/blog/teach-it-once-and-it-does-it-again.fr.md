Chaque semaine, il y a une tâche qui ne vaut ni la peine d’être automatisée, ni celle d’être faite.

Recopier le total de la facture du fournisseur dans le logiciel de comptabilité. Sortir le chiffre du mois d’un programme et le taper dans un autre. Remplir les six mêmes champs d’un formulaire sans API, sans export et sans intégration — juste une fenêtre dans laquelle il faut cliquer. Dix minutes, toujours les mêmes dix minutes, et la seule façon de les faire, c’est qu’une personne s’y mette.

Les outils d’IA promettent de le faire pour vous. La plupart ont besoin d’une API, d’une extension de navigateur ou d’un modèle qui devine des pixels à chaque fois. Aucun ne garde ce qu’il a appris sur la façon dont *vous* faites la tâche.

Voilà le manque : **le travail qui vit dans les programmes de bureau ne pouvait pas être appris, et rien de ce qui l’apprenait n’en gardait la leçon.**

## Montrez-le une fois

Activez les agents autonomes dans Synapse — ils sont désactivés tant que vous ne le faites pas — et choisissez un programme. Synapse le lance et n’observe que ce programme pendant que vous faites la tâche une fois, comme d’habitude.

```bf-figure
{
  "kind": "flow",
  "title": "D’une démonstration à une compétence",
  "steps": [
    { "label": "Enregistrer", "note": "Synapse lance le programme et enregistre les contrôles utilisés et les valeurs saisies — pas un journal des frappes. Les champs de mot de passe ne sont jamais capturés.", "hue": "idea" },
    { "label": "Vérifier", "note": "Chaque étape avec sa capture. Retirez les clics inutiles, choisissez les valeurs demandées à chaque exécution et où il faut d’abord vous demander.", "hue": "idea" },
    { "label": "Train Once", "note": "La démonstration devient une compétence : les saisies deviennent des valeurs nommées, les secrets des entrées du coffre, envoyer et supprimer des points de validation.", "hue": "make", "tag": "une démo" },
    { "label": "Exécuter", "note": "À la demande avec de nouvelles valeurs, ou en routine pendant que Synapse reste dans la barre des tâches. Échap vous rend la souris à tout moment.", "hue": "run" }
  ],
  "caption": "Rien ne devient une compétence sans votre vérification. L’enregistrement couvre un programme, et seulement pendant l’enregistrement."
}
```

Ce qui est enregistré, c’est le *sens*, pas les frappes : « mettre Montant à 250,00 dans Factures », « cliquer sur Envoyer la facture ». C’est ce qui permet à la compétence de fonctionner le mois suivant, quand la fenêtre est ailleurs et le montant différent.

## Elle demande avant tout ce qui est irréversible

Une compétence qui clique sur **Envoyer**, **Payer**, **Supprimer** ou **Valider** s’arrête à cette étape et demande. La fenêtre passe au premier plan, dit exactement ce qu’elle va faire, et attend. Sans réponse sous quinze minutes, l’exécution s’arrête.

```bf-figure
{
  "kind": "screen",
  "frame": "Synapse — Exécutions",
  "ratio": 1.5,
  "regions": [
    { "label": "« Facture mensuelle » attend votre accord", "note": "L’étape suivante est irréversible : cliquer sur « Envoyer la facture » dans « Factures »", "x": 20, "y": 14, "w": 60, "h": 34, "hue": "accent" },
    { "label": "Journal d’audit", "note": "Chaque étape de chaque exécution : fait, fait par position, validé, refusé, échoué", "x": 4, "y": 54, "w": 92, "h": 40, "hue": "run" }
  ],
  "caption": "Train Once place les points de validation d’après le libellé du bouton, dans les cinq langues du produit — et vous pouvez en ajouter ou en retirer à la vérification."
}
```

Chaque exécution garde son journal — chaque étape, comment elle a été faite, ce que vous avez décidé — pour que « la routine l’a-t-elle vraiment classé ? » ait une réponse lisible.

## Votre Evermind apprend la procédure

C’est ce qu’aucun autre outil ne fait. Chaque compétence enregistrée est aussi écrite comme la procédure qu’une personne noterait — la tâche, puis des étapes numérotées, avec les valeurs en espaces réservés — et votre **Evermind privé** en apprend, une fois, sur votre machine.

```bf-figure
{
  "kind": "compare",
  "title": "Ce que devient ce que vous avez appris",
  "columns": [
    { "title": "Outils d’automatisation", "hue": "muted", "items": ["Un script qui rejoue des clics", "Ne sait rien du pourquoi", "Vit dans les réglages d’une appli", "Perdu quand vous changez d’outil"] },
    { "title": "Synapse", "hue": "make", "items": ["Une compétence qui demande de nouvelles valeurs", "Une procédure apprise par votre propre modèle", "Rangée avec vos souvenirs, partagée par chaque outil d’IA connecté", "Oubliez-en une partie, ou tout, quand vous voulez"] }
  ],
  "caption": "Démonstrations, compétences, exécutions et faits vivent dans le même magasin Evermind local que vos agents de code utilisent déjà. Les secrets restent dans le Gestionnaire d’identification Windows."
}
```

C’est le même magasin où vos agents de code retiennent déjà des faits : tout ce que vous apprenez se range à côté de ce qu’ils ont appris — sur votre ordinateur, dans des fichiers visibles, avec un bouton Oublier pour chacun.

## Sa place dans la méthode

Le travail sur Builderforce suit un arc — **Idée → Faire → Exploiter → Mesurer** — et chaque acte suit la même boucle interne : [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop).

Les agents autonomes relèvent d’**Exploiter**. C’est là que le travail récurrent se fait de façon fiable ou cesse sans bruit, et le travail des programmes de bureau n’avait aucun moyen d’y entrer. Apprendre une tâche une fois la place sur l’arc.

Dans la boucle, la vérification est l’étape **Prouver** : avant l’acte coûteux — laisser un programme piloter seul votre souris et votre clavier — vous voyez chaque étape, ce qu’il demandera et où il s’arrêtera. Construire vient ensuite, et le point de validation maintient la preuve à l’étape précise où une erreur serait sans retour. **Mesurer**, c’est le journal : chaque exécution, chaque étape, chaque décision, consignée.

## Ce que vous pouvez faire dès aujourd’hui

- **Apprendre une tâche répétitive dans n’importe quel programme Windows** en la faisant une fois, et la relancer avec de nouvelles valeurs.
- **La mettre en routine** — toutes les quelques minutes ou chaque jour à neuf heures — et laisser Synapse s’en charger depuis la barre des tâches.
- **Garder la main sur les étapes irréversibles** : envois, paiements et suppressions attendent votre accord.
- **Apprendre à votre propre modèle** les procédures montrées, sur votre machine, et en oublier ce que vous voulez, quand vous voulez.

L’enregistrement et la relecture arrivent d’abord sur Windows ; macOS et Linux suivront. [Téléchargez Synapse](https://github.com/SeanHogg/Builderforce.ai/releases?q=desktop-v&expanded=true) et activez les agents autonomes depuis la page Apprendre.

---

**À lire aussi :** [Un index local pour chaque outil d’IA de votre machine](/blog/one-local-index-for-every-ai-tool) · [Lire, Prouver, Construire — la boucle interne](/blog/read-prove-build-the-inner-loop)
