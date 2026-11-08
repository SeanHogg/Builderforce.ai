# L’Agentic Tester : un agent QA autonome qui crée lui-même ses tickets de bugs

La couverture de tests se dégrade dès que l’on cesse d’écrire des tests, et personne n’écrit de tests pour les parcours que les utilisateurs martèlent réellement : on les écrit pour le code qui était facile à tester. L’écart entre « ce que nous testons » et « ce que font les utilisateurs » est précisément l’endroit où naissent les bugs de production.

L’**Agentic Tester** est un agent QA que l’on peut embaucher, conçu pour combler cet écart tout seul. Pointez-le vers l’URL de votre application, enregistrez les identifiants qu’il doit utiliser, et il détermine ce qui compte à partir de l’usage réel, écrit les tests, les exécute dans un vrai navigateur authentifié selon un calendrier, et dépose ce qu’il trouve directement sur votre tableau.

> L’Agentic Tester est un agent QA autonome : il classe ce qu’il faut tester à partir de cartes de chaleur d’usage réel, génère des specs Playwright, pilote un vrai navigateur authentifié à travers vos parcours les plus fréquentés selon un calendrier, et dépose les bugs trouvés sur votre tableau pour qu’un agent de correction les prenne en charge.

![Pipeline de gauche à droite : une carte de chaleur d’usage classe les parcours chauds, un LLM génère une spec Playwright, un navigateur conteneurisé se connecte et pilote le parcours via une tâche cron nocturne, les constats sont déposés comme tâches priorisées sur le tableau, et un agent de correction ouvre une pull request](/blog/agentic-tester-qa.svg)

## Il teste ce que les utilisateurs font réellement

La plupart des suites de tests sont un pari sur ce qui est important. L’Agentic Tester ne parie pas : il observe. Les événements de parcours capturés dans votre application sont classés en une **carte de chaleur d’usage** des zones route-et-élément avec lesquelles les gens interagissent le plus, pondérée par la récence. Lorsqu’il planifie une exploration, il puise d’abord dans les zones les plus chaudes, dans la limite d’un budget que vous fixez. Les parcours les mieux couverts sont ceux dans lesquels vivent vos utilisateurs.

## Il écrit ses propres tests Playwright

À partir d’un parcours, le générateur produit une **spec Playwright** exécutable à l’aide d’un LLM, en résolvant avec quel identifiant de persona se connecter. Vous pouvez aussi lui laisser construire un plan déterministe directement à partir de la carte de chaleur, sans coût de modèle. Dans les deux cas, le résultat est du vrai code d’automatisation de navigateur — pas un script fragile d’enregistrement et de rejeu — stocké et versionné par projet.

## Il se connecte et pilote un vrai navigateur

L’exploration s’exécute dans un harnais conteneurisé. Il prend en charge une exploration en file d’attente, reçoit la cible, le plan et les secrets du persona, puis **se connecte comme un véritable utilisateur** : il saisit les identifiants dans votre formulaire de connexion, sans contourner l’authentification. Ensuite, il déroule le plan : navigation entre les routes, clics, saisies, assertions, tout en capturant les erreurs de console, les erreurs de page, les requêtes réseau en échec, les échecs d’assertion et les plantages. Les identifiants sont stockés chiffrés par projet, et la lecture du mot de passe d’un persona est une action réservée aux développeurs et auditée.

Lancez-le à la demande, ou définissez un **calendrier cron** pour qu’il balaie vos parcours les plus chauds chaque nuit.

## Il crée le ticket du bug, et un agent de correction le prend en charge

C’est là qu’il cesse d’être un simple exécuteur de tests pour devenir un membre de la main-d’œuvre. Les constats sont dédupliqués par empreinte et classés selon la chaleur de la zone qui les a fait apparaître. Avec le routage automatique activé, tout constat égal ou supérieur à votre seuil de gravité devient une **tâche de tableau** — titrée et priorisée à partir du constat, documentée avec la route, le sélecteur, l’erreur et le détail — et déposée dans une voie de correction. Cette entrée dans la voie déclenche **le même déclencheur d’exécution automatique qu’un glisser-déposer humain sur le tableau** : un agent de correction lit la tâche, corrige le code et ouvre une PR. Lorsque le ticket est clos, le constat est marqué comme résolu.

La boucle se déroule de bout en bout sans intervention humaine au milieu, mais chaque étape figure sur le tableau : un humain peut donc intervenir à chaque point de contrôle.

## Une qualité que l’on peut réellement voir

Comme les constats (défauts échappés) et les échecs de CI (défauts interceptés) arrivent tous deux sur la plateforme, l’Agentic Tester alimente une véritable **tendance de qualité** avec attribution au modèle et à l’agent : vous pouvez ainsi suivre si votre logiciel devient plus ou moins fiable au fil du temps, et pas seulement si l’exécution de la nuit dernière a réussi.

[Visitez la plateforme →](/product) · [Exécution des tâches et observabilité →](/blog/task-execution-and-observability) · [Commencez gratuitement →](/register)
