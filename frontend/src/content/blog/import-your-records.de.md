Das Board Deck war schon immer ehrlich. Die Personal-Folie basiert auf Headcount-Ereignissen, die Investitions-Folie auf quartalsweisen F&E-Zahlen, die Qualitäts-Folie auf Incidents und Support-Tickets, die KI-Folie auf der Tool-Nutzung. Nichts davon wird in eine Vorlage getippt; jede Zahl ist eine Abfrage über eine Tabelle.

Das wirft für die Datensätze, die kein Connector befüllt, eine naheliegende Frage auf: **Wie kommen die Zeilen in die Tabelle?**

Eine Zeit lang lautete die ehrliche Antwort: eine nach der anderen, über ein Tracker-Formular. Eine Finanzleiterin mit drei Quartalen Ausgaben in einer Tabellenkalkulation hatte hundert Formularübermittlungen vor sich. Die meisten haben es gelassen, die Ansichten blieben leer – und eine leere Ansicht sieht einem Feature, das nicht funktioniert, zum Verwechseln ähnlich.

Technisch gab es einen zweiten Weg. Es existierte ein Import-Endpunkt, angehängt an die Insights-API, den nur die Tools von Brain ansprachen. Und es gab eine `/import`-Seite – einen geführten Assistenten und einen Massen-Uploader –, auf die nichts verlinkte, die nur einen generischen „Datensatz“ mit Name und Priorität kannte und die jede Übermittlung damit beendete, sechshundert Millisekunden zu schlafen und Ihnen eine Referenznummer anzuzeigen, die sie sich gerade ausgedacht hatte. Ein Gerüst im Kostüm eines Features.

## Was Import jetzt ist

Es gibt eine einzige Import-Oberfläche, und die Seite ist eine echte Front dafür.

```bf-figure
{
  "kind": "flow",
  "title": "Aus einer Datei werden Zeilen, die die Ansichten lesen können",
  "steps": [
    { "label": "Art wählen", "note": "Headcount-Ereignisse, offene Stellen, F&E-Finanzen, Incidents, Uptime, KI-Nutzung – die Registry des Servers, vom Server geliefert.", "hue": "measure" },
    { "label": "Zuordnen", "note": "Ihre Spaltenköpfe werden per Name den Spalten der Art zugeordnet; was falsch geraten wurde, korrigieren Sie mit einem Dropdown. Pflichtspalten sind mit Stern markiert.", "hue": "measure" },
    { "label": "Prüfen", "note": "Jede Zelle wird gegen ihren Spaltentyp geprüft – in Ihrer Sprache –, und der Server verarbeitet dieselbe Datei als Probelauf und sagt, welche Zeilen er schreiben würde.", "hue": "measure" },
    { "label": "Übertragen", "note": "Die gültigen Zeilen gehen in Paketen zu je fünfhundert hoch. Der Balken bewegt sich, wenn der Server ein Paket bestätigt, nicht nach einem Timer.", "hue": "measure", "tag": "echter Fortschritt" }
  ],
  "caption": "Die Spalten werden auf der Seite nicht noch einmal definiert. Sie werden aus der Registry der API gelesen, sodass eine neue Spalte in einem Datensatz den Mapper, die Vorlage und den Assistenten ohne zweite Registrierung erreicht."
}
```

Drei Punkte daran sind es wert, klar ausgesprochen zu werden – denn jeder ersetzt etwas, das früher nur vorgetäuscht war.

**Die Spalten kommen vom Server.** Die Seite fragt `/api/import/kinds` ab und erhält jeden importierbaren Datensatz mit seinen Spalten, deren Typen, der Angabe, ob sie Pflicht sind, und einem realistischen Beispielwert. Die CSV-Vorlage, die Sie herunterladen, wird aus dieser Liste erzeugt; der Platzhalter in jedem Feld des Assistenten ist der Beispielwert der jeweiligen Spalte. Es gibt keine Kopie des Schemas im Client, die abweichen könnte.

**Die Prüfung sind zwei Prüfungen.** Bevor irgendetwas geschrieben wird, validiert der Client jede zugeordnete Zelle – eine Zahl, die keine Zahl ist, ein Datum, das kein Datum ist, eine leere Pflichtspalte – und nennt Ihnen Zeile und Spalte, in Ihrer Sprache. Dann gehen dieselben Zeilen mit `dryRun: true` an den Server, und der Server antwortet, was er schreiben *würde* und welche Zeilen er überspringen würde. Die erste Prüfung sagt Ihnen, welche Zelle betroffen ist; die zweite ist maßgeblich dafür, was tatsächlich ankommt.

**Der Fortschritt ist echt.** Zeilen werden in Paketen übertragen, und der Zähler zeigt *übertragen von gesamt*, sobald der Server jedes Paket bestätigt. Schlägt ein Paket zwischendurch fehl, sagt die Seite das, behält, was bereits geschrieben wurde, und zeigt die Gesamtbilanz, statt so zu tun, als wäre nichts passiert.

