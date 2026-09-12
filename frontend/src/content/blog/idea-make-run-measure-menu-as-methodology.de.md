Öffnen Sie fast jede Business-Plattform, und das Menü links ist ein Organigramm. Vertrieb. Marketing. Finanzen. Engineering. Personal. Eine völlig vernünftige Liste – und sie beantwortet eine Frage, die nur ein bereits bestehendes Unternehmen stellen kann: *Wessen Abteilung ist das?*

Wer mit einer Idee kommt, kann diese Frage nicht beantworten. Er hat keine Abteilungen. Er hat etwas, das er bauen will, und keine Ahnung, was als Nächstes passiert.

Deshalb gruppiert Builderforce seine Ziele stattdessen danach, **wo Sie auf Ihrem Weg stehen**.

```bf-figure
{
  "kind": "stack",
  "title": "Jedes Ziel liegt in genau einer dieser Phasen",
  "bands": [
    { "label": "Idee", "note": "Was wäre, wenn? – Canvas. Eine Zeile, weil es in dieser Phase genau eine Sache zu tun gibt.", "hue": "idea", "tag": "öffentlich" },
    { "label": "Bauen", "note": "Bauen Sie es. – Projekte, Workforce, Qualität, Zuverlässigkeit, Wissen, Embedded.", "hue": "make" },
    { "label": "Betreiben", "note": "Führen Sie es als Unternehmen. – Finanzen, Umsatz, Personal, Recruiting, Investoren, Governance, Support, Wachstum, Posteingang.", "hue": "run" },
    { "label": "Messen", "note": "Funktioniert es? – Insights: Delivery, Autonomie, Finanzen, DevEx, Compliance, Alerts.", "hue": "measure" },
    { "label": "Reichweite", "note": "Verkaufen, gefunden werden, wachsen. – der Marktplatz als zweite Eingangstür und das eigene Vertriebsprogramm jedes Kontos.", "hue": "reach", "tag": "öffentlich" }
  ],
  "caption": "Admin ist die sechste und bewusst unspektakulär. Niemand stöbert in den Einstellungen eines Produkts, bevor er sich registriert. Reichweite bestand früher aus zwei Bändern – Markt und Expansion –, bis sich zeigte, dass das zweite nur eine einzige Zeile enthielt; eine Überschrift mit nur einem Eintrag darunter ist ein Etikett, keine Architektur."
}
```

Die Reihenfolge ist das Argument. Von oben nach unten gelesen, ergibt sie einen Satz darüber, wie ein Unternehmen entsteht.

## Was das ersetzt hat – und warum es nicht nur unordentlich war

Hier lohnt es sich, konkret zu werden, denn „Wir haben die Navigation neu geordnet“ ist der uninteressanteste Satz in der Softwarewelt – und das hier war etwas anderes.

Es gab **vier** separate Listen, die ansteuerbare Ziele deklarierten. Eine für die Leiste im angemeldeten Bereich. Eine für die Marketingseiten. Eine für die Domänen des Datenmodells. Eine für den Footer. Den CFO gab es viermal, unter vier Namen – und einer dieser vier leitete angemeldete Kunden *aus dem Produkt heraus* auf eine Marketingseite, die genau das beschrieb, was sie bereits nutzten.

Das ist kein ästhetisches Problem. Das ist ein Mensch, der seine Sitzung verliert, um eine Broschüre über seinen eigenen Workspace zu lesen.

```bf-figure
{
  "kind": "compare",
  "title": "Vier Listen oder eine",
  "columns": [
    {
      "title": "Vier Registries",
      "hue": "bad",
      "items": [
        "Die Leiste sagte „Finanzen“, das Menü „Business Intelligence“.",
        "Ganze Ziele hatten überhaupt keine Marketingzeile, sodass das Menü ein kleineres Produkt bewarb als ausgeliefert.",
        "Der Footer listete eine ID, die nirgends deklariert war, und rendete stillschweigend eine zu kurze Spalte.",
        "Jede Korrektur musste an vier Stellen erfolgen, und die vierte fand man immer erst später."
      ]
    },
    {
      "title": "Eine Registry, projiziert",
      "hue": "good",
      "items": [
        "Leiste, Menüs, Footer und /features lesen dasselbe Array.",
        "Eine Fähigkeit, die das Produkt nicht hat, kann nicht auf der Marketingseite erscheinen.",
        "Die Frage einer Phase hat genau ein Zuhause und wird überall identisch dargestellt.",
        "Ein Build-Skript schlägt fehl, sobald eine zweite Liste auftaucht. Die Regel wird durchgesetzt, nicht erinnert."
      ]
    }
  ]
}
```

Die letzte Zeile ist die, die dafür sorgt, dass es hält. In der Testsuite gibt es einen Check, der jede Quelldatei nach einem Objekt durchsucht, das sowohl ein routenartiges als auch ein beschriftungsartiges Feld trägt – also ein Ziel unter anderem Namen – und den Build scheitern lässt, wenn er eines außerhalb der Registry findet. Ausnahmen gibt es, und jede muss einen ausformulierten Satz mitbringen, der erklärt, warum eine Registry-Zeile diesen Fall nicht abdecken konnte.

