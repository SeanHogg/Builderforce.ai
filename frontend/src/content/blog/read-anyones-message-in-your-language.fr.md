Une équipe qui ne partage pas une langue perd du contexte à chaque passation. La décision prise dans un fil que vous n'avez lu qu'à moitié. Le commentaire sur une carte que vous avez sauté parce que le détour n'en valait pas la peine. Le document importé que personne n'a ouvert.

La solution habituelle consiste à coller le texte dans un traducteur. Vos conversations, vos plans et les noms de vos clients partent alors vers un service cloud, message après message, et à volume réel cela coûte de l'argent réel.

## Un clic, dans votre langue

Les messages et commentaires écrits dans une autre langue se traduisent automatiquement lorsqu'ils défilent à l'écran, là où vous les lisez. « Afficher l'original » est à un clic. Un document importé reçoit une proposition de traduction, et un clic crée une copie traduite à côté. Pas de copier-coller, pas de deuxième onglet.

```bf-figure
{
  "kind": "screen",
  "frame": "Un message d'une collègue",
  "ratio": 1.62,
  "regions": [
    { "label": "Traduit de l'espagnol · Afficher l'original", "note": "Toujours signalé, toujours réversible", "x": 4, "y": 6, "w": 92, "h": 12, "hue": "accent" },
    { "label": "Le message, dans votre langue", "note": "Lisez-le, citez-le, répondez-y", "x": 4, "y": 22, "w": 92, "h": 46, "hue": "make" },
    { "label": "Répondre", "note": "Vous écrivez dans la vôtre ; elle lit dans la sienne", "x": 4, "y": 74, "w": 92, "h": 20, "hue": "idea" }
  ],
  "caption": "La traduction dit ce qu'elle est et d'où elle vient. L'original est à un clic derrière l'étiquette : personne n'a à croire une traduction sur parole."
}
```

## Votre appareil d'abord, une solution gratuite ensuite

Chrome intègre un traducteur dans le navigateur. Builderforce l'utilise en premier : le texte est traduit sur votre propre appareil et n'a donc pas à voyager pour être compris. Si votre navigateur n'en a pas, comme Edge aujourd'hui, une traduction cloud prend le relais, gratuite dans la limite des quotas quotidiens. La fonction ne manque donc jamais, elle est seulement moins privée.

Les résumés et les réécritures suivent le même ordre. Quand le navigateur le peut, ils s'exécutent d'abord sur l'appareil (Gemini Nano dans Chrome, Phi-4-mini dans Edge) et ne passent aux modèles cloud que lorsqu'il ne le peut pas.

```bf-figure
{
  "kind": "devices",
  "title": "La même traduction, où que vous travailliez",
  "devices": [
    { "label": "Web", "width": 1280, "hue": "make", "note": "Traduisez un message ou un commentaire de carte sur place" },
    { "label": "Rovr", "width": 834, "hue": "run", "note": "Lisez une page ou un fil dans votre langue depuis le panneau latéral du navigateur" },
    { "label": "VS Code", "width": 390, "hue": "measure", "note": "Lisez la note d'une collègue à côté du code qu'elle concerne" }
  ],
  "caption": "Un seul comportement sur chaque surface : l'appareil d'abord, un traducteur cloud ensuite, gratuit dans la limite des quotas quotidiens, l'original toujours à un clic."
}
```

```bf-figure
{
  "kind": "compare",
  "title": "Sur votre appareil ou dans le cloud",
  "columns": [
    { "title": "Traducteur cloud", "hue": "muted", "items": ["Votre texte part chez un tiers", "Facturé au caractère à volume élevé", "Nécessite une connexion à chaque fois", "Un autre onglet et une étape de collage"] },
    { "title": "Sur votre appareil d'abord", "hue": "make", "items": ["Le texte reste sur votre ordinateur", "Gratuit sur l'appareil, quoi que vous lisiez", "Fonctionne hors ligne une fois la langue installée", "Traduit sur place, original à un clic"] }
  ],
  "caption": "La solution cloud existe pour que personne ne reste sans traduction. C'est le second choix, pas le choix par défaut."
}
```

## Où cela se place dans la méthode

Builderforce fonctionne comme un arc : [Idée, Faire, Exécuter, Mesurer, Portée](/blog/read-prove-build-the-inner-loop), avec Lire, Prouver et Construire comme boucle interne qui mène de l'Idée à Faire. La traduction vit dans le premier acte de la boucle, **Lire**, dans Idée, et l'ouvre à toute l'équipe.

Lire est l'acte peu coûteux qui décide si l'on construit quoi que ce soit, et il ne fonctionne que si vous pouvez lire ce que disent les preuves. Un entretien client en portugais, une spécification d'un prestataire à Berlin, un commentaire d'une collègue à Madrid : jusqu'ici, chacun était soit ignoré, soit envoyé à un service. Désormais ils sont lisibles tout de suite, et la décision de Faire se prend sur tout ce que l'équipe sait, pas seulement sur la partie écrite dans votre langue.

## Ce que vous pouvez faire dès aujourd'hui

- **Lire le message d'une collègue dans votre langue** dès qu'il défile à l'écran, et répondre dans la vôtre.
- **Traduire un document importé** dans une autre langue en un nouveau document à côté, sans quitter la page.
- **Garder vos conversations sur votre ordinateur** quand votre navigateur a un traducteur (aujourd'hui, le traducteur intégré de Chrome).
- **Vérifier la source** à tout moment : chaque traduction indique d'où elle vient et garde l'original à un clic.

---

**À lire aussi :** [IA locale : WebGPU dans le navigateur](/blog/local-first-ai-webgpu-in-the-browser) · [Exécutez l'app que votre board vient de construire](/blog/run-your-app-on-the-canvas)

[Ouvrez un canevas](/create) et invitez quelqu'un qui écrit dans une autre langue.
