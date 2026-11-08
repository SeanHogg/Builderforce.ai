# Comment convertir un CV PDF en JSON structuré (guide pour développeurs)

## Le problème de l’analyse de CV

Les CV sont non structurés par nature. Il n’existe aucun standard universel pour la mise en page, le nom des sections, le format des dates ou l’organisation du contenu. Un CV peut mettre la formation en premier ou en dernier, utiliser « Expérience professionnelle », « Parcours professionnel » ou « Historique de carrière », écrire les dates sous la forme « 2020–2023 », « janv. 2020 - déc. 2023 » ou « 1/2020 à 12/2023 ».

Pour tout système qui doit traiter des CV à grande échelle — plateformes ATS, sites d’emploi, analyses RH, CRM de recrutement —, ces données non structurées doivent être converties dans un format cohérent et lisible par une machine. C’est l’analyse de CV.

Les analyseurs traditionnels à base d’expressions régulières échouent sur 20 à 30 % des CV en raison des variations de mise en page. Les analyseurs modernes pilotés par l’IA, comme l’outil PDF vers JSON de Builderforce, atteignent plus de 95 % de précision d’extraction en comprenant le contexte, et non en se contentant de reconnaître des motifs.

## Le schéma de sortie

L’outil PDF vers JSON de Builderforce produit un objet JSON propre avec ces champs de premier niveau :

```json
{
  "basics": {
    "name": "string",
    "email": "string",
    "phone": "string",
    "location": "string",
    "linkedin": "string",
    "website": "string",
    "summary": "string"
  },
  "work": [
    {
      "company": "string",
      "position": "string",
      "startDate": "YYYY-MM",
      "endDate": "YYYY-MM | Present",
      "highlights": ["string"]
    }
  ],
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "field": "string",
      "graduationDate": "YYYY"
    }
  ],
  "skills": ["string"],
  "certifications": ["string"]
}
```

Ce schéma est compatible avec le standard JSON Resume, ce qui facilite l’intégration avec les outils et pipelines existants.

## Comment utiliser l’analyseur

**Interactif (navigateur) :**
1. Ouvrez l’outil PDF vers JSON sur Builderforce/tools/pdf-to-json.
2. Déposez un fichier PDF ou collez le texte du CV.
3. Cliquez sur Analyser — l’IA extrait les données structurées et affiche le JSON.
4. Copiez le JSON ou téléchargez-le sous forme de fichier .json.

L’analyseur gère les mises en page à plusieurs colonnes, les tableaux, les mises en forme créatives et les titres de section non standard. Il fonctionne avec des PDF générés depuis Word, Google Docs, LaTeX, Canva et des outils de design.

## Pièges courants de l’analyse

**Les PDF composés uniquement d’images.** Certains PDF sont des images numérisées, pas du texte. Ils nécessitent une reconnaissance optique de caractères (OCR) avant l’analyse. L’analyseur de Builderforce inclut l’OCR pour les documents numérisés, mais la précision tombe à environ 85 % pour les numérisations de mauvaise qualité.

**Les CV multilingues.** L’analyseur fonctionne mieux avec des CV en anglais. La prise en charge d’autres langues s’améliore mais peut manquer des nuances dans le format des dates et le nom des sections.

**Les CV très travaillés graphiquement.** Les CV avec infographies, frises chronologiques, barres de compétences et mises en page circulaires perdent une part de nuance de mise en forme lors de l’extraction. Les données sont toujours capturées, mais les éléments purement visuels (comme une barre de compétence « Python à 85 % ») peuvent ne pas se traduire dans la sortie JSON.

**Les rôles fusionnés.** Si quelqu’un indique deux intitulés dans la même entreprise sur une seule ligne (« Ingénieur senior → Ingénieur staff, 2020–2024 »), l’analyseur peut créer une seule entrée au lieu de deux. Vérifiez ces cas par sondage.

## Foire aux questions

### Quels formats de fichier l’analyseur accepte-t-il ?

L’outil PDF vers JSON accepte les fichiers PDF et DOCX, ainsi que du texte brut collé. Les fichiers PDF peuvent être textuels ou numérisés (l’OCR est inclus).

### La sortie est-elle compatible avec le format JSON Resume ?

Oui. Le schéma de sortie suit le standard JSON Resume (jsonresume.org) avec de légères extensions pour les certifications et les compétences. Vous pouvez utiliser la sortie directement avec n’importe quel outil ou thème compatible JSON Resume.

---

**Essayez-le :** [PDF vers JSON](/tools/pdf-to-json) sur Builderforce.