```bf-figure
{
  "kind": "screen",
  "frame": "Massenimport, im Prüfschritt",
  "ratio": 1.5,
  "regions": [
    { "label": "Art", "note": "Ein Datensatz, aus der Registry gewählt", "x": 4, "y": 6, "w": 92, "h": 10, "hue": "measure" },
    { "label": "Zeilen in der Datei · gültig · mit Fehlern · Server schreibt", "note": "Vier Zahlen, zwei Quellen", "x": 4, "y": 20, "w": 92, "h": 16, "hue": "accent" },
    { "label": "Zeile 12 · effectiveOn · muss ein Datum sein", "note": "Die Client-Prüfung, pro Zelle, übersetzt", "x": 4, "y": 40, "w": 60, "h": 34, "hue": "bad" },
    { "label": "Zeilen, die der Server überspringen würde", "note": "Die Zeilen des Probelaufs selbst", "x": 68, "y": 40, "w": 28, "h": 34, "hue": "muted" },
    { "label": "Zurück · Abbrechen · 188 Zeilen importieren", "x": 4, "y": 80, "w": 92, "h": 12, "hue": "accent" }
  ],
  "caption": "Der Import-Button zählt die Zeilen, die die Client-Prüfung bestanden haben, und der Probelauf des Servers wird daneben angezeigt, damit Sie wissen, was aus dieser Zahl werden wird."
}
```

## Der geführte Weg gibt es weiterhin

Nicht jeder Datensatz ist eine Datei. Ein einzelner Incident, eine offene Stelle, die KI-Tool-Zahlen dieses Monats – der Assistent nimmt sie einzeln entgegen, prüft jedes Feld beim Verlassen und bietet vor dem Absenden einen Prüfschritt. Geändert hat sich das Ende: Er übermittelt den einen Datensatz über denselben Endpunkt, den auch der Massenimport nutzt, und zeigt Ihnen die Antwort des Servers – geschrieben oder übersprungen, und warum. Die erfundene Referenznummer ist verschwunden, denn eine Quittung, die man sich ausgedacht hat, ist keine Quittung.

## Wo es in der Methode steht

Import ist eine **Messen**-Fähigkeit. Der Bogen lautet Idee → Bauen → Betreiben → Messen, und Messen ist der Akt, der eine bewertete Antwort an Idee zurückgibt – hier schließt sich der Kreis. Eine Ansicht, die aus einer leeren Tabelle liest, kann nichts bewerten; sie kann nur so aussehen, als würde sie es gleich tun. Die Ansichten für Personal, F&E, Qualität und KI wurden gebaut, um ehrlich darzustellen, was der Workspace tatsächlich tut – und das Einzige, was zwischen ihnen und dieser Ehrlichkeit stand, war der Aufwand, ein Quartal an Fakten in sie hineinzubekommen.

```bf-figure
{
  "kind": "compare",
  "title": "Was eine wahre Ansicht kostet",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": ["Den Tracker öffnen", "Eine Zeile eintippen", "Absenden", "Hundertmal wiederholen", "Oder die Ansicht leer lassen", "Oder Brain bitten, einen Endpunkt aufzurufen, von dem die Seite nichts wusste"] },
    { "title": "Jetzt", "hue": "measure", "items": ["Die Vorlage der Art herunterladen", "Ausfüllen – oder aus dem Tool exportieren, in dem die Zahlen ohnehin liegen", "Zuordnen, prüfen, übertragen", "Zusehen, wie sich die Ansicht neu zeichnet"] }
  ],
  "caption": "Import ist ein Tab von Insights, weil die importierten Zeilen genau dort auftauchen. Vorher hatte die Seite überhaupt keine Tür; jetzt liegt die Tür direkt neben dem Raum."
}
```

## Was Sie heute damit tun können

- **Laden Sie ein Quartal an F&E-Finanzen, Umsatz und FTE-Zuordnung** aus drei kleinen Dateien und lesen Sie die Investitionsansicht gegen den Plan.
- **Tragen Sie Headcount-Ereignisse und offene Stellen nach**, sodass Wasserfall und Fluktuation auf der Personal-Folie auf Ihrer Historie basieren – nicht auf dem Tag Ihrer Registrierung.
- **Holen Sie Incidents, Support-Tickets und Uptime-Messungen herein** – aus einem Export des Tools, in dem sie liegen – und lassen Sie die Qualitätsansicht das Quartal bewerten.
- **Erfassen Sie KI-Tool-Nutzung und Programmausgaben** Monat für Monat und sehen Sie, wie die KI-Ansicht die eingesparten Stunden pro Dollar berechnet.
- **Bitten Sie Brain, es zu erledigen** – sein Tool `board_data.import` spricht denselben Vertrag, Probelauf inklusive.

Jede dieser Möglichkeiten endet gleich: mit einer Ansicht, die früher leer war und jetzt eine echte Zahl zeigt.

---

**Weiterlesen:** [Den Nachweis bewerten und den Kreis schließen](/blog/grade-the-proof-and-close-the-loop) · [Das operative Gesamtbild jeder Rolle](/blog/every-role-operating-picture)

[Öffnen Sie Import](/import) und laden Sie eine Vorlage für den Datensatz herunter, den Sie schon lange befüllen wollten.
