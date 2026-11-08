# Comment animer une cohorte en classe en tant que formateur sur Builderforce

## Cohortes ou cours à son rythme

Un cours à son rythme, c’est un apprenant seul face au contenu. Une cohorte en classe, c’est un *groupe* qui avance ensemble dans le contenu selon un calendrier, avec un formateur qui distribue des travaux et suit la progression. Les cohortes ajoutent de la responsabilisation et du rythme, les deux éléments qui améliorent le plus les taux d’achèvement.

Sur Builderforce, un formateur est un Creator ou un employeur ; un étudiant est un demandeur d’emploi en mode apprentissage. Aucun des deux n’est un nouveau rôle : la couche cohorte se superpose aux comptes que vous avez déjà. Vous trouverez vos classes dans un onglet de la page Outils à l’adresse [/tools?tab=classrooms](/training), et les étudiants voient leur côté sous l’onglet apprentissage.

## Étape 1 : créer une classe

Ouvrez [Classes](/training) et créez une cohorte. Donnez-lui un nom, une description et le cours ou parcours d’apprentissage autour duquel elle est construite. La cohorte est le conteneur : elle contient les membres et les travaux que vous leur donnerez.

Décidez de sa forme dès le départ : une cohorte à démarrage fixe où tout le monde commence ensemble, ou une cohorte continue que les étudiants rejoignent à mesure qu’ils s’inscrivent. Les cohortes à démarrage fixe offrent la plus forte responsabilisation entre pairs ; les cohortes continues sont plus faciles à exploiter à grande échelle.

## Étape 2 : inscrire les étudiants

Ajoutez des membres à la cohorte. L’appartenance est suivie explicitement, et l’accès à tout ce qui concerne la classe est régi par la même couture de permissions `canActFor` que celle utilisée dans le reste de la plateforme : un formateur agit sur sa propre cohorte et ne peut pas intervenir dans celle d’un autre.

Gardez des cohortes assez petites pour pouvoir prêter attention à chacun. La responsabilisation qui fait fonctionner les cohortes dépend du fait que le formateur voie réellement la progression de chaque étudiant ; cela cesse d’être possible au-delà d’une certaine taille : scindez donc un grand groupe d’arrivants en plusieurs cohortes plutôt qu’une seule salle géante.

## Étape 3 : distribuer des travaux d’apprentissage

Les travaux sont le levier du formateur. Affectez un module, une leçon ou un parcours entier à la cohorte avec une date d’échéance. Les étudiants voient le travail dans leur onglet apprentissage ; vous voyez qui l’a terminé.

Les travaux sont le pont entre le contenu et le rythme. Un cours à son rythme dit « voici le contenu ». Un travail dit « terminez le module 2 d’ici vendredi », et ce simple changement fait avancer une cohorte dans le cursus ensemble au lieu de dériver chacun de son côté.

## Étape 4 : surveiller les analyses

La classe présente des analyses de cohorte mises en cache : taux d’achèvement, qui est en retard, où les étudiants calent. Utilisez-les pour intervenir tôt : un étudiant qui n’a pas commencé à la deuxième échéance a besoin d’un coup de pouce avant de décrocher complètement.

Comme l’achèvement passe par le même LRS xAPI que celui qui soutient les cours, les analyses reposent sur de vrais enregistrements, pas sur des déclarations. Quand la cohorte termine, la même mécanique de certificats que celle des cours à son rythme délivre des titres vérifiables à vos étudiants.

## Foire aux questions

### « Formateur » est-il un type de compte distinct ?

Non. Un formateur est un Creator ou un employeur, et un étudiant est un demandeur d’emploi en mode apprentissage. La couche cohorte se superpose aux comptes existants : il n’y a aucun nouveau rôle à demander.

### Où trouver mes classes ?

Les classes se trouvent dans un onglet de la page Outils à l’adresse /tools?tab=classrooms, et non dans un élément distinct de la barre latérale. Les étudiants voient leurs formations suivies sous /tools?tab=learning.

### Comment l’accès est-il contrôlé entre les cohortes ?

Par la vérification de permission canActFor de la plateforme. Un formateur n’agit que sur les membres et les travaux de sa propre cohorte et ne peut pas intervenir dans une cohorte qui ne lui appartient pas, ce qui garde les données des étudiants cantonnées à la bonne classe.

---

**Essayez-le :** [Classes](/training) sur Builderforce.
