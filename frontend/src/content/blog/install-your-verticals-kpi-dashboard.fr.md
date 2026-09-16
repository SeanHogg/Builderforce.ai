# Les indicateurs qui font vraiment tourner votre secteur, installés en un clic

Demandez à une fondatrice de SaaS ce qu'elle surveille : elle vous parlera de net revenue retention, de magic number, de délai de récupération. Posez la même question à un fondateur en biotechnologie et aucun de ces mots n'a de sens pour lui — il surveille la trésorerie disponible jusqu'au prochain résultat d'étude, et la masse salariale qui l'y conduira.

Jusqu'ici, tous les deux ouvraient le même onglet finances et y voyaient les mêmes trois chiffres.

C'est l'échec silencieux d'un tableau de bord générique. Il n'est pas faux. Il ne parle simplement pas *de vous*, et un chiffre qui ne parle pas de vous est un chiffre qu'on finit par ne plus ouvrir. L'onglet se charge, le solde de trésorerie est exact, et personne n'a appris quoi que ce soit qu'il ne savait déjà.

## Les tableaux de bord sont désormais des modèles

Un tableau de bord d'indicateurs n'est pas une fonctionnalité que nous avons écrite onze fois. C'est un **modèle de la marketplace**, exactement comme ceux qui installent un workflow ou un playbook : un petit manifeste qui déclare quels indicateurs vont ensemble, pose une question sur la taille de l'entreprise, et matérialise un tableau de bord opérationnel.

```bf-figure
{
  "kind": "flow",
  "title": "Du secteur à un tableau de bord qui veut dire quelque chose",
  "steps": [
    { "label": "Déclarer", "note": "Le profil de votre entreprise connaît déjà son secteur. Rien de nouveau à renseigner.", "hue": "read" },
    { "label": "Installer", "note": "Un modèle par secteur, depuis la Marketplace. Il pose une seule question — petite, moyenne ou grande — car la plage saine d'un indicateur évolue avec la taille de l'entreprise.", "hue": "make" },
    { "label": "Mesurer", "note": "Les tuiles se résolvent contre vos données réelles de finances et de capital. Un indicateur sans données derrière lui s'affiche comme non mesuré, jamais comme zéro.", "hue": "make", "tag": "dans l'onglet finances" }
  ],
  "caption": "Onze tableaux de bord, un seul mécanisme. Ajouter un douzième secteur est un changement de données, pas une nouvelle version."
}
```

Dix secteurs sont disponibles aujourd'hui — IA/ML, SaaS, FinTech, santé numérique, MedTech, BioTech, climat et énergie, matériel et robotique, cybersécurité et places de marché — plus un tableau de bord fondateur pour tous ceux dont le secteur n'a pas encore sa propre cohorte.

## Nul n'est pas zéro

Le détail qui a demandé le plus de travail est celui que personne ne réclame : que fait une tuile quand elle n'a rien à montrer ?

Un tableau de bord qui affiche `0` pour un indicateur non mesuré ment activement. Une rétention nette de revenus à zéro est une catastrophe ; *pas encore de données de NRR* est un mardi ordinaire. Sur la plupart des tableaux de bord, les deux se ressemblent trait pour trait, et le prix à payer, c'est une fondatrice qui s'affole devant un chiffre irréel — ou, bien plus probablement, qui apprend à se méfier de tout l'écran.

Alors un indicateur sans données derrière lui dit qu'il n'est pas mesuré, et ne dit rien d'autre. Pas de zéro de remplissage, pas de tiret qu'on pourrait lire comme une valeur, pas de courbe de tendance inventée. Vous voyez d'un coup d'œil lesquels de vos chiffres sont réels, ce qui est la condition préalable pour agir sur l'un d'eux.

```bf-figure
{
  "kind": "compare",
  "title": "Ce qu'une tuile vide a le droit d'affirmer",
  "columns": [
    { "title": "Le tableau de bord habituel", "hue": "muted", "items": ["Affiche 0", "Trace une ligne plate à partir de rien", "La colore en rouge", "La fondatrice s'affole, ou cesse de regarder"] },
    { "title": "Ici", "hue": "make", "items": ["Indique que l'indicateur n'est pas mesuré", "Ne trace rien", "Laisse la tuile calme", "Les chiffres réels restent lisibles"] }
  ],
  "caption": "La valeur d'un tableau de bord se décide à la façon dont il se comporte quand les données manquent, pas à son allure quand il est plein."
}
```

## Sa place dans la méthode

C'est **Measure** — l'acte qui suit Run. [Read et Prove](/blog/read-prove-build-the-inner-loop) vous disent si une chose mérite d'être construite ; Build et Run la mettent en ligne. Measure est le moment où vous découvrez si elle a produit un effet, et c'est l'acte le plus souvent sauté, parce que monter un tableau de bord a toujours été un petit projet en soi.

Faire du tableau de bord un modèle réduit ce projet à une installation. Ce que vous obtenez n'est pas un point de départ à configurer pendant quinze jours : ce sont les chiffres sur lesquels les entreprises comme la vôtre sont déjà jugées, résolus contre vos propres données, dans l'onglet que vous ouvrez déjà.

## Ce que vous pouvez en faire dès aujourd'hui

- **Installez le tableau de bord de votre secteur** depuis la Marketplace, ou depuis l'état vide de l'onglet finances, qui connaît déjà votre secteur et pointe directement vers le bon modèle.
- **Lisez-le à côté de la trésorerie disponible et des flux de trésorerie** — le tableau de bord est un troisième onglet du hub finances, pas une destination distincte.
- **Repérez les chiffres que vous ne mesurez pas encore**, énoncés clairement, pour qu'en instrumenter un devienne une décision et non un hasard.
- **Ajustez les plages à votre taille** — le même indicateur n'a pas la même plage saine à dix personnes et à quatre cents, et le modèle pose la question une fois.
