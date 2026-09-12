## Ouvrez l'outil et menez un audit pré-offre en 10 minutes

Ouvrez l'[outil Recherche employeur](/tools/employer-research) : vous y trouverez trois champs, **Entreprise**, **Poste** et **Ville**. Remplissez-en autant que vous le souhaitez et cliquez sur Lancer la recherche — l'outil interroge en parallèle les avis sur l'entreprise et les salaires par poste × ville, puis affiche les deux panneaux côte à côte.

La plupart des candidats font l'impasse sur cette étape et découvrent les mauvais côtés de l'entreprise la troisième semaine. L'outil existe pour vous éviter de jongler entre trois onglets pour mener le même audit.

**Minutes 1 à 3 — Les avis.** Saisissez le nom de l'entreprise. Le panneau Entreprises renvoie jusqu'à 6 résultats avec leur note globale et leur nombre d'avis. Cliquez sur *Avis* pour n'importe lequel d'entre eux afin d'accéder à la page d'avis complète (`/companies/{slug}/reviews`) et de consulter les six notes par axe : culture, leadership, équilibre vie pro/vie perso, rémunération, évolution de carrière, diversité. Si un axe se situe à plus de 1,0 point sous la moyenne globale, c'est sur ce point que vous devez poser des questions lors de votre dernier entretien.

**Minutes 4 à 6 — Le salaire par poste × ville.** Saisissez le poste visé et la ville. Le panneau Salaire affiche la fourchette basse, médiane et quartile supérieur, modélisée à partir du poste, de son niveau d'ancienneté, de la région et du mode de travail — avec chaque coefficient détaillé, pour que le chiffre soit un chiffre que vous pouvez discuter plutôt qu'un chiffre auquel vous devez faire confiance. Cliquez sur *Ouvrir le guide salarial complet* pour voir le même poste dans toutes les autres villes sur `/salary/{role}/{city}`.

**Minutes 7 à 10 — Le recoupement.** Sur la page d'avis complète, recherchez dans les avis rédigés les mots-clés *rémunération* ou *salaire*. Une bonne note en rémunération associée à une offre alignée sur le marché dans le panneau Salaire, c'est le feu vert. Une mauvaise note en rémunération associée à une offre sous le marché, c'est un signal clair : négociez ou passez votre chemin.

## Ce que signifient vraiment les six notes par axe

Glassdoor utilise une seule note globale. Builderforce répartit la note sur six axes, parce que les salariés donnent rarement une réponse uniforme :

- **Culture** — la dynamique d'équipe au quotidien, la sécurité psychologique, l'ambiance
- **Leadership** — la compétence et la constance des managers et de la direction
- **Équilibre vie pro/vie perso** — les horaires réellement attendus, les usages en matière de week-end et d'astreinte
- **Rémunération** — le salaire par rapport au marché et la structure des primes
- **Évolution de carrière** — la rapidité des promotions, le mentorat, la mobilité interne
- **Diversité et inclusion** — la représentation et l'équité dans les faits

Pour une note globale de 4,0, la *forme* compte davantage que le chiffre. Un 4,0 composé de (5, 5, 2, 5, 5, 2) n'a rien à voir avec (4, 4, 4, 4, 4, 4). Le premier, c'est une excellente culture avec des horaires éreintants et une équipe homogène ; le second, un employeur stable et équilibré.

Lorsque vous lisez les avis, triez par Plus récents — les entreprises évoluent plus vite que ce que reflètent les moyennes annuelles.

## Guides salariaux : pourquoi les chiffres diffèrent de ceux de Glassdoor

Les guides salariaux de Builderforce s'appuient sur les **offres d'emploi actives** de la plateforme, et non sur des déclarations anonymes. Cela a trois conséquences pratiques :

1. **Le modèle est vérifiable.** Une moyenne issue de données collectées vous donne un chiffre sans vous dire comment il a été obtenu. Ici, chaque fourchette indique la valeur de référence et chaque coefficient qui lui est appliqué, pour que vous puissiez vérifier si l'hypothèse faite sur votre région ou votre niveau d'ancienneté est bien celle que vous auriez retenue.

2. **La méthode est transparente.** Chaque page de salaire indique la valeur de référence et les coefficients qui sous-tendent la fourchette. Un modèle que l'on peut examiner se discute d'une façon qu'une moyenne opaque ne permet pas — si le coefficient régional ne correspond pas à votre marché, vous pouvez le dire avec une objection précise.

3. **La dimension géographique compte.** `/salary/product-manager/austin` donne un chiffre complètement différent de `/salary/product-manager/san-francisco`, même pour un même niveau d'entreprise — et la référence sur laquelle vous devez vous appuyer pour négocier est celle de la ville, pas la moyenne nationale.