Eine *Zählung* würde Schulden herumliegen lassen, als wären sie Fortschritt. Eine *Liste von Begründungen* zwingt den nächsten Autor, laut auszusprechen, warum seine Ausnahme eine ist.

## Die Marketingseite ist eine Projektion

Hier kommt der Teil, der für alle, die die Website lesen, statt das Produkt zu nutzen, am meisten zählt: **`/features` wird aus genau dieser Registry erzeugt.**

Die Phasentabelle, die Ziel-Chips, die Zahlen in der Übersichtskarte – alles berechnet. Die Seite kann also kein Ziel bewerben, das es nicht gibt, und keines auslassen, das es gibt. Eine Marketingzahl, die vom Produkt abweicht, ist die billigste Lüge, die man ausliefern kann – und bei Weitem die teuerste, wenn man sie bemerken muss.

```bf-figure
{
  "kind": "flow",
  "title": "Eine Deklaration, vier Abnehmer",
  "steps": [
    { "label": "Die Registry", "note": "Ein Array. Jede Zeile trägt ihren Owner (welcher Sitz), ihre Phase (wo im Bogen) und die Stufe, ab der sie aktiv wird.", "hue": "make" },
    { "label": "Die linke Leiste", "note": "Gruppiert nach Phase. Zeilen oberhalb Ihrer Stufe sind abgedunkelt, nie versteckt – eine abgedunkelte Zeile ist eine Einladung, eine fehlende Zeile ein Geheimnis.", "hue": "run" },
    { "label": "Die öffentlichen Menüs", "note": "Produkt ▾ zeigt Idee · Bauen · Betreiben · Messen. Lernen ▾ zeigt Lesen · Nachweisen · Bauen mit.", "hue": "read" },
    { "label": "/features", "note": "Dieselben Zeilen noch einmal als Tabelle, mit der Frage, die jede Phase beantwortet, und einem Link pro Ziel.", "hue": "measure" }
  ],
  "caption": "Die drei Spalten des Lernen-Menüs sind die drei Akte der Methode mit einem zweiten Hut – lesen, nachweisen, damit bauen. Dieser Gleichklang ist keine Dekoration; es ist dieselbe Haltung, angewandt darauf, das Produkt kennenzulernen, statt etwas damit zu bauen."
}
```

## Schrittweise Offenlegung – und warum nichts versteckt wird

Eine Zeile wird **immer angezeigt**. Was der Weg freischaltet, ist ihr *Zustand*, nicht ihre Existenz.

Wer kein Konto hat, sieht alles: den CFO, den Recruiter, die Governance-Oberfläche, die ganze Besetzung – abgedunkelt, mit einer ehrlichen Zeile und einem einzigen Setup-Button, der zu dem führt, dem das gehört, was man zuerst bräuchte. Der Button des CFO übergibt an den CEO, denn der CEO verantwortet die Unternehmensgründung, und einen CFO kann es nicht geben, bevor es ein Unternehmen gibt.

Die Begründung passt in einen Satz: **Niemand fragt nach einer Fähigkeit, die er nie gesehen hat.** Die Business-Oberflächen zu verstecken, bis sich jemand „qualifiziert“, macht aus einer Rampe eine verschlossene Tür – und wer auf der falschen Seite steht, erfährt nie, was dahinter lag.

Und bis ganz nach oben zu steigen, ist keine Pflicht. Auf halbem Weg aufzuhören, ist eine vollständige, erfolgreiche Nutzung des Produkts. Wer drei Landingpages ausliefert und nie ein Unternehmen gründet, ist nicht am Onboarding gescheitert – er hat bekommen, weswegen er gekommen ist.

## Das Eine, was eine Phase nicht sein darf

Eine Phase ist keine Abteilung, und die Versuchung, sie zu einer zu machen, ist ständig da. Der klarste Test, den das Team anwendet: **Ist das eine Arbeitsphase oder eine Gruppe von Menschen?**

„KI“ ist durch diesen Test gefallen, und deshalb gibt es keinen KI-Bereich. Seine Ziele gingen an die Sitze, denen die Arbeit gehört – Ausgabenkategorisierung an Finanzen, Vertragsanalyse an Governance, Wettbewerbsbeobachtung an Wachstum, Feedback zum Pitch-Deck an den CEO. Ein Menüpunkt, der nach einer Technologie benannt ist, sagt Ihnen, woraus die Software gemacht ist. Die Sitze sagen Ihnen, wofür sie da ist.

Gleicher Test, gleiche Antwort für „Berichte“, „Automatisierung“ und „Integrationen“. Jedes davon ist eine Eigenschaft vieler Ziele, kein Ort.

---

*Sehen Sie den ganzen Bogen live erzeugt auf [der Features-Seite](/features), oder überspringen Sie die Tour und [starten Sie bei Idee](/create/new). Die Methode, die die Phasen tragen, ist in [Von der Idee zur Realität](/blog/idea-to-real-the-operating-methodology) beschrieben.*
