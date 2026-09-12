„Mach es real“ ist nicht eine Sache. Es sind mindestens acht, sie unterscheiden sich enorm in Wiedergabetreue und Kosten, und die falsche Wahl zwischen ihnen ist der teuerste Fehler, den man im ersten Monat eines Projekts machen kann.

Die meisten Tools bieten genau eine Antwort: das System bauen. Das ist der teuerste Nachweis überhaupt, und für die meisten Fragen, die ein Unternehmen tatsächlich hat, ist es der falsche. „Können Sie es mir zeigen?“ braucht kein laufendes System. „Will das überhaupt jemand?“ beantworten eine Landingpage und eine Zahl – und wer diese Frage mit einem gebauten System beantwortet, verbringt sechs Wochen mit etwas, nach dem niemand gefragt hat.

Hier also die acht, was jede beantwortet und wo jede auf den beiden Achsen liegt, auf die es ankommt.

## Die Landkarte

```bf-figure
{
  "kind": "matrix",
  "title": "Wiedergabetreue gegen Aufwand",
  "xLabel": "Aufwand  ·  1 = ein Nachmittag,  5 = Wochen",
  "yLabel": "Wiedergabetreue  ·  1 = eine Skizze,  5 = das Ding selbst",
  "max": 5,
  "points": [
    { "label": "Demo-Video", "x": 1, "y": 1, "hue": "read", "dx": 10, "dy": -12 },
    { "label": "Klickbarer Prototyp", "x": 2, "y": 2, "hue": "read", "dx": -12, "dy": 20 },
    { "label": "Smoke-Test", "x": 2, "y": 2, "hue": "prove", "dx": 12, "dy": -12 },
    { "label": "Wizard of Oz", "x": 2, "y": 3, "hue": "prove", "dx": 12, "dy": -10 },
    { "label": "Proof of Concept", "x": 3, "y": 3, "hue": "prove", "dx": 12, "dy": 18 },
    { "label": "Telefonleitung", "x": 3, "y": 4, "hue": "build", "dx": 12, "dy": -12 },
    { "label": "Pilot", "x": 4, "y": 4, "hue": "build", "dx": 12, "dy": 20 },
    { "label": "Live-System", "x": 5, "y": 5, "hue": "make", "dx": -12, "dy": -14 }
  ],
  "caption": "Der klickbare Prototyp und der Smoke-Test liegen tatsächlich auf denselben Koordinaten – gleiche Wiedergabetreue, gleicher Aufwand –, ihre Beschriftungen weichen nur auseinander, damit beide lesbar bleiben. Sie kosten dasselbe und beantworten völlig verschiedene Fragen, und genau darum geht es: Die Kosten sagen Ihnen nicht, welchen Nachweis Sie führen sollen, sondern nur, bei welchen Sie es sich leisten können, falschzuliegen."
}
```

Lesen Sie die linke untere Ecke als Faustregel, nicht als Rangliste. Nichts dort unten ist ein minderwertiger Nachweis; es ist eine günstigere Antwort auf eine engere Frage. Ein Demo-Video zu drehen, ist nie *falsch*.

## Die acht – und die Frage, für die jede wirklich da ist

**Demo-Video** – *„Können Sie mir zeigen, was das ist?“* Ein getaktetes Video und ein Sprechertext, sodass heute schon eine aufnehmbare Neunzig-Sekunden-Demo existiert. Wiedergabetreue 1, Aufwand 1. Das ist die Antwort, wenn die fragende Person eine Stakeholderin, ein Investor oder eine Kollegin ist, die sich das Ding vorstellen muss. Ein System zu bauen, um diese Frage zu beantworten, ist ein Kategorienfehler.

**Klickbarer Prototyp** – *„Kann jemand das tatsächlich ohne Hilfe durchlaufen?“* Ein instrumentierter Click-through des Ablaufs, ohne Backend und ohne Daten. Wiedergabetreue 2, Aufwand 2. Ein Prototyp, der ein Deployment braucht, ist kein Prototyp; sein ganzer Wert liegt darin, dass er auf jedem Laptop läuft, vor einem echten Menschen, noch heute Nachmittag.

