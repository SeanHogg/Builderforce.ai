Le deck du conseil d'administration a toujours été honnête. La diapositive Équipes est tirée des événements d'effectifs, la diapositive Investissement des chiffres trimestriels de R&D, la diapositive Qualité des incidents et des tickets de support, la diapositive IA de l'adoption des outils. Rien n'est saisi dans un modèle ; chaque chiffre est une requête sur une table.

Ce qui soulève une question évidente pour les jeux de données qu'aucun connecteur n'alimente : **comment les lignes arrivent-elles dans la table ?**

Pendant un temps, la réponse honnête était : une par une, via un formulaire de suivi. Un responsable financier avec trois trimestres de dépenses dans un tableur avait une centaine de soumissions de formulaire devant lui. La plupart ne s'y sont pas mis, les vues sont restées vides, et une vue vide ressemble furieusement à une fonctionnalité qui ne marche pas.

Il existait, techniquement, une deuxième voie. Un endpoint d'import existait, rattaché à l'API Analyses, utilisé uniquement par les outils de Brain. Et il y avait une page `/import` — un assistant guidé et un outil d'import en masse — vers laquelle rien ne pointait, qui ne connaissait qu'un « enregistrement » générique avec un nom et une priorité, et qui terminait chaque soumission en attendant six cents millisecondes avant d'afficher un numéro de référence qu'elle venait d'inventer. Un échafaudage déguisé en fonctionnalité.

## Ce qu'est l'import aujourd'hui

Il existe une seule surface d'import, et la page en est une véritable façade.

```bf-figure
{
  "kind": "flow",
  "title": "Un fichier devient des lignes que les vues peuvent lire",
  "steps": [
    { "label": "Choisir un type", "note": "Événements d'effectifs, postes ouverts, données financières de R&D, incidents, disponibilité, adoption de l'IA — le propre registre du serveur, listé par le serveur.", "hue": "measure" },
    { "label": "Faire correspondre", "note": "Vos en-têtes sont associés aux colonnes du type par leur nom ; toute erreur de correspondance se corrige d'un menu déroulant. Les colonnes obligatoires sont marquées d'une étoile.", "hue": "measure" },
    { "label": "Vérifier", "note": "Chaque cellule est vérifiée selon le type de sa colonne, dans votre langue, et le serveur traite le même fichier à blanc pour indiquer quelles lignes il écrirait.", "hue": "measure" },
    { "label": "Envoyer", "note": "Les lignes valides partent par lots de cinq cents. La barre avance quand le serveur accuse réception d'un lot, pas selon un minuteur.", "hue": "measure", "tag": "vraie progression" }
  ],
  "caption": "Les colonnes ne sont pas redéfinies sur la page. Elles sont lues dans le registre de l'API : une colonne ajoutée à un jeu de données atteint l'outil de correspondance, le modèle et l'assistant sans seconde déclaration."
}
```

Trois points méritent d'être dits clairement, parce que chacun remplace quelque chose qui était auparavant simulé.

**Les colonnes viennent du serveur.** La page interroge `/api/import/kinds` et reçoit chaque jeu de données importable avec ses colonnes, leurs types, le caractère obligatoire ou non de chacune et un exemple de valeur réaliste. Le modèle CSV que vous téléchargez est généré à partir de cette liste ; l'indication affichée dans chaque champ de l'assistant est l'exemple de la colonne. Aucune copie du schéma côté client ne risque de diverger.

**La vérification, ce sont deux vérifications.** Avant toute écriture, le client valide chaque cellule associée — un nombre qui n'en est pas un, une date qui n'en est pas une, une colonne obligatoire laissée vide — et vous indique la ligne et la colonne, dans votre langue. Les mêmes lignes partent ensuite vers le serveur avec `dryRun: true`, et le serveur répond avec ce qu'il *écrirait* et les lignes qu'il ignorerait. La première vérification vous dit quelle cellule ; la seconde fait foi sur ce qui sera réellement enregistré.

**La progression est réelle.** Les lignes sont envoyées par lots, et le compteur affiche *envoyées sur total* à mesure que le serveur accuse réception de chacun. Si un lot échoue en cours de route, la page le signale, conserve ce qui a déjà été écrit et affiche le total cumulé plutôt que de faire comme si de rien n'était.