Utilisez les liens vers les villes et postes associés en bas de chaque page de salaire pour pivoter rapidement : « Combien paie ce même poste à Seattle ? » ou « Combien gagne un Staff Engineer dans cette ville par rapport à un Principal ? »

## Trois stratégies de négociation à utiliser dès aujourd'hui

Une fois les deux panneaux remplis par l'outil, vous avez de quoi mener n'importe laquelle de ces stratégies :

**Stratégie 1 — La référence au marché.** Si le panneau Salaire montre que votre offre est inférieure à la moyenne de la ville pour votre poste, répondez : « Merci pour cette offre. D'après les offres actives pour ce poste à {city}, la moyenne s'établit à {fmt(avg)}. J'aimerais que nous partions de ce chiffre. » Citez l'URL `/salary/{role}/{city}` obtenue via le bouton *Ouvrir le guide salarial complet*. La charge de la preuve passe ainsi de « pourquoi je veux davantage » à « pourquoi votre offre est sous le marché ».

**Stratégie 2 — Le pivot par les avis.** Si l'axe rémunération de la page d'avis est inférieur à 3,5, admettez que la rémunération n'est pas le point fort de l'entreprise — et négociez fermement sur ce qui l'*est*. Si l'axe évolution de carrière est à 4,7, demandez de la clarté sur la trajectoire de promotion et un point à 6 mois assorti d'une augmentation définie. Si l'équilibre vie pro/vie perso est à 4,5, demandez une garantie explicite de télétravail.

**Stratégie 3 — La relance d'une offre qui date.** Si votre offre a plus de 2 semaines et que le panneau Salaire affiche désormais un niveau de marché plus élevé, écrivez : « Depuis notre dernier échange, j'ai étudié les grilles de rémunération actuelles pour des postes similaires à {city}. J'aimerais revoir l'offre pour l'aligner sur le {percentile} centile. » C'est particulièrement efficace dans les villes où les guides salariaux ont été mis à jour pendant la période d'attente de l'offre.

Ces trois stratégies fonctionnent mieux quand l'entreprise sait que vous avez fait vos devoirs. Coller une URL Builderforce issue de l'outil montre que vous vous appuyez sur une référence publique, et non sur une ambition personnelle.

## Quand se fier aux avis, et quand les relativiser

Fiez-vous davantage au signal lorsque :
- Le nombre d'avis est de **10 ou plus** et la note moyenne publiée reste stable sur les avis récents
- Les notes par axe sont **cohérentes** avec les points forts, points faibles et conseils rédigés
- Les avis proviennent de **plusieurs intitulés de poste** au sein de l'entreprise, pas d'une seule équipe

Relativisez le signal lorsque :
- Le nombre d'avis est **inférieur à 5** (un seul mauvais avis suffit à fausser la moyenne)
- La même plainte revient **mot pour mot** (souvent une vague d'avis coordonnée après un plan de licenciement)
- Les avis proviennent tous d'**un seul intitulé de poste** (probablement la mauvaise expérience d'une équipe, pas de toute l'entreprise)

Quand les avis et les données salariales se contredisent — de bons avis mais un salaire sous le marché —, l'explication la plus courante est une entreprise qui rémunère en actions. Demandez explicitement pendant l'entretien le volume de l'attribution d'actions et la durée de la période d'acquisition initiale (cliff).

## Questions fréquentes

### Les avis sur les entreprises publiés sur Builderforce sont-ils vérifiés ?

Les avis sont rattachés à des comptes utilisateurs authentifiés (un avis par utilisateur et par entreprise), et les auteurs peuvent obtenir un badge de salarié vérifié en faisant correspondre le domaine de leur e-mail professionnel au moment de publier leur avis. Les notes par axe sont stockées dans des colonnes numériques, ce qui permet à la plateforme d'auditer la dérive des agrégats et de signaler les pics suspects.

### D'où proviennent les données salariales ?

Elles sont modélisées, pas collectées. Une valeur de référence par discipline est ajustée selon le niveau d'ancienneté, la région et le mode de travail, et chaque page indique les coefficients appliqués. La fourchette est ainsi reproductible et vérifiable — les mêmes paramètres produisent toujours le même chiffre — et vous devez donc la considérer comme un point de départ solidement argumenté plutôt que comme la mesure d'un employeur en particulier.

### Quelle est la différence entre /salary/:role et /salary/:role/:city ?

`/salary/:role` agrège toutes les villes des États-Unis, ce qui est utile comme référence nationale. `/salary/:role/:city` se limite à une ville — le chiffre sur lequel vous devez réellement négocier, car la rémunération varie de 20 à 40 % entre les grands pôles technologiques.

---

**Essayez-le :** [Recherche employeur](/tools/employer-research) sur Builderforce.