**Smoke-Test** – *„Will das überhaupt jemand?“* Eine Fake-Door-Landingpage, eine Warteliste und eine Nachfragekonsole, gemessen an einem vorab festgelegten Schwellenwert. Wiedergabetreue 2, Aufwand 2. Der Schwellenwert ist der ganze Test. Ohne ihn haben Sie eine Landingpage und ein Gefühl.

**Wizard of Oz** – *„Ist das Ergebnis Geld wert, bevor wir es automatisieren können?“* Ein echtes Frontend mit einem Menschen dahinter, unter SLA-Uhr, über dieselben Routen, die auch das gebaute System nutzen wird. Wiedergabetreue 3, Aufwand 2. Absurd selten genutzt, weil es sich wie Schummeln anfühlt. Es ist kein Schummeln; es trennt „Ist das wertvoll?“ von „Können wir es automatisieren?“ – zwei Fragen, die aus unterschiedlichen Gründen scheitern.

**Proof of Concept** – *„Funktioniert der schwierige Teil tatsächlich, und zwar zuverlässig genug?“* Der riskanteste Schritt, isoliert hinter einem Test-Harness, mit einer Erfolgsquote, gemessen an einer vorab festgelegten Latte. Wiedergabetreue 3, Aufwand 3. Achten Sie auf die Form: eine *Erfolgsquote*, keine Demo. Ein einziger erfolgreicher Durchlauf beweist nichts über einen Schritt, der acht von zehn Mal funktionieren muss.

**Pilot** – *„Hält es mit echten Menschen stand – in einer Größenordnung, bei der wir es verkraften, falschzuliegen?“* Ein begrenzter Durchlauf mit einer benannten Kohorte, einer wöchentlichen Feedbackschleife und schriftlich festgehaltenen Abbruchkriterien. Wiedergabetreue 4, Aufwand 4. Die Abbruchkriterien verhindern, dass ein Pilot stillschweigend zur Produktion wird.

**Telefonleitung** – *„Können Kunden das per Telefon erreichen – und kann es sie erreichen?“* Eine eingehende Nummer, die abhebt und versteht, plus ein Endpunkt, der ausgehende Anrufe tätigt. Wiedergabetreue 4, Aufwand 3. Günstiger als der Pilot daneben und weit realitätsnäher, als seine Kosten vermuten lassen – denn eine Telefonnummer, die abhebt, ist für die Person am anderen Ende unmissverständlich real.

**Live-System** – *„Läuft es tatsächlich, und können wir es betreiben?“* Das gesamte System unter einer echten Adresse, mit einer Ops-Konsole und einem On-Call-Runbook. Wiedergabetreue 5, Aufwand 5. Achten Sie auf die zweite Hälfte der Frage. Ein System, das niemand betreiben kann, ist nicht fertig; es ist ein Risiko mit bislang guter Verfügbarkeit.

## Was das Ranking tatsächlich tut

```bf-figure
{
  "kind": "bars",
  "title": "Aufwand, geordnet – die Standardempfehlung, bevor ein Briefing gelesen wird",
  "max": 5,
  "rows": [
    { "label": "Demo-Video", "value": 1, "note": "ein Nachmittag", "hue": "read" },
    { "label": "Klickbarer Prototyp", "value": 2, "note": "ein, zwei Tage", "hue": "read" },
    { "label": "Smoke-Test", "value": 2, "note": "ein, zwei Tage", "hue": "prove" },
    { "label": "Wizard of Oz", "value": 2, "note": "ein, zwei Tage", "hue": "prove" },
    { "label": "Proof of Concept", "value": 3, "note": "ein paar Tage", "hue": "prove" },
    { "label": "Telefonleitung", "value": 3, "note": "ein paar Tage", "hue": "build" },
    { "label": "Pilot", "value": 4, "note": "Wochen", "hue": "build" },
    { "label": "Live-System", "value": 5, "note": "Wochen echter Engineering-Arbeit", "hue": "make" }
  ],
  "caption": "Die Kosten allein machen vierzig Prozent des Ranking-Scores aus, noch vor jedem Abgleich der Fähigkeiten. Ohne diesen Term würde ein Briefing, das fünf Fähigkeiten nennt, immer den Nachweis ganz oben einstufen, der die meisten davon auflistet – und das ist immer der größte."
}
```

