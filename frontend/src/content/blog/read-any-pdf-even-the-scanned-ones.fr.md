# Lisez n’importe quel PDF — y compris ceux numérisés que personne ne peut chercher

Déposez un CV PDF de cinq pages sur un tableau. Récupérez une icône de fichier indiquant **« Texte non extractible »** et un assistant qui vous demande poliment de copier-coller le texte du document qu’il détient.

C’était un vrai signalement, et il mérite d’être expliqué correctement, car « l’outil n’a pas pu lire mon PDF » est l’une de ces plaintes qui ressemblent à de la négligence et sont presque toujours dues à quelque chose de précis.

## Pourquoi un PDF que vous pouvez lire est un PDF qu’un programme ne peut pas lire

Un PDF ne stocke pas un paragraphe. Il stocke des instructions pour dessiner des formes à des coordonnées. Lorsque ces formes sont des lettres, le fichier embarque généralement une police — et pour garder le fichier léger, la plupart des exportateurs modernes en font un **sous-ensemble** : ils n’incluent que les glyphes réellement utilisés, renumérotés.

La chaîne contenue dans le fichier n’est donc plus `Hello`. C’est une liste d’indices de glyphes dans une table privée, généralement écrits en hexadécimal, qui ne signifient « Hello » qu’en présence de ce sous-ensemble de police précis.

```bf-figure
{
  "kind": "compare",
  "title": "Ce que sont réellement les octets d’une chaîne dessinée",
  "columns": [
    { "title": "Un PDF d’environ 2005", "hue": "muted", "items": ["Texte dessiné à partir de caractères littéraux", "L’extraction naïve fonctionne", "C’est ce que supposent la plupart des lecteurs simples"] },
    { "title": "Un PDF de Google Docs, Word ou Pages", "hue": "make", "items": ["Police en sous-ensemble, indices de glyphes", "Écrits en hexadécimal, pas sous forme de lettres", "Lu littéralement, il se décode en charabia", "Un contrôle de lisibilité refuse à juste titre de l’afficher"] }
  ],
  "caption": "Le lecteur n’était pas cassé. Il lisait un schéma de numérotation comme si c’était l’alphabet."
}
```

La table de traduction se trouvait dans le fichier depuis le début : chaque police de ce type embarque une table de caractères qui indique quel indice de glyphe correspond à quel caractère. La lire est la solution, et c’est pourquoi les exports des trois traitements de texte que les gens utilisent réellement arrivent désormais sous forme de texte plutôt que de bruit.

## La moitié sans aucun texte

```bf-figure
{
  "kind": "flow",
  "title": "Ce qui arrive à un fichier que vous déposez sur un tableau",
  "steps": [
    { "label": "Lire la couche de texte", "note": "Indices de glyphes résolus via la table de caractères de la police elle-même, ce qui rend un export moderne lisible plutôt que du charabia.", "hue": "read" },
    { "label": "Vérifier la lisibilité", "note": "Une page qui se décode en bruit est REFUSÉE plutôt qu’affichée. Une transcription fausse mais assurée est pire qu’une lacune honnête.", "hue": "prove" },
    { "label": "Faire remonter ce qui a échoué", "note": "Pas de couche de texte, ou un fichier chiffré : l’image de la page est transmise à un modèle qui lit les documents, et revient transcrite.", "hue": "build" },
    { "label": "Conserver l’original", "note": "Connecté, il part dans le stockage ; déconnecté, il voyage avec le tableau, de sorte que la remontée reste possible plus tard.", "hue": "measure" }
  ],
  "caption": "La porte de remontée était ouverte depuis le début et rien ne la franchissait : les dépôts illisibles étaient conservés et jamais retentés."
}
```

Il y a ensuite l’autre cas : une page qui ne contient aucun texte parce qu’elle n’en a jamais eu. Un contrat photographié. La numérisation d’un accord signé. Un CV que quelqu’un a imprimé, signé et numérisé de nouveau. Un fichier chiffré qui refuse catégoriquement l’extraction.

Aucune table de caractères n’aide ici, et un lecteur qui promet d’essayer produira volontiers une réponse fausse mais assurée. Le chemin honnête est donc la remontée : reconnaître que la page n’a pas de couche de texte, remettre l’image réelle à un modèle capable de lire des images de documents et la transcrire.

Trois décisions de cette remontée méritent d’être énoncées, car c’est là que ce type de fonctionnalité se trompe habituellement :

- **Elle transcrit ; elle ne résume pas.** L’appelant transforme le résultat en un document que quelqu’un va modifier. Un résumé substitué en silence à une transcription est un document qui a discrètement perdu la clause dont vous aviez besoin.
- **Elle signale ce qu’elle ne peut pas lire.** Un mot illisible revient marqué comme illisible plutôt que deviné. Une supposition dans un contrat est pire qu’une lacune.
- **Elle conserve l’original.** Connecté, le fichier part dans le stockage et le tableau garde une clé. Déconnecté — un tableau sans compte pour l’instant —, les octets voyagent avec le tableau lui-même. Dans les deux cas, la remontée reste possible plus tard, ce qui n’était pas le cas quand les dépôts illisibles étaient écartés.

## Ce que cela change

```bf-figure
{
  "kind": "stack",
  "title": "Des choses qui aboutissent désormais au lieu de caler",
  "bands": [
    { "label": "Un CV", "note": "Déposé en PDF ou en fichier Word, lu directement, et remis en forme via le moteur de modèles : pas de compte d’analyse tiers, pas de ressaisie.", "hue": "reach" },
    { "label": "Un contrat signé", "note": "Numérisé, transcrit et placé sur le tableau à côté de l’affaire à laquelle il appartient.", "hue": "run" },
    { "label": "Un relevé ou une facture", "note": "Lu sous forme de chiffres que vous pouvez placer à côté du reste de votre argent, au lieu d’une pièce jointe que personne n’ouvre.", "hue": "run" },
    { "label": "Un ancien document de politique", "note": "Uniquement image, vieux de plusieurs décennies, désormais du texte consultable que vous pouvez citer dans une réponse.", "hue": "measure" }
  ],
  "caption": "Le même chemin sert aux quatre, car la différence entre eux tient au lecteur qui s’est exécuté, pas au produit que vous avez dû ouvrir."
}
```

Il y a un point plus large à propos des produits qui détiennent vos documents. Dès qu’un fichier atterrit quelque part sous une forme illisible, tout ce qui se trouve en aval devient manuel : le résumé, l’extraction, la comparaison, la recherche. Les équipes ne le remarquent généralement pas comme un problème de document. Elles le remarquent comme « nous avons fini par faire cette partie à la main ».

Lire est le premier acte de [De l’idée au réel](/blog/idea-to-real-the-operating-methodology) pour une raison. Un brief, un appel d’offres, un contrat, une page numérisée de notes d’atelier : la méthode commence par comprendre ce que vous avez réellement dit, et elle ne peut pas du tout commencer face à un fichier arrivé sous forme d’icône.

---

**À lire aussi :** [Convertir un CV PDF en JSON structuré](/blog/parse-resume-pdf-to-structured-json) · [Comment évaluer votre CV pour les ATS](/blog/how-to-score-your-resume-for-ats) · [Tous les formats de diagrammes que le canevas lit](/blog/every-diagram-format-the-canvas-reads)

[Ouvrez un canevas](/create) et déposez le fichier qui n’a jamais fonctionné ailleurs.
