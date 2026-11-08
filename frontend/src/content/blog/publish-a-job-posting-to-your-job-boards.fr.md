# Publiez une offre d’emploi sur vos sites d’emploi — et sachez où elle est réellement en ligne

Toute recherche commence par le même acte : mettre le poste devant les gens. Sur le canevas, c’était le seul acte qu’une offre d’emploi ne pouvait pas accomplir.

Vous pouviez rédiger la demande de recrutement avec Brain, lui donner un vrai enregistrement dans l’espace de travail, classer une pile de CV par rapport à elle et compter les candidatures reçues. La carte avait même un champ pour indiquer où elle était publiée — `distribution`, une ligne par site, avec un statut, une date et un lien. Rien n’y écrivait. L’espace de travail livrait déjà des connecteurs de sites d’emploi pour Greenhouse, Lever, Ashby, Indeed, LinkedIn Jobs et un flux de site carrières, chacun capable de créer une offre, et rien ne les appelait pour une vraie demande de recrutement. « Publier ce poste » aboutissait donc à un document, et le volume de candidatures était nul parce que personne n’avait été informé que l’offre existait.

## Diffuser, depuis la carte

Une carte d’offre d’emploi dispose désormais d’une commande **Diffuser**. Elle liste les sites que votre espace de travail a connectés, vous cochez ceux que vous voulez et vous appuyez sur le bouton.

```bf-figure
{
  "kind": "flow",
  "title": "Ce que fait une pression sur Diffuser",
  "steps": [
    { "label": "Choisir les sites", "note": "Seulement les sites que vous avez connectés, et seulement ceux où l’offre n’est pas déjà en ligne.", "hue": "run" },
    { "label": "Publier", "note": "Chaque site reçoit la même offre : le titre, la description et les exigences de l’enregistrement, plus le lieu et le niveau d’ancienneté de votre carte.", "hue": "run" },
    { "label": "Lire la réponse", "note": "La réponse du site est lue pour y trouver son propre identifiant de l’offre, et son lien public lorsqu’il en fournit un.", "hue": "run" },
    { "label": "L’enregistrer", "note": "Une ligne par site dans l’espace de travail : En ligne avec l’identifiant du site, ou Échec avec la raison du site.", "hue": "measure", "tag": "la carte lit ceci" }
  ],
  "caption": "Chaque appel passe par le même environnement d’exécution de connecteurs que toutes les autres intégrations : vos identifiants par espace de travail, vérifiés, consignés et audités."
}
```

Vous pouvez aussi simplement demander. Dites à Brain de publier le poste : il lit où l’offre est déjà en ligne et quels sites sont connectés, vous demande lesquels utiliser, puis seulement publie. Publier met le nom de votre entreprise sur un site public : l’opération est donc soumise à la même règle d’approbation que l’envoi d’une campagne.

```bf-figure
{
  "kind": "screen",
  "frame": "Une carte d’offre d’emploi",
  "ratio": 1.3,
  "regions": [
    { "label": "La demande de recrutement", "note": "Poste, niveau, lieu, critères indispensables, nombre de candidats", "x": 4, "y": 6, "w": 92, "h": 34, "hue": "idea" },
    { "label": "Publié sur", "note": "Lever : En ligne, depuis le 9 oct., Voir l’offre · Indeed : Échec, Non autorisé", "x": 4, "y": 44, "w": 92, "h": 22, "hue": "run" },
    { "label": "Publier sur", "note": "Greenhouse · Ashby · Flux carrières", "x": 4, "y": 70, "w": 60, "h": 14, "hue": "accent" },
    { "label": "Diffuser sur 2 sites", "x": 4, "y": 87, "w": 44, "h": 8, "hue": "accent" }
  ],
  "caption": "La liste des endroits où elle est en ligne est lue depuis l’espace de travail à chaque ouverture de la carte, et non conservée sur la carte."
}
```

## « En ligne » signifie que le site l’a dit

Le plus difficile n’était pas d’appeler six API. C’était de décider ce qui compte comme publié.

Un HTTP 200 n’est pas une publication. Ashby répond à chaque requête par un 200 et place le refus dans le corps. Les API GraphQL comme celle d’Indeed font de même. Le point d’accès d’offres d’emploi de LinkedIn est un appel par lot dont les échecs par offre se trouvent à l’intérieur d’une réponse réussie. Un système qui se fierait au code d’état dirait à un recruteur qu’un poste est en ligne sur trois sites alors qu’il l’est sur un seul, et les candidats qui iraient voir ne trouveraient rien.

Un site n’est donc affiché comme **En ligne** que lorsque sa réponse portait son propre identifiant de l’offre. Tout le reste est affiché comme **Échec**, avec la raison donnée par le site. La règle est aussi appliquée par la base de données : une ligne confirmée sans l’identifiant du site ne peut pas être écrite.