Wenn Sie ein Briefing einfügen, ergibt sich das Ranking aus der Passung der Fähigkeiten **plus** einer grundsätzlichen Präferenz für günstig vor teuer. Ein Briefing, in dem „Sprache“ steht, weist tatsächlich auf die Telefonleitung, und der Passungsterm sagt das auch. Aber ein Briefing, das fünf Dinge nennt, weist auf fünf Nachweise – und ohne den Kostenterm schrumpft die Empfehlung jedes Mal auf „alles bauen“, als Analyse verkleidet.

Zwei weitere Regeln, denen das Ranking folgt – beide gibt es, weil die Alternative schlechter wäre:

- **Jedes Ziel kommt immer zurück, mit Begründung.** Ein Score ohne Begründung ist kein Rat, sondern ein Urteil – und mit einem Rat sollte eine Gründerin streiten können.
- **Ein Ziel ohne Fähigkeitsliste ist universell, nicht irrelevant.** „Passt zu nichts“ mit null zu bewerten, würde das Demo-Video begraben – und das ist für die meisten Briefings die richtige erste Antwort.

## Gut wählen

Die praktische Frage lautet nicht „Welcher Nachweis ist der beste?“. Sie lautet: **Welche Frage bin ich bereit, mit Geld zu beantworten – und welches Ergebnis würde mich aufhören lassen?**

```bf-figure
{
  "kind": "flow",
  "title": "Eine Entscheidung, die Sie in etwa einer Minute treffen können",
  "steps": [
    { "label": "Den Zweifel benennen", "note": "Nicht das Feature – den Zweifel. „Niemand will es“, „das Modell ist nicht genau genug“, „die Leute kommen nicht durch den Ablauf“, „es hält echter Last nicht stand“.", "hue": "read" },
    { "label": "Den Nachweis wählen, der ihn angreift", "note": "Nachfrage → Smoke-Test. Verständlichkeit → klickbarer Prototyp. Technisches Risiko → Proof of Concept. Wert vor Automatisierung → Wizard of Oz.", "hue": "prove" },
    { "label": "Zuerst die Zahl aufschreiben", "note": "Den Schwellenwert, die Erfolgsquote, die Abschlussrate, die Abbruchkriterien. Bevor gebaut wird, nicht nachdem das Ergebnis vorliegt.", "hue": "prove", "tag": "nicht verhandelbar" },
    { "label": "Durchführen – und die Zahl respektieren", "note": "Ein Schwellenwert, den Sie nach dem Ergebnis neu verhandeln, war nie ein Schwellenwert.", "hue": "build" }
  ]
}
```

Am letzten Schritt scheitert die meiste Validierung tatsächlich. Der Nachweis läuft, die Zahl fällt niedrig aus, und die Zahl verschiebt sich. Sie vorher aufzuschreiben, macht niemanden ehrlich – aber es macht die Unehrlichkeit sichtbar, und das ist, wie sich zeigt, der größte Teil der Arbeit.

## Wo die Wiedergabetreue nicht die ganze Geschichte ist

Eine Warnung zur Landkarte. Die Wiedergabetreue misst, wie nah der Nachweis am echten Ding ist – nicht, wie *überzeugend* er ist. Ein Neunzig-Sekunden-Demo-Video mit Wiedergabetreue 1 bringt einen Investor weiter als ein Proof of Concept mit Wiedergabetreue 3, denn die Frage des Investors lautete „Können Sie es mir zeigen?“, und der PoC hat eine Frage beantwortet, die ihm niemand gestellt hat.

Passen Sie den Nachweis an die fragende Person an, nicht an die Achse.

---

*[Beginnen Sie mit einem Canvas](/create/new) und beschreiben Sie die Idee – angemeldet liest `/realize` sie und ordnet alle acht Wege danach ein. Lesen baut nichts, das Ranking anzusehen kostet Sie also nichts. Oder lesen Sie die Methode, in die sie eingebettet sind: [Von der Idee zur Realität](/blog/idea-to-real-the-operating-methodology).*
