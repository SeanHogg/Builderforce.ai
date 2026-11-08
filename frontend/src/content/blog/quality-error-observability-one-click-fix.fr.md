# De la trace d’appels à la pull request : observabilité des erreurs avec correctif d’agent en un clic

Chaque outil de supervision des erreurs est une impasse élégante. Il regroupe vos plantages, les classe par fréquence, vous montre une trace d’appels — puis vous renvoie le travail. Quelqu’un doit encore la lire, trouver le fichier, écrire le correctif et ouvrir la PR. Le tableau de bord est l’endroit où le bug *s’arrête*, pas celui où il est *résolu*.

Le **pilier Qualité** de Builderforce.ai referme cette boucle. Il ingère les erreurs comme n’importe quel outil d’observabilité — puis transforme n’importe quel groupe d’erreurs en une tâche que votre main-d’œuvre d’agents prend en charge et livre sous forme de pull request.

> Builderforce.ai ingère les erreurs d’exécution de nombreuses sources, les regroupe par empreinte en groupes d’erreurs dédupliqués, et transforme n’importe quel groupe en une tâche de correction en un clic qu’un agent cloud prend en charge et livre sous forme de pull request : du plantage à la PR sur une seule surface.

![Pipeline de gauche à droite montrant une erreur d’exécution qui devient un groupe d’erreurs à empreinte, le tableau /quality, une tâche de correction en un clic, et un agent cloud qui livre une pull request dans un même fil](/blog/quality-observability.svg)

## Ingérez depuis l’endroit où vivent déjà vos erreurs

Vous n’avez pas à arracher ce que vous avez. Qualité normalise cinq sources derrière une seule forme d’événement canonique :

- **Native** — le SDK de navigateur `@seanhogg/builderforce-quality` capture automatiquement `window.onerror` et les rejets de promesses non gérés, les regroupe par lots et les envoie sur minuteur ou au masquage de la page via `sendBeacon` pour que rien ne soit perdu à la navigation. Ajoutez une seule balise `<script>` et vous rapportez.
- **OpenTelemetry (OTLP)** — pointez votre exportateur OTLP existant vers le point d’ingestion ; les journaux de niveau erreur et les spans à statut d’erreur deviennent des événements d’erreur.
- **Sentry, PostHog, LogRocket** — connectez un webhook et la plateforme vérifie sa signature HMAC, normalise la charge utile et l’intègre au même flux. Les connexions Sentry peuvent rattraper les anciens tickets à l’association.

Chaque source arrive sous la forme du même `NormalizedErrorEvent` : tout ce qui se trouve en aval — regroupement, tableau de bord, correctif — est indépendant de la source.

## Un regroupement par empreinte qui ne vous noie pas

Les événements bruts sont du bruit ; les **groupes** sont du signal. Chaque événement reçoit une empreinte — explicite lorsque la source en fournit une, sinon dérivée du cadre de pile supérieur plus un message normalisé (littéraux, hexadécimaux, UUID et nombres bruts supprimés, pour que le même bug ne se divise pas en mille groupes). Les événements sont insérés ou mis à jour dans un groupe indexé par `(tenant, project, fingerprint)`, en incrémentant les compteurs d’occurrences et d’utilisateurs distincts exacts, en actualisant l’exemple de trace d’appels et en rouvrant un bug résolu s’il réapparaît.

Le tableau de bord `/quality` liste ces groupes par statut et par niveau, avec une tendance sur 14 jours et le nombre d’utilisateurs touchés pour chacun : vous triez ce qui fait réellement mal aux utilisateurs, et non un flot d’événements individuels.

## Le bouton qui livre le correctif

Ouvrez un groupe, lisez la trace et cliquez sur **Corriger avec l’agent**. Builderforce.ai crée une tâche de tableau — titrée d’après l’erreur, priorisée selon son niveau (fatal → urgent, erreur → élevé, et ainsi de suite), documentée avec le type, l’environnement, l’URL, les nombres d’occurrences et d’utilisateurs et la trace d’appels — et envoie immédiatement un agent cloud. L’agent lit le brief, trouve le code, écrit la modification et ouvre une pull request. Le groupe d’erreurs renvoie vers la tâche : le plantage, le correctif et la PR vivent donc sur un seul fil.

Comme il s’appuie sur la même plateforme instrumentée, le volume d’erreurs est une ressource mesurée (`error_events`) qui s’intègre à la même vue de consommation que les jetons et l’ingestion : une seule source de vérité sur ce que vous utilisez, appliquée exactement comme elle est affichée.

## Pourquoi c’est important

Une observabilité qui s’arrête à un tableau de bord rend les erreurs *visibles*. Une observabilité câblée dans une main-d’œuvre d’agents les fait *disparaître*. Quand la même plateforme qui fait remonter le plantage peut aussi l’affecter, le corriger et en faire une PR, le délai moyen de résolution cesse de dépendre de qui est d’astreinte et dépend de la vitesse de travail de vos agents.

[Visitez la plateforme →](/product) · [Lisez la pile d’agents à sept couches →](/blog/agent-tech-stack-all-seven-layers) · [Commencez gratuitement →](/register)