```bf-figure
{
  "kind": "compare",
  "title": "Ce que peut signifier la réponse d’un site",
  "columns": [
    { "title": "Enregistré comme En ligne", "hue": "run", "items": ["Le site a répondu avec son identifiant de l’offre", "Son lien public est affiché lorsqu’il en a renvoyé un", "Appuyer de nouveau sur Diffuser l’ignore : l’offre n’est donc jamais publiée deux fois"] },
    { "title": "Enregistré comme Échec", "hue": "muted", "items": ["Le site a refusé la requête", "Il a répondu 200 mais signalé une erreur à l’intérieur", "Il a répondu 200 sans identifiant de l’offre", "Un identifiant de connexion ou un champ obligatoire manquait"] }
  ],
  "caption": "Un site en échec peut être relancé. Un site en ligne est laissé tranquille, car une seconde création sur la plupart des sites est une seconde offre."
}
```

Cette décision explique aussi pourquoi chaque site est traité par le même code. Chaque connecteur indique déjà, sous forme de données, où va chaque entrée dans la requête. Il indique désormais aussi où l’identifiant de l’offre et le lien reviennent dans la réponse : `data.id` et `data.urls.show` pour Lever, `results.id` pour Ashby, l’identifiant du premier élément pour LinkedIn, avec un en-tête en dernier recours. Ajouter un site, c’est une nouvelle entrée dans le catalogue, pas une nouvelle branche dans l’éditeur de publication, et un site incapable de nous donner son identifiant n’est jamais proposé comme cible.

## Les candidats, par site

Les candidatures d’une offre étaient déjà ventilées par source. Désormais, chaque site sur lequel l’offre est partie apparaît dans cette ventilation sous son propre nom, avec son vrai décompte. Y compris zéro, car « Indeed : 0 au bout de deux semaines » est exactement le chiffre qui vous dit qu’un site ne fonctionne pas. L’omettre se lirait comme « jamais publié là ». Les lignes de sites sur la carte portent le même décompte.

Le rapprochement est exact. Une candidature enregistrée comme provenant d’un site porte la clé de ce site, et l’identifiant de l’offre elle-même voyage vers chaque site afin que le site puisse le renvoyer. Une source en texte libre comme « LinkedIn » saisie sur une candidature est laissée telle quelle plutôt que devinée comme étant le site LinkedIn Jobs, car un candidat mal attribué donne la mauvaise réponse à la seule question pour laquelle cette ventilation existe.

## Sa place dans la méthode

Exécuter. Idée et Réaliser ont produit la demande de recrutement : le poste, le niveau d’exigence, l’enregistrement qui la sous-tend. Exécuter est le moment où elle commence à agir dans le monde, et une recherche de recrutement ne commence à agir que lorsque les candidats peuvent la voir.

```bf-figure
{
  "kind": "flow",
  "title": "Une demande de recrutement tout au long de la méthode",
  "steps": [
    { "label": "Idée", "note": "Rédiger le poste avec Brain sur le canevas", "hue": "idea" },
    { "label": "Réaliser", "note": "Lui donner un vrai enregistrement ; classer des CV par rapport à elle", "hue": "make" },
    { "label": "Exécuter", "note": "La diffuser sur les sites et voir où elle est en ligne", "hue": "run", "tag": "nouveau" },
    { "label": "Mesurer", "note": "Candidats par site ; quels sites sont silencieux", "hue": "measure" },
    { "label": "Portée", "note": "Le flux carrières la place sur tous les agrégateurs sans API partenaire", "hue": "reach" }
  ],
  "caption": "La carte reste une prise sur l’enregistrement à chaque étape : les décomptes, les sites et les liens sont lus depuis l’espace de travail, jamais saisis."
}
```

## Ce que vous pouvez en faire dès aujourd’hui

- **Publier un poste sur plusieurs sites à la fois** depuis la carte d’offre d’emploi, ou en le demandant à Brain.
- **Voir où elle est réellement en ligne**, avec un lien vers la fiche de chaque site lorsque le site en fournit un.
- **Relancer un site en échec** après avoir corrigé la raison qu’il a donnée, sans publier deux fois là où cela a déjà fonctionné.
- **Comparer les sites selon les candidats**, y compris ceux qui n’ont encore produit personne.
- **Atteindre la longue traîne** grâce au flux de site carrières, que tout agrégateur sans API partenaire lit.

---

**À lire aussi :** [Déléguez la recherche, pas la décision](/blog/delegate-the-search-not-the-decision) · [Exécutez l’application que votre tableau vient de construire](/blog/run-your-app-on-the-canvas)

[Ouvrez un canevas](/create), ajoutez une offre d’emploi et connectez un site d’emploi sous Intégrations.