```bf-figure
{
  "kind": "screen",
  "frame": "Import en masse, à l'étape de vérification",
  "ratio": 1.5,
  "regions": [
    { "label": "Type", "note": "Un jeu de données, choisi dans le registre", "x": 4, "y": 6, "w": 92, "h": 10, "hue": "measure" },
    { "label": "Lignes du fichier · valides · en erreur · que le serveur écrira", "note": "Quatre compteurs, deux sources", "x": 4, "y": 20, "w": 92, "h": 16, "hue": "accent" },
    { "label": "Ligne 12 · effectiveOn · doit être une date", "note": "La vérification client, par cellule, traduite", "x": 4, "y": 40, "w": 60, "h": 34, "hue": "bad" },
    { "label": "Lignes que le serveur ignorerait", "note": "Les propres lignes du traitement à blanc", "x": 68, "y": 40, "w": 28, "h": 34, "hue": "muted" },
    { "label": "Retour · Annuler · Importer 188 lignes", "x": 4, "y": 80, "w": 92, "h": 12, "hue": "accent" }
  ],
  "caption": "Le bouton Importer compte les lignes qui ont passé la vérification client, et le traitement à blanc du serveur s'affiche à côté pour que vous sachiez ce que ce chiffre deviendra."
}
```

## Le parcours guidé existe toujours

Tous les enregistrements ne tiennent pas dans un fichier. Un incident isolé, un poste ouvert, les chiffres des outils IA de ce mois-ci — l'assistant les prend un par un, en vérifiant chaque champ au moment où vous le quittez et avec une étape de relecture avant l'envoi. Ce qui a changé, c'est la fin : il soumet l'enregistrement via le même endpoint que l'import en masse et vous montre la réponse du serveur — écrit, ou ignoré et pourquoi. Le numéro de référence inventé a disparu, parce qu'un reçu que vous avez inventé n'est pas un reçu.

## Sa place dans la méthode

L'import est une capacité de l'étape **Mesurer**. L'arc est Idée → Créer → Piloter → Mesurer, et Mesurer est l'acte qui renvoie une réponse évaluée à Idée — c'est là que la boucle se referme. Une vue qui lit une table vide ne peut rien évaluer ; elle peut seulement donner l'impression qu'elle s'apprête à le faire. Les vues Équipes, R&D, Qualité et IA ont été conçues pour dire honnêtement ce que fait réellement l'espace de travail, et la seule chose qui les séparait de cette honnêteté, c'était le coût d'y faire entrer un trimestre de faits.

```bf-figure
{
  "kind": "compare",
  "title": "Le coût d'une vue fidèle",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": ["Ouvrir le formulaire de suivi", "Saisir une ligne", "Envoyer", "Recommencer cent fois", "Ou laisser la vue vide", "Ou demander à Brain d'appeler un endpoint que la page ignorait"] },
    { "title": "Maintenant", "hue": "measure", "items": ["Télécharger le modèle du type", "Le remplir, ou exporter depuis l'outil où se trouvent déjà les chiffres", "Faire correspondre, vérifier, envoyer", "Regarder la vue se redessiner"] }
  ],
  "caption": "L'import est un onglet d'Analyses parce que c'est là que les lignes importées apparaissent. La page n'avait aucune porte d'entrée auparavant ; désormais, la porte est juste à côté de la pièce."
}
```

## Ce que vous pouvez en faire dès aujourd'hui

- **Chargez un trimestre de données financières de R&D, de revenus et de répartition des ETP** à partir de trois petits fichiers, et lisez la vue Investissement au regard du plan.
- **Reprenez l'historique des événements d'effectifs et des postes ouverts** pour que la cascade et l'attrition de la diapositive Équipes soient tirées de votre historique, et non du jour de votre inscription.
- **Importez les incidents, les tickets de support et les relevés de disponibilité** depuis un export de l'outil qui les contient, et laissez la vue Qualité évaluer le trimestre.
- **Enregistrez l'adoption des outils IA et les dépenses du programme** mois par mois, et voyez la vue IA calculer les heures gagnées par dollar.
- **Demandez à Brain de le faire** — son outil `board_data.import` utilise le même contrat, traitement à blanc compris.

Tous ces cas se terminent de la même façon : une vue autrefois vide, qui affiche un vrai chiffre.

---

**À lire aussi :** [Évaluer la preuve et refermer la boucle](/blog/grade-the-proof-and-close-the-loop) · [La vision opérationnelle de chaque rôle](/blog/every-role-operating-picture)

[Ouvrez l'import](/import) et téléchargez un modèle pour le jeu de données que vous comptiez remplir depuis longtemps.
