# Comment synchroniser un CV maître vers LinkedIn, Indeed et tous les autres sites d’emploi

## Le coût caché de la dérive des profils

La plupart des demandeurs d’emploi entretiennent la même histoire de carrière à six ou sept endroits — LinkedIn, Indeed, Glassdoor, ZipRecruiter, un site de portfolio — et chacun d’eux devient lentement obsolète. Vous mettez à jour LinkedIn, vous oubliez Indeed, et trois mois plus tard un recruteur consulte un profil avec un titre périmé et un poste que vous avez quitté l’an dernier.

La dérive des profils vous coûte de deux façons. Elle vous fait paraître négligent aux yeux de quiconque recoupe vos profils, et elle signifie que la meilleure version de votre histoire ne vit qu’à un seul endroit pendant que les autres vous sous-vendent discrètement.

La solution est une source unique de vérité — un CV maître — et une manière fiable de le diffuser partout. C’est ce que fait la synchronisation de profil.

## Des blocs prêts à coller pour chaque fournisseur

La [synchronisation de profil](/tools/vendor-sync) prend en charge neuf fournisseurs aujourd’hui : LinkedIn, Indeed, Glassdoor, ZipRecruiter, Monster, Wellfound, Dice, GitHub et tout site de portfolio personnel.

Pour chaque fournisseur, elle génère des **blocs prêts à coller** adaptés aux champs de cette plateforme — Titre, À propos / Résumé / Points forts (l’ensemble exact dépend du fournisseur), expériences et compétences. Aucune extension de navigateur n’est nécessaire pour cela : ouvrez l’écran de modification du fournisseur, copiez le bloc correspondant, collez, enregistrez. Le contenu est déjà mis en forme comme l’attend cette plateforme : aucune taxe de remise en forme.

Comme chaque bloc est généré à partir du même CV maître, l’histoire reste cohérente partout : mettez à jour le maître une fois et régénérez.

## Synchronisation bidirectionnelle avec l’extension Chrome

Installez l’extension Chrome de Builderforce et la synchronisation de profil devient bidirectionnelle.

**Rapatriement :** lorsque vous avez modifié un profil directement sur LinkedIn (ou un autre fournisseur pris en charge), l’extension lit le volet de profil de votre onglet et propose de fusionner ces modifications dans votre CV maître. Vous examinez une boîte de dialogue de fusion et acceptez ou rejetez chaque champ : rien ne touche votre maître tant que vous ne l’avez pas dit.

**Remplissage automatique :** sur LinkedIn, Indeed, Glassdoor, ZipRecruiter, Wellfound, Dice et Monster, vous pouvez remplir automatiquement les champs Titre et À propos en un clic. Vous ouvrez vous-même la fenêtre de modification du fournisseur, cliquez sur Remplir automatiquement, vérifiez la valeur et cliquez sur Enregistrer chez le fournisseur : l’extension n’ouvre jamais de fenêtres automatiquement et n’enregistre jamais automatiquement. C’est le même cadre qu’un gestionnaire de mots de passe : il remplit, vous confirmez.

## Sûr par conception

Deux garde-fous empêchent la synchronisation de profil de vous surprendre. Au rapatriement, la boîte de dialogue de fusion est sur adhésion champ par champ : vous approuvez chaque modification avant qu’elle n’atteigne votre maître. À l’envoi, vous gardez la main sur le fournisseur : vous ouvrez la fenêtre de modification, vous vérifiez la valeur remplie, vous cliquez sur Enregistrer. Rien ne se passe dans votre dos.

La confidentialité est gérée de la même manière. Activez « Ne pas partager l’usage anonyme » dans les paramètres de l’extension pour désactiver entièrement la télémétrie. Lorsque l’adhésion est activée, l’extension consigne des *types* d’événements (par exemple « une capture a eu lieu sur cet hôte avec N champs »), jamais les valeurs littérales des champs ni le contenu extrait des pages. Les seules données qui quittent votre machine sont l’appel à l’extracteur LLM, qui est lié à votre compte.

Le bénéfice : un seul CV maître, cohérent partout, mis à jour en quelques minutes plutôt qu’en un après-midi de copier-coller — et vous pouvez même comparer en A/B quelle variante vous avez publiée où, pour voir quelle version obtient le plus de rappels.

## Foire aux questions

### Ai-je besoin de l’extension Chrome pour utiliser la synchronisation de profil ?

Seulement pour la synchronisation bidirectionnelle. Sans l’extension, vous obtenez quand même des blocs prêts à coller pour chaque fournisseur (Titre, À propos/Résumé/Points forts, Expérience, Compétences). Avec l’extension, vous pouvez aussi rapatrier les modifications de profil dans votre maître et remplir automatiquement les champs Titre et À propos sur LinkedIn, Indeed, Glassdoor, ZipRecruiter, Wellfound, Dice et Monster.

### La synchronisation de profil écrasera-t-elle mon LinkedIn sans demander ?

Non. Au rapatriement, vous examinez une boîte de dialogue de fusion et acceptez ou rejetez chaque champ avant que quoi que ce soit ne touche votre CV maître. À l’envoi, vous ouvrez vous-même la fenêtre de modification du fournisseur, cliquez sur Remplir automatiquement, vérifiez la valeur et cliquez sur Enregistrer : elle n’ouvre jamais de fenêtres automatiquement et n’enregistre jamais automatiquement.

### Puis-je synchroniser différentes variantes de CV vers différents fournisseurs ?

Oui. Choisissez un maître ou n’importe quelle variante par fournisseur. La synchronisation de profil se souvient de la variante que vous avez publiée où, afin que vous puissiez comparer en A/B quelle version obtient le plus de rappels.

---

**Essayez-le :** [Synchronisation de profil](/tools/vendor-sync) sur Builderforce.
