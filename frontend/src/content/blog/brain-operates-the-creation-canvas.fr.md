# Brain est un opérateur du canevas, pas un chatbot à côté du travail

Un assistant qui ne sait que décrire l’espace de travail laisse à l’utilisateur la charge d’effectuer chaque modification significative. Un assistant doté d’un accès illimité à l’état crée le problème inverse : personne ne peut dire ce qu’il a modifié ni s’il a franchi une limite.

Brain adopte un troisième modèle. Sur Creation Canvas, c’est un **opérateur à périmètre défini**, doté d’outils explicites, de contrats propres à chaque objet et d’un tampon de propositions relisible.

![Vue produit de Brain agissant sur un cadre sélectionné, avec les commandes de périmètre Canevas, Sélection et Cadre, et un tiroir de relecture listant les modifications proposées d’objets, de champs, de disposition, de connexions et d’actions natives avant application](/blog/brain-canvas-operator-workspace.svg)

## Le périmètre fait partie de la demande

Le compositeur peut cibler le canevas entier, la sélection en cours ou un cadre. Brain ne reçoit que les objets et les relations de ce périmètre résolu. Chaque objet apporte une vue de contexte sans contenu sensible : son type, son titre, les éléments structurés pris en charge, son statut actuel, ses actions déclarées, ses champs modifiables, sa disposition et les métadonnées de ses relations.

« Évalue ceci » et « évalue l’ensemble du plan de lancement » deviennent ainsi deux demandes sensiblement différentes. Le périmètre est un état visible, pas une supposition tirée de la formulation de la conversation.

## Brain travaille avec des outils de canevas explicites

Brain peut lire un instantané ; ajouter, mettre à jour, supprimer, organiser, masquer ou verrouiller un objet ; connecter des objets ; mettre à jour ou supprimer une connexion ; et invoquer les actions déclarées par un type d’objet. Il consulte le registre avant de rédiger, de sorte qu’un graphique, un agent, une feuille de route, un site web et un Evermind exposent chacun des champs et des actions pris en charge différents.

Les champs de mutation inconnus sont rejetés. Les clés sensibles, comme les secrets, jetons, mots de passe, identifiants, valeurs d’autorisation, clés d’API et cookies, sont filtrées des charges utiles de mutation comme du contexte IA. Des limites sur les chaînes, les tableaux, les objets et l’imbrication maintiennent le contexte borné.

![Brain lit un instantané délimité et le registre des objets, fait passer les champs rédigés par des listes d’autorisation et des filtres de données sensibles, puis place les modifications d’objets, de disposition, de connexions et d’actions dans un ensemble de propositions sélectionnable avant que les modifications approuvées n’atteignent l’état du canevas](/blog/brain-review-before-mutation.svg)

## Une mutation est une proposition, pas un effet de bord

Quand Brain veut créer une évaluation, réorganiser une présentation, connecter un jeu de données à un graphique ou invoquer une action de flux de travail, il enregistre une modification proposée. L’interface peut présenter l’ensemble sous forme d’opérations concrètes : ajouter cet objet, mettre à jour ces champs, connecter ces identifiants, organiser cet artefact, invoquer cette action.

L’utilisateur choisit ce qu’il applique. Une réponse portant sur plusieurs objets reste donc inspectable à la même granularité que le canevas lui-même.

Les actions opérationnelles reçoivent une limite supplémentaire. Les conseils d’inspection et de modification peuvent être renvoyés immédiatement. Les exécutions, la livraison, la publication, l’entraînement, les intégrations et les autres actions lourdes de conséquences sont proposés à la relecture. Dans une session locale anonyme, les actions qui nécessitent des ressources durables ouvrent la barrière de compte sans modifier le canevas.

## La capacité native reste avec l’objet

Brain ne simule pas chaque fonctionnalité dans une réponse de discussion. Il invoque les capacités déclarées par l’objet sélectionné. Un jeu de données peut être profilé ou visualisé. Un projet peut être développé ou comparé. Une maquette peut être livrée. Un Evermind peut s’entraîner, être évalué ou être publié. Un point quotidien peut démarrer.

Cela conserve un seul contrat entre l’usage manuel et l’usage par l’IA. Le bouton de l’inspecteur et l’action de Brain s’adressent à la même capacité de l’objet, aux mêmes permissions et au même artefact résultant.

## Le résultat est une capacité d’agir lisible

L’objectif n’est pas l’autonomie maximale. C’est une **capacité d’agir lisible** : Brain comprend le travail sous forme d’objets structurés, peut agir sur ces objets et laisse une surface de relecture exacte entre l’intention et le changement.

C’est ce qui fait du canevas davantage qu’une discussion entourée de cartes. Brain peut participer au travail sans le rendre opaque.

[Ouvrir Creation Canvas →](/create/new)
